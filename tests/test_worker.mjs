// Run: node --test tests/test_worker.mjs   (Node 20+)
// Exercises the companion worker with in-memory Durable Object storage and a fake push service.
import test from "node:test";
import assert from "node:assert/strict";
import worker, { Device, SyncRoom } from "../push-worker/src/index.js";

function memoryState() {
  const m = new Map(); let alarm = null;
  return {
    alarmAt: () => alarm,
    storage: {
      get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)); },
      delete: async (k) => m.delete(k), deleteAll: async () => m.clear(),
      setAlarm: async (t) => { alarm = t; }, deleteAlarm: async () => { alarm = null; },
    },
  };
}
function namespace(Cls, env) {
  const objs = new Map();
  return { idFromName: (n) => n, get: (id) => { if (!objs.has(id)) { const s = memoryState(); objs.set(id, { obj: new Cls(s, env), s }); } return { fetch: (r) => objs.get(id).obj.fetch(r), _o: objs.get(id) }; } };
}

const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const b64u = (b) => Buffer.from(b).toString("base64url");
const env = {
  ALLOWED_ORIGINS: "https://deivaprakash56.github.io",
  VAPID_PUBLIC: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey))),
  VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey("jwk", kp.privateKey)),
};
env.DEVICE = namespace(Device, env);
env.SYNC = namespace(SyncRoom, env);
const sub = { endpoint: "https://push.example.net/abc", keys: { p256dh: b64u(new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey))), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
const call = (method, path, body) => worker.fetch(new Request(`https://w.example${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers: { Origin: "https://deivaprakash56.github.io" } }), env);

const pushes = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { if (String(url).startsWith("https://push.example.net")) { pushes.push({ url, init }); return new Response(null, { status: 201 }); } return realFetch(url, init); };

const DEV = "device_0123456789abcdef";

test("health, vapid and CORS", async () => {
  const r = await call("GET", "/health");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://deivaprakash56.github.io");
  assert.deepEqual(await r.json(), { ok: true, push: true, ai: false });
  assert.equal((await (await call("GET", "/vapid")).json()).publicKey, env.VAPID_PUBLIC);
  assert.equal((await call("GET", "/device/short/x")).status, 404);
});

test("schedule fires pushes from the alarm, nag repeats", async () => {
  assert.equal((await call("POST", `/device/${DEV}/subscribe`, { subscription: sub })).status, 200);
  const now = Date.now();
  const r = await call("PUT", `/device/${DEV}/schedule`, { items: [
    { id: 1, at: now - 1000, title: "Pay rent", body: "Due now" },
    { id: 2, at: now - 1000, title: "Pills", nag: true },
    { id: 3, at: now + 3600_000, title: "Later" },
  ] });
  assert.deepEqual(await r.json(), { ok: true, count: 3 });
  const dev = env.DEVICE.get(DEV)._o;
  assert.ok(dev.s.alarmAt() <= Date.now() + 1000);
  await dev.obj.alarm();
  assert.equal(pushes.length, 2);
  assert.equal(pushes[0].init.headers["Content-Encoding"], "aes128gcm");
  assert.match(pushes[0].init.headers.Authorization, /^vapid t=.+, k=/);
  const items = await dev.s.storage.get("items");
  assert.equal(items.find((i) => i.id === "1").sent, true);
  const nag = items.find((i) => i.id === "2");
  assert.equal(nag.sent, undefined); assert.equal(nag.nagCount, 1);
  assert.ok(nag.next > Date.now() + 4 * 60_000);
  assert.ok(dev.s.alarmAt() > Date.now() + 4 * 60_000);
  // re-sending the same schedule keeps the sent / nag state
  await call("PUT", `/device/${DEV}/schedule`, { items: [{ id: 2, at: now - 1000, title: "Pills", nag: true }] });
  assert.equal((await dev.s.storage.get("items"))[0].nagCount, 1);
});

test("sync: optimistic concurrency", async () => {
  const S = "/sync/space_0123456789abcdef";
  assert.deepEqual(await (await call("GET", S)).json(), { rev: 0, data: null, updated: 0 });
  assert.equal((await (await call("PUT", S, { baseRev: 0, data: "cipher-1" })).json()).rev, 1);
  const conflict = await call("PUT", S, { baseRev: 0, data: "cipher-2" });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).data, "cipher-1");
  assert.equal((await (await call("PUT", S, { baseRev: 1, data: "cipher-2" })).json()).rev, 2);
});

test("ai proxy is disabled without a key", async () => {
  assert.equal((await call("POST", "/ai", { system: "x", text: "y", schema: {} })).status, 501);
});
