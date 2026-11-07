// Run: node --test tests/test_accounts.mjs   (Node 20+)
// Beta accounts on the companion worker, with in-memory Durable Object storage.
import test from "node:test";
import assert from "node:assert/strict";
import worker, { Accounts, SyncRoom } from "../push-worker/src/index.js";
import { loginKey } from "../docs/auth.js";

function memoryState() {
  const m = new Map();
  return {
    storage: {
      get: async (k) => structuredClone(m.get(k)), put: async (k, v) => { m.set(k, structuredClone(v)); },
      delete: async (k) => m.delete(k), deleteAll: async () => m.clear(),
      list: async ({ prefix = "" } = {}) => new Map([...m].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, structuredClone(v)])),
    },
  };
}
function namespace(Cls, env) {
  const objs = new Map();
  return { idFromName: (n) => n, get: (id) => { if (!objs.has(id)) objs.set(id, new Cls(memoryState(), env)); return { fetch: (r) => objs.get(id).fetch(r) }; } };
}
const env = { ALLOWED_ORIGINS: "https://deivaprakash56.github.io", ADMIN_TOKEN: "admin-secret-token-for-tests-0123456789", ADMIN_NAME: "Deivaprakash" };
env.ACCOUNTS = namespace(Accounts, env);
env.SYNC = namespace(SyncRoom, env);

async function call(method, path, body, token) {
  const headers = { Origin: "https://deivaprakash56.github.io" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await worker.fetch(new Request(`https://w.example${path}`, { method, body: body ? JSON.stringify(body) : undefined, headers }), env);
  return { status: res.status, body: await res.json(), cors: res.headers.get("Access-Control-Allow-Origin") };
}
const admin = (method, path, body) => call(method, `/admin/${path}`, body, env.ADMIN_TOKEN);

const EMAIL = "Priya@Example.com";
let token;

test("admin endpoints need the admin token", async () => {
  assert.equal((await call("GET", "/admin/users")).status, 401);
  assert.equal((await call("GET", "/admin/users", null, "wrong")).status, 401);
  assert.equal((await call("POST", "/admin/approve", { email: "x@example.com" })).status, 401);
  const r = await admin("GET", "users");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { users: [], allow: [] });
});

test("unknown emails become access requests the admin approves", async () => {
  const key = await loginKey(EMAIL, "correct horse battery");
  const r = await call("POST", "/auth/signup", { email: EMAIL, key, name: "Priya" });
  assert.equal(r.status, 202);
  assert.equal(r.body.pending, true);
  assert.equal(r.body.token, undefined);
  assert.match(r.body.message, /Access requested\. Deivaprakash has been asked to approve/);
  // signing up again just says it's still waiting
  const again = await call("POST", "/auth/signup", { email: EMAIL, key });
  assert.equal(again.status, 202);
  assert.match(again.body.message, /already requested/);
  // the right password tells them it's pending; a wrong one doesn't reveal anything
  const pend = await call("POST", "/auth/login", { email: EMAIL, key });
  assert.equal(pend.status, 403);
  assert.equal(pend.body.pending, true);
  assert.match(pend.body.error, /waiting for Deivaprakash's approval/);
  assert.equal((await call("POST", "/auth/login", { email: EMAIL, key: await loginKey(EMAIL, "wrong one 123") })).body.error, "Wrong email or password");
  // the admin sees the request and approves it
  const list = await admin("GET", "users");
  assert.equal(list.body.users.find((u) => u.email === "priya@example.com").pending, true);
  assert.equal((await admin("POST", "approve", { email: "priya@example.com" })).status, 200);
  const ok = await call("POST", "/auth/login", { email: EMAIL, key });
  assert.equal(ok.status, 200);
  assert.equal(ok.cors, "https://deivaprakash56.github.io");
  assert.equal(ok.body.user.email, "priya@example.com");
  assert.equal(ok.body.user.name, "Priya");
  token = ok.body.token;
  assert.equal((await call("POST", "/auth/signup", { email: EMAIL, key })).status, 409);
  assert.equal((await admin("GET", "users")).body.allow.some((a) => a.email === "priya@example.com"), true);
});

test("pre-approved emails get straight in; declined requests are removed", async () => {
  assert.equal((await admin("POST", "allow", { emails: "ravi@example.com" })).status, 200);
  assert.equal((await admin("POST", "allow", { emails: ["not-an-email"] })).status, 400);
  const k = await loginKey("ravi@example.com", "ravi's password");
  const r = await call("POST", "/auth/signup", { email: "ravi@example.com", key: k });
  assert.equal(r.status, 200);
  assert.ok(r.body.token.length > 30);
  await call("POST", "/auth/signup", { email: "spam@example.com", key: await loginKey("spam@example.com", "whatever 123") });
  assert.equal((await admin("POST", "delete", { email: "spam@example.com" })).status, 200);
  assert.equal((await admin("GET", "users")).body.users.some((u) => u.email === "spam@example.com"), false);
});

test("sign in, session and wrong passwords", async () => {
  assert.equal((await call("GET", "/auth/me", null, token)).body.user.name, "Priya");
  assert.equal((await call("GET", "/auth/me", null, "nope")).status, 401);
  const bad = await call("POST", "/auth/login", { email: EMAIL, key: await loginKey(EMAIL, "wrong password!") });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "Wrong email or password");
  assert.equal((await call("POST", "/auth/login", { email: "nobody@example.com", key: await loginKey("nobody@example.com", "whatever123") })).status, 401);
  const good = await call("POST", "/auth/login", { email: " PRIYA@example.com ", key: await loginKey(EMAIL, "correct horse battery") });
  assert.equal(good.status, 200);
});

test("too many wrong passwords locks the account for a while", async () => {
  await admin("POST", "allow", { emails: "lock@example.com" });
  await call("POST", "/auth/signup", { email: "lock@example.com", key: await loginKey("lock@example.com", "right password 1") });
  const wrong = await loginKey("lock@example.com", "wrong password 1");
  for (let i = 0; i < 6; i++) assert.equal((await call("POST", "/auth/login", { email: "lock@example.com", key: wrong })).status, 401);
  assert.equal((await call("POST", "/auth/login", { email: "lock@example.com", key: await loginKey("lock@example.com", "right password 1") })).status, 429);
});

test("each user has private data with conflict detection", async () => {
  const empty = await call("GET", "/me/data", null, token);
  assert.deepEqual(empty.body, { rev: 0, data: null, updated: 0 });
  const put = await call("PUT", "/me/data", { baseRev: 0, data: JSON.stringify({ reminders: [{ id: 1, title: "Call mom" }] }) }, token);
  assert.equal(put.body.rev, 1);
  assert.equal((await call("PUT", "/me/data", { baseRev: 0, data: "{}" }, token)).status, 409);
  assert.equal((await call("GET", "/me/data")).status, 401);
  // a second user can't see the first user's data
  const k2 = await loginKey("ravi@example.com", "ravi's password");
  const ravi = await call("POST", "/auth/login", { email: "ravi@example.com", key: k2 });
  assert.equal((await call("GET", "/me/data", null, ravi.body.token)).body.rev, 0);
  const list = await admin("GET", "users");
  const p = list.body.users.find((u) => u.email === "priya@example.com");
  assert.ok(p.lastSync > 0 && p.bytes > 10);
  assert.equal(list.body.allow.length, 3); // priya (approved request), ravi, lock
  const exp = await admin("POST", "export", { email: "priya@example.com" });
  assert.equal(exp.body.data.reminders[0].title, "Call mom");
});

test("password change signs out other sessions", async () => {
  const other = (await call("POST", "/auth/login", { email: EMAIL, key: await loginKey(EMAIL, "correct horse battery") })).body.token;
  const r = await call("POST", "/auth/password", { key: await loginKey(EMAIL, "correct horse battery"), newKey: await loginKey(EMAIL, "new password 2026") }, token);
  assert.equal(r.status, 200);
  assert.equal((await call("GET", "/auth/me", null, other)).status, 401);
  assert.equal((await call("GET", "/auth/me", null, token)).status, 401);
  token = r.body.token;
  assert.equal((await call("GET", "/auth/me", null, token)).status, 200);
  assert.equal((await call("POST", "/auth/password", { key: await loginKey(EMAIL, "nope nope nope"), newKey: await loginKey(EMAIL, "x y z 12345") }, token)).status, 403);
});

test("admin reset code lets a user choose a new password", async () => {
  const { body } = await admin("POST", "reset", { email: EMAIL });
  assert.match(body.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const newKey = await loginKey(EMAIL, "after reset pw");
  assert.equal((await call("POST", "/auth/reset", { email: EMAIL, code: "AAAA-AAAA", key: newKey })).status, 403);
  const ok = await call("POST", "/auth/reset", { email: EMAIL, code: body.code.toLowerCase(), key: newKey });
  assert.equal(ok.status, 200);
  assert.equal((await call("GET", "/auth/me", null, token)).status, 401);
  assert.equal((await call("POST", "/auth/reset", { email: EMAIL, code: body.code, key: newKey })).status, 403); // single use
  token = ok.body.token;
});

test("admin can pause and delete accounts", async () => {
  await admin("POST", "disable", { email: EMAIL, disabled: true });
  assert.equal((await call("GET", "/auth/me", null, token)).status, 401);
  assert.equal((await call("POST", "/auth/login", { email: EMAIL, key: await loginKey(EMAIL, "after reset pw") })).status, 403);
  await admin("POST", "disable", { email: EMAIL, disabled: false });
  assert.equal((await call("POST", "/auth/login", { email: EMAIL, key: await loginKey(EMAIL, "after reset pw") })).status, 200);
  assert.equal((await admin("POST", "delete", { email: EMAIL })).status, 200);
  assert.equal((await call("POST", "/auth/login", { email: EMAIL, key: await loginKey(EMAIL, "after reset pw") })).status, 401);
  assert.equal((await admin("POST", "export", { email: EMAIL })).status, 404);
});
