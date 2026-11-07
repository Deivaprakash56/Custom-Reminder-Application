// Nudge companion server (Cloudflare Worker + Durable Objects, free plan friendly).
//
// Beta accounts (see accounts.js):
//   POST /auth/signup  { email, key, name } -> { token, user }   (only emails on the approved list)
//   POST /auth/login   { email, key }       -> { token, user }
//   POST /auth/logout · GET /auth/me · POST /auth/password { key, newKey } · POST /auth/reset { email, code, key }
//   GET|PUT /me/data   the signed-in user's app data (same { rev, data } protocol as /sync)
//   /admin/*           Authorization: Bearer <ADMIN_TOKEN>: users, approved emails, reset codes, export, delete
//
//   GET  /health                      -> { ok, push, ai }
//   GET  /vapid                       -> { publicKey }
//   POST /device/:id/subscribe        { subscription }            store the browser's push subscription
//   PUT  /device/:id/schedule         { items: [{id, at, title, body, tag, nag, kind}] }  replace the schedule
//   POST /device/:id/test             send a test notification now
//   DELETE /device/:id                forget the device
//   GET  /sync/:id                    -> { rev, data, updated }   (data is ciphertext; the server can't read it)
//   PUT  /sync/:id                    { baseRev, data } -> { rev } or 409 { rev, data }
//   POST /ai                          { system, text, schema }   proxy to the Claude API (needs ANTHROPIC_API_KEY)
//
// Each device is a Durable Object that sets an alarm for its next reminder, so nothing polls.

import { sendPush } from "./webpush.js";
import { Accounts, safeEqual } from "./accounts.js";

export { Accounts };

const ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_ITEMS = 300;
const MAX_SYNC_BYTES = 1_800_000;
const NAG_EVERY_MS = 5 * 60_000;
const NAG_MAX = 24;

function cors(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

export default {
  async fetch(req, env) {
    const h = cors(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (parts[0] === "health") return json({ ok: true, push: Boolean(env.VAPID_PUBLIC && env.VAPID_PRIVATE_JWK), ai: Boolean(env.ANTHROPIC_API_KEY), accounts: Boolean(env.ACCOUNTS) }, 200, h);
      if (parts[0] === "vapid") {
        if (!env.VAPID_PUBLIC) return json({ error: "VAPID keys are not configured" }, 501, h);
        return json({ publicKey: env.VAPID_PUBLIC }, 200, h);
      }
      if (parts[0] === "device" && ID_RE.test(parts[1] || "")) {
        const stub = env.DEVICE.get(env.DEVICE.idFromName(parts[1]));
        const res = await stub.fetch(new Request(`https://do/${parts.slice(2).join("/")}`, { method: req.method, body: req.method === "GET" || req.method === "DELETE" ? null : await req.text(), headers: { "Content-Type": "application/json" } }));
        return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...h } });
      }
      if (parts[0] === "sync" && ID_RE.test(parts[1] || "")) {
        const stub = env.SYNC.get(env.SYNC.idFromName(parts[1]));
        const res = await stub.fetch(new Request("https://do/", { method: req.method, body: req.method === "PUT" ? await req.text() : null, headers: { "Content-Type": "application/json" } }));
        return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...h } });
      }
      if (parts[0] === "ai" && req.method === "POST") return await aiProxy(req, env, h);
      if (parts[0] === "auth" || parts[0] === "me" || parts[0] === "admin") {
        if (!env.ACCOUNTS) return json({ error: "Accounts are not set up on this server" }, 501, h);
        return withCors(await accountsRoute(req, env, parts), h);
      }
      return json({ error: "not found" }, 404, h);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, h);
    }
  },
};

// ---------------------------------------------------------------- accounts
function withCors(res, h) { return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...h } }); }
const accountsStub = (env) => env.ACCOUNTS.get(env.ACCOUNTS.idFromName("global"));
const toAccounts = (env, path, method, body, auth) => accountsStub(env).fetch(new Request(`https://do/${path}`, {
  method, body: body == null ? null : typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) } }));
const userRoom = (env, uid) => env.SYNC.get(env.SYNC.idFromName(`user:${uid}`));

async function accountsRoute(req, env, parts) {
  const auth = req.headers.get("Authorization") || "";
  const [area, action, arg] = parts;
  if (area === "auth") {
    const map = { "POST signup": "signup", "POST login": "login", "POST logout": "logout", "GET me": "session", "POST password": "password", "POST reset": "reset" };
    const target = map[`${req.method} ${action}`];
    if (!target) return json({ error: "not found" }, 404);
    const body = req.method === "POST" ? await req.text() : null;
    if (body && body.length > 4000) return json({ error: "too large" }, 413);
    return toAccounts(env, target, req.method, body, auth);
  }
  if (area === "me" && action === "data") {
    const who = await toAccounts(env, "session", "GET", null, auth);
    if (!who.ok) return who;
    const { user } = await who.json();
    const body = req.method === "PUT" ? await req.text() : null;
    if (body && body.length > MAX_SYNC_BYTES) return json({ error: "Your data is too large to sync (limit about 1.8 MB)" }, 413);
    const res = await userRoom(env, user.id).fetch(new Request("https://do/", { method: req.method === "PUT" ? "PUT" : "GET", body, headers: { "Content-Type": "application/json" } }));
    if (req.method === "PUT" && res.ok) await toAccounts(env, "touch", "POST", { uid: user.id, bytes: body.length });
    return res;
  }
  // admin
  if (!env.ADMIN_TOKEN || !safeEqual(auth.replace(/^Bearer\s+/i, ""), env.ADMIN_TOKEN)) return json({ error: "Admin token required" }, 401);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (req.method === "GET" && action === "users") return toAccounts(env, "admin/users", "GET");
  if (req.method === "POST" && ["allow", "unallow", "reset", "disable"].includes(action)) return toAccounts(env, `admin/${action}`, "POST", body);
  if (req.method === "POST" && (action === "export" || action === "delete")) {
    const look = await toAccounts(env, "admin/lookup", "POST", { email: body.email });
    if (!look.ok) return look;
    const { id } = await look.json();
    if (action === "export") {
      const doc = await (await userRoom(env, id).fetch(new Request("https://do/"))).json();
      return json({ email: body.email, rev: doc.rev, updated: doc.updated, data: doc.data ? JSON.parse(doc.data) : null });
    }
    await userRoom(env, id).fetch(new Request("https://do/", { method: "DELETE" }));
    return toAccounts(env, "admin/delete", "POST", { email: body.email });
  }
  return json({ error: "not found" }, 404);
}

// ---------------------------------------------------------------- AI proxy (keeps the API key on the server)
async function aiProxy(req, env, h) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "ANTHROPIC_API_KEY is not configured" }, 501, h);
  const { system, text, schema } = await req.json();
  if (typeof text !== "string" || text.length > 1000 || typeof system !== "string" || system.length > 6000) return json({ error: "bad request" }, 400, h);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: env.AI_MODEL || "claude-opus-5-5",
      max_tokens: 1024,
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: text }],
    }),
  });
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json", ...h } });
}

// ---------------------------------------------------------------- one Durable Object per device
export class Device {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(req) {
    const path = new URL(req.url).pathname.replace(/^\//, "");
    const st = this.state.storage;
    if (req.method === "POST" && path === "subscribe") {
      const { subscription } = await req.json();
      if (!subscription || typeof subscription.endpoint !== "string" || !/^https:\/\//.test(subscription.endpoint) || !subscription.keys?.p256dh || !subscription.keys?.auth) {
        return json({ error: "invalid subscription" }, 400);
      }
      await st.put("sub", { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } });
      return json({ ok: true });
    }
    if (req.method === "PUT" && path === "schedule") {
      const { items } = await req.json();
      if (!Array.isArray(items)) return json({ error: "items must be an array" }, 400);
      const now = Date.now();
      const old = new Map(((await st.get("items")) || []).map((i) => [i.key, i]));
      const clean = items.slice(0, MAX_ITEMS).map((i) => ({
        id: String(i.id).slice(0, 40), at: Number(i.at), kind: i.kind === "briefing" ? "briefing" : "reminder",
        title: String(i.title || "Reminder").slice(0, 120), body: String(i.body || "").slice(0, 240),
        tag: String(i.tag || `rem-${i.id}`).slice(0, 60), nag: Boolean(i.nag), priority: i.priority === "high" ? "high" : "normal",
      })).filter((i) => Number.isFinite(i.at) && i.at > now - 6 * 3600_000).map((i) => {
        i.key = `${i.id}@${i.at}`;
        const prev = old.get(i.key);
        if (prev) { i.sent = prev.sent; i.nagCount = prev.nagCount || 0; i.next = prev.next; }
        return i;
      });
      await st.put("items", clean);
      await this.arm(clean);
      return json({ ok: true, count: clean.length });
    }
    if (req.method === "POST" && path === "test") {
      const sub = await st.get("sub");
      if (!sub) return json({ error: "not subscribed" }, 400);
      const status = await sendPush(sub, { title: "🔔 Test notification", body: "Push notifications are working.", tag: "test" }, this.env);
      return json({ ok: status < 300, status });
    }
    if (req.method === "DELETE" && path === "") {
      await st.deleteAll();
      await st.deleteAlarm();
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  async arm(items) {
    const pending = items.filter((i) => !i.sent).map((i) => i.next || i.at);
    if (pending.length) await this.state.storage.setAlarm(Math.max(Date.now() + 1000, Math.min(...pending)));
    else await this.state.storage.deleteAlarm();
  }

  async alarm() {
    const st = this.state.storage;
    const sub = await st.get("sub");
    const items = (await st.get("items")) || [];
    const now = Date.now();
    for (const i of items) {
      if (i.sent || (i.next || i.at) > now + 15_000) continue;
      if (sub) {
        const status = await sendPush(sub, { id: i.id, title: i.title, body: i.body, tag: i.tag, kind: i.kind, nag: i.nag, priority: i.priority },
          this.env, { urgency: i.priority === "high" || i.nag ? "high" : "normal", topic: i.tag }).catch(() => 0);
        if (status === 404 || status === 410) { await st.delete("sub"); break; }
      }
      if (i.nag && (i.nagCount || 0) < NAG_MAX) { i.nagCount = (i.nagCount || 0) + 1; i.next = now + NAG_EVERY_MS; } else i.sent = true;
    }
    const keep = items.filter((i) => !i.sent || i.at > now - 24 * 3600_000);
    await st.put("items", keep);
    await this.arm(keep);
  }
}

// ---------------------------------------------------------------- one Durable Object per sync space
export class SyncRoom {
  constructor(state) { this.state = state; }

  async fetch(req) {
    const st = this.state.storage;
    const cur = (await st.get("doc")) || { rev: 0, data: null, updated: 0 };
    if (req.method === "GET") return json(cur);
    if (req.method === "PUT") {
      const raw = await req.text();
      if (raw.length > MAX_SYNC_BYTES) return json({ error: "too large" }, 413);
      const { baseRev, data } = JSON.parse(raw);
      if (typeof data !== "string") return json({ error: "data must be a string" }, 400);
      if (Number(baseRev) !== cur.rev) return json(cur, 409);
      const next = { rev: cur.rev + 1, data, updated: Date.now() };
      await st.put("doc", next);
      return json({ rev: next.rev, updated: next.updated });
    }
    if (req.method === "DELETE") { await st.deleteAll(); return json({ ok: true }); }
    return json({ error: "method not allowed" }, 405);
  }
}
