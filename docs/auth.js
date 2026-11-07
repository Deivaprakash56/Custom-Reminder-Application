// Nudge accounts: session storage and password stretching (shared by login.html, the app and tests).
const SESSION_KEY = "nudge.session";

// The password never leaves the device: it is stretched with PBKDF2 (salted with the email) and only
// the result is sent. The server hashes it again before storing it.
export async function loginKey(email, password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const salt = enc.encode(`nudge-login:${String(email).trim().toLowerCase()}`);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const apiBase = () => String((globalThis.NUDGE_CONFIG && globalThis.NUDGE_CONFIG.api) || "").trim().replace(/\/+$/, "");
export function getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
export function setSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
export function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

export async function authFetch(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  const t = token || (getSession() || {}).token;
  if (t) headers.Authorization = `Bearer ${t}`;
  let res;
  try { res = await fetch(apiBase() + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("Can't reach the Nudge server. Check your internet connection."); }
  const j = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 409) { const e = new Error(j.error || `Server error ${res.status}`); e.status = res.status; e.data = j; throw e; }
  return { status: res.status, ...j };
}
