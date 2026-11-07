// Beta accounts: sign-up for approved emails, sign-in sessions and admin tools.
// One Durable Object ("global") holds all accounts; each user's app data lives in its own SyncRoom.
//
// Passwords never reach the server: the browser stretches them with PBKDF2 (200,000 rounds, salted
// with the email) and sends the result ("key"). The server salts and hashes that key again before
// storing it, so a leaked database can't be used to sign in and is slow to brute-force.

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const KEY_RE = /^[A-Za-z0-9_-]{40,90}$/;
const SESSION_DAYS = 60;
const MAX_FAILS = 6;
const LOCK_MS = 15 * 60_000;
const RESET_HOURS = 48;

const te = new TextEncoder();
export const normEmail = (e) => String(e || "").trim().toLowerCase();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export async function sha256hex(text) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function hashKey(key, salt) {
  const base = await crypto.subtle.importKey("raw", unb64u(key), "PBKDF2", false, ["deriveBits"]);
  return b64u(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 1000, hash: "SHA-256" }, base, 256));
}
export function safeEqual(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function resetCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const b = rand(8); let s = "";
  for (let i = 0; i < 8; i++) { s += abc[b[i] % abc.length]; if (i === 3) s += "-"; }
  return s;
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const err = (error, status = 400) => json({ error }, status);
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name || "" });

export class Accounts {
  constructor(state, env) { this.state = state; this.env = env; this.st = state.storage; }

  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/+/, "");
    const body = req.method === "GET" || req.method === "DELETE" ? {} : await req.json().catch(() => ({}));
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    try {
      switch (`${req.method} ${path}`) {
        case "POST signup": return await this.signup(body);
        case "POST login": return await this.login(body);
        case "POST logout": return await this.logout(token);
        case "GET session": return await this.session(token);
        case "POST password": return await this.changePassword(token, body);
        case "POST reset": return await this.reset(body);
        case "POST touch": return await this.touch(body);
        case "GET admin/users": return await this.adminList();
        case "POST admin/allow": return await this.adminAllow(body);
        case "POST admin/unallow": return await this.adminUnallow(body);
        case "POST admin/reset": return await this.adminReset(body);
        case "POST admin/disable": return await this.adminDisable(body);
        case "POST admin/delete": return await this.adminDelete(body);
        case "POST admin/lookup": return await this.adminLookup(body);
        default: return err("not found", 404);
      }
    } catch (e) {
      return err(String((e && e.message) || e), 500);
    }
  }

  // ---------------------------------------------------------------- users
  async signup({ email, key, name }) {
    email = normEmail(email);
    if (!EMAIL_RE.test(email)) return err("Enter a valid email address");
    if (!KEY_RE.test(String(key || ""))) return err("Invalid password data");
    if (!(await this.st.get(`allow:${email}`))) return err("This email isn't approved for the beta yet. Ask the person who invited you to add it.", 403);
    if (await this.st.get(`user:${email}`)) return err("An account with this email already exists. Sign in instead.", 409);
    const salt = rand(16);
    const user = { id: b64u(rand(15)), email, name: String(name || "").trim().slice(0, 60), salt: b64u(salt), hash: await hashKey(key, salt),
      created: Date.now(), lastLogin: Date.now(), lastSync: 0, bytes: 0, disabled: false, fails: 0, lockUntil: 0 };
    await this.st.put(`user:${email}`, user);
    await this.st.put(`uid:${user.id}`, email);
    return json({ token: await this.newSession(user), user: publicUser(user) });
  }

  async login({ email, key }) {
    email = normEmail(email);
    const user = await this.st.get(`user:${email}`);
    const generic = "Wrong email or password";
    if (!user || !KEY_RE.test(String(key || ""))) { await hashKey(b64u(rand(32)), rand(16)); return err(generic, 401); }
    if (user.lockUntil > Date.now()) return err("Too many attempts. Try again in a few minutes.", 429);
    if (!safeEqual(await hashKey(key, unb64u(user.salt)), user.hash)) {
      user.fails = (user.fails || 0) + 1;
      if (user.fails >= MAX_FAILS) { user.fails = 0; user.lockUntil = Date.now() + LOCK_MS; }
      await this.st.put(`user:${email}`, user);
      return err(generic, 401);
    }
    if (user.disabled) return err("This account is paused. Contact the person who invited you.", 403);
    user.fails = 0; user.lockUntil = 0; user.lastLogin = Date.now();
    await this.st.put(`user:${email}`, user);
    return json({ token: await this.newSession(user), user: publicUser(user) });
  }

  async newSession(user) {
    const token = b64u(rand(32));
    const h = await sha256hex(token);
    await this.st.put(`sess:${h}`, { uid: user.id, email: user.email, exp: Date.now() + SESSION_DAYS * 86400_000 });
    await this.st.put(`usess:${user.id}:${h}`, 1);
    return token;
  }

  async userFor(token) {
    if (!token || token.length > 100) return null;
    const h = await sha256hex(token);
    const s = await this.st.get(`sess:${h}`);
    if (!s || s.exp < Date.now()) { if (s) await this.dropSession(h, s.uid); return null; }
    const user = await this.st.get(`user:${s.email}`);
    if (!user || user.disabled) return null;
    if (s.exp - Date.now() < (SESSION_DAYS / 2) * 86400_000) { s.exp = Date.now() + SESSION_DAYS * 86400_000; await this.st.put(`sess:${h}`, s); }
    return user;
  }
  async dropSession(h, uid) { await this.st.delete(`sess:${h}`); await this.st.delete(`usess:${uid}:${h}`); }
  async dropAllSessions(uid) {
    const keys = await this.st.list({ prefix: `usess:${uid}:` });
    for (const k of keys.keys()) { const h = k.split(":")[2]; await this.st.delete(`sess:${h}`); await this.st.delete(k); }
  }

  async session(token) {
    const user = await this.userFor(token);
    return user ? json({ user: publicUser(user) }) : err("Please sign in again", 401);
  }
  async logout(token) {
    if (token) { const h = await sha256hex(token); const s = await this.st.get(`sess:${h}`); if (s) await this.dropSession(h, s.uid); }
    return json({ ok: true });
  }
  async changePassword(token, { key, newKey }) {
    const user = await this.userFor(token);
    if (!user) return err("Please sign in again", 401);
    if (!KEY_RE.test(String(newKey || ""))) return err("Invalid password data");
    if (!safeEqual(await hashKey(key, unb64u(user.salt)), user.hash)) return err("Your current password is wrong", 403);
    await this.setPassword(user, newKey);
    return json({ token: await this.newSession(user), user: publicUser(user) });
  }
  async setPassword(user, key) {
    const salt = rand(16);
    user.salt = b64u(salt); user.hash = await hashKey(key, salt); user.fails = 0; user.lockUntil = 0;
    await this.st.put(`user:${user.email}`, user);
    await this.dropAllSessions(user.id);
  }
  async reset({ email, code, key }) {
    email = normEmail(email);
    const r = await this.st.get(`reset:${email}`);
    const user = await this.st.get(`user:${email}`);
    if (!r || !user || r.exp < Date.now() || !safeEqual(await sha256hex(String(code || "").trim().toUpperCase()), r.codeHash)) {
      if (r) { r.tries = (r.tries || 0) + 1; if (r.tries >= 5) await this.st.delete(`reset:${email}`); else await this.st.put(`reset:${email}`, r); }
      return err("That reset code is wrong or has expired", 403);
    }
    if (!KEY_RE.test(String(key || ""))) return err("Invalid password data");
    await this.st.delete(`reset:${email}`);
    await this.setPassword(user, key);
    user.lastLogin = Date.now(); await this.st.put(`user:${email}`, user);
    return json({ token: await this.newSession(user), user: publicUser(user) });
  }
  async touch({ uid, bytes }) {
    const email = await this.st.get(`uid:${uid}`); if (!email) return json({ ok: false });
    const user = await this.st.get(`user:${email}`); if (!user) return json({ ok: false });
    user.lastSync = Date.now(); user.bytes = Number(bytes) || 0;
    await this.st.put(`user:${email}`, user);
    return json({ ok: true });
  }

  // ---------------------------------------------------------------- admin (the worker checks ADMIN_TOKEN first)
  async adminList() {
    const users = [...(await this.st.list({ prefix: "user:" })).values()].map((u) => ({
      email: u.email, name: u.name, created: u.created, lastLogin: u.lastLogin, lastSync: u.lastSync, bytes: u.bytes, disabled: u.disabled, id: u.id }));
    const allow = [...(await this.st.list({ prefix: "allow:" })).entries()].map(([k, v]) => ({ email: k.slice(6), added: v.added, note: v.note || "" }));
    return json({ users: users.sort((a, b) => b.created - a.created), allow: allow.sort((a, b) => b.added - a.added) });
  }
  async adminAllow({ emails, note }) {
    const list = (Array.isArray(emails) ? emails : String(emails || "").split(/[\s,;]+/)).map(normEmail).filter(Boolean);
    const bad = list.filter((e) => !EMAIL_RE.test(e));
    if (bad.length) return err(`Not valid: ${bad.join(", ")}`);
    for (const e of list) if (!(await this.st.get(`allow:${e}`))) await this.st.put(`allow:${e}`, { added: Date.now(), note: String(note || "").slice(0, 80) });
    return json({ ok: true, added: list });
  }
  async adminUnallow({ email }) { await this.st.delete(`allow:${normEmail(email)}`); return json({ ok: true }); }
  async adminReset({ email }) {
    email = normEmail(email);
    if (!(await this.st.get(`user:${email}`))) return err("No account with that email", 404);
    const code = resetCode();
    await this.st.put(`reset:${email}`, { codeHash: await sha256hex(code), exp: Date.now() + RESET_HOURS * 3600_000, tries: 0 });
    return json({ email, code, expires: Date.now() + RESET_HOURS * 3600_000 });
  }
  async adminDisable({ email, disabled }) {
    email = normEmail(email);
    const user = await this.st.get(`user:${email}`); if (!user) return err("No account with that email", 404);
    user.disabled = Boolean(disabled); await this.st.put(`user:${email}`, user);
    if (user.disabled) await this.dropAllSessions(user.id);
    return json({ ok: true, disabled: user.disabled });
  }
  async adminDelete({ email }) {
    email = normEmail(email);
    const user = await this.st.get(`user:${email}`); if (!user) return err("No account with that email", 404);
    await this.dropAllSessions(user.id);
    await this.st.delete(`user:${email}`); await this.st.delete(`uid:${user.id}`); await this.st.delete(`reset:${email}`);
    return json({ ok: true, id: user.id });
  }
  async adminLookup({ email }) {
    const user = await this.st.get(`user:${normEmail(email)}`);
    return user ? json({ id: user.id, email: user.email }) : err("No account with that email", 404);
  }
}
