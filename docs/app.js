"use strict";
if (window.NUDGE_REDIRECTING) throw new Error("Opening the sign-in page");
// Nudge - installable web app (GitHub Pages). Everything is stored on this device (localStorage).
// Private-folder items are encrypted with AES-GCM using a key derived from your password (PBKDF2).
// Voice commands use the browser's speech recognition; NLP (nlp.js) turns them into actions.

// Signed-in users get their own local copy (so two accounts on one device never mix).
const SESSION = window.NUDGE_SESSION || null;
const ANON_KEY = "reminders-pro.v2";
const KEY = SESSION ? `nudge.v2.u.${SESSION.user.id}` : ANON_KEY;
const OLD_KEY = "task-reminder.v1";
const CHECK_MS = 15000;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
// Extension points used by extras.js (calendar, habits, focus, sync, push, ...)
const hooks = { afterSave: [], settings: [], tick: [], editorOpen: [], editorSave: [], cardActions: [], rowChips: [], vaultDialog: [] };
const VIEWS = {};
const runHooks = (list, ...args) => { for (const f of list) { try { f(...args); } catch (e) { console.warn(e); } } };
const NAG_MS = 5 * 60000;

// ================================================================== time helpers
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtSec = (d) => `${fmt(d)}:${pad(d.getSeconds())}`;
const parse = (s) => (s ? new Date(s.length === 16 ? `${s}:00` : s) : null);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const addMin = (d, m) => new Date(d.getTime() + m * 60000);
const timeText = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function relative(due, now) {
  const mins = Math.round((due - now) / 60000);
  const abs = Math.abs(mins);
  if (abs === 0) return "now";
  const span = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.floor(abs / 60)} h${abs % 60 && abs < 600 ? ` ${abs % 60} m` : ""}` : `${Math.round(abs / 1440)} d`;
  return mins > 0 ? `in ${span}` : `${span} ago`;
}
function dayLabel(d, now) {
  const n = dayDiff(d, now);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}
const whenText = (d, now) => `${dayLabel(d, now)}, ${timeText(d)}`;
function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}
function nextOccurrence(due, repeat, after) {
  const step = {
    daily: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours(), d.getMinutes()),
    weekly: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, d.getHours(), d.getMinutes()),
    monthly: (d) => addMonths(d, 1),
    yearly: (d) => addMonths(d, 12),
    weekdays: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + ({ 5: 3, 6: 2 }[d.getDay()] || 1), d.getHours(), d.getMinutes()),
  }[repeat];
  let n = step(due);
  while (n <= after) n = step(n);
  return n;
}

// ================================================================== icons (inline SVG)
const ICONS = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  scheduled: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  all: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  overdue: '<circle cx="12" cy="12" r="10"/><path d="M12 7v5M12 16h.01"/>',
  flagged: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  todo: '<path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  notes: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4M2 10h4M2 14h4M2 18h4"/><path d="M21.38 5.63a2.12 2.12 0 0 0-3-3L13 8v3h3z"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  snooze: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  volume: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4z"/><path d="m22 9-6 6M16 9l6 6"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  keyboard: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10"/>',
};
function icon(name, size = 18) {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.folder}</svg>`;
  return t.content.firstChild;
}
function hydrateIcons(root = document) {
  for (const e of $$("[data-icon]", root)) {
    if (e.dataset.iconDone) continue;
    e.prepend(icon(e.dataset.icon, Number(e.dataset.size) || 18));
    e.dataset.iconDone = "1";
  }
}

// replaceChildren() that flattens arrays and skips null/false
function fill(el, ...kids) { el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k === "value") e.value = v;
    else if (k === "checked") e.checked = Boolean(v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k);
  return e;
}

// ================================================================== data
const PALETTE = ["#3b82f6", "#f97316", "#8b5cf6", "#10b981", "#ef4444", "#ec4899", "#eab308", "#06b6d4", "#64748b"];
const FOLDER_ICONS = ["folder", "home", "cart", "heart", "book", "star"];
const DEFAULT_FOLDERS = [
  { id: "personal", name: "Personal", color: "#3b82f6", icon: "user", builtin: true },
  { id: "work", name: "Work", color: "#f97316", icon: "briefcase", builtin: true },
  { id: "private", name: "Private", color: "#8b5cf6", icon: "lock", builtin: true },
];
const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"];
const REPEAT_LABEL = { daily: "Daily", weekdays: "Weekdays", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" };
const PRIORITIES = ["low", "normal", "high"];

function defaultLang() {
  const l = navigator.language || "en-US";
  return /^en-(IN|US|GB|AU|CA)$/i.test(l) ? l : l.startsWith("en") ? "en-US" : "en-IN";
}
function blankDb() {
  return {
    version: 2, nextId: 1, folders: DEFAULT_FOLDERS.map((f) => ({ ...f })),
    reminders: [], todos: [], board: [], notes: [], history: [], habits: [], places: [], focusLog: [], vault: null,
    settings: { theme: "system", voiceLang: defaultLang(), speak: true, announce: true, handsFree: false, seconds: true, lastView: "today",
      accent: "indigo", sound: "chime", volume: 0.8, briefing: false, briefingTime: "08:00", lastBriefing: "", ai: false, aiKey: "",
      server: "", push: false, pushTitles: true, sync: false, geo: false, focusMin: 25, breakMin: 5 },
  };
}
function loadDb() {
  try {
    let raw = localStorage.getItem(KEY);
    // first sign-in on this device: bring along what was already saved here without an account
    if (!raw && SESSION && !localStorage.getItem("nudge.anonClaimed")) {
      raw = localStorage.getItem(ANON_KEY);
      if (raw) { localStorage.setItem(KEY, raw); localStorage.setItem("nudge.anonClaimed", SESSION.user.id); }
    }
    const d = JSON.parse(raw);
    if (d && d.version === 2) {
      const b = blankDb();
      for (const k of ["reminders", "todos", "board", "notes", "history", "habits", "places", "focusLog"]) if (!Array.isArray(d[k])) d[k] = [];
      if (!Array.isArray(d.folders) || !d.folders.length) d.folders = b.folders;
      for (const f of DEFAULT_FOLDERS) if (!d.folders.some((x) => x.id === f.id)) d.folders.push({ ...f });
      d.settings = { ...b.settings, ...(d.settings || {}) };
      return d;
    }
  } catch { /* start fresh */ }
  const d = blankDb();
  try { // bring over tasks from the first version of the app
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old && Array.isArray(old.tasks)) {
      for (const t of old.tasks) {
        if (!t || !t.title) continue;
        d.reminders.push({
          id: d.nextId++, title: String(t.title), notes: String(t.notes || ""), due: t.due || null,
          remind_before: Number(t.remind_before) || 0, priority: PRIORITIES.includes(t.priority) ? t.priority : "normal",
          repeat: REPEATS.includes(t.repeat) ? t.repeat : "none", folder: "personal",
          snoozed_until: t.snoozed_until || null, reminded_at: t.reminded_at || null, done: Boolean(t.done),
          completed_at: t.completed_at || null, created_at: t.created_at || fmt(new Date()),
        });
      }
      if (d.reminders.length) d.history.push({ at: fmtSec(new Date()), type: "info", text: `Imported ${d.reminders.length} task(s) from the previous version` });
    }
  } catch { /* nothing to migrate */ }
  return d;
}
let db = loadDb();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast(`Couldn't save: ${e.message}`); }
  runHooks(hooks.afterSave);
}
// Time-based ids so items created on different devices never collide when syncing.
function uid() {
  let id = Date.now() * 100 + Math.floor(Math.random() * 100);
  if (id <= db.nextId) id = db.nextId + 1;
  db.nextId = id;
  return id;
}
const folderById = (id) => db.folders.find((f) => f.id === id) || db.folders[0];
const isPrivate = (x) => x && x.folder === "private";

function log(type, text) {
  db.history.unshift({ at: fmtSec(new Date()), type, text });
  if (db.history.length > 400) db.history.length = 400;
}

// ---------------------------------------------------------------- undo (snapshots)
const undoStack = [];
function snapshot(label) {
  undoStack.push({ label, db: JSON.stringify(db), vault: vault.data ? JSON.stringify(vault.data) : null });
  if (undoStack.length > 25) undoStack.shift();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return null;
  db = JSON.parse(s.db);
  if (s.vault && vault.key) { vault.data = JSON.parse(s.vault); sealVault(); } else save();
  render();
  return s.label;
}

// ================================================================== private vault (AES-GCM)
const vault = { key: null, data: null, timer: null, queue: Promise.resolve() };
const enc = new TextEncoder();
const dec = new TextDecoder();
function b64(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function sealVault() {
  if (!vault.key || !vault.data || !db.vault) { save(); return Promise.resolve(); }
  const key = vault.key; const json = JSON.stringify(vault.data);
  vault.queue = vault.queue.then(async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(json));
    db.vault = { ...db.vault, iv: b64(iv), data: b64(ct) };
    save();
  }).catch((e) => toast(`Couldn't encrypt private items: ${e.message}`));
  save();
  return vault.queue;
}
async function openVaultWith(key) {
  const v = db.vault;
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(v.iv) }, key, unb64(v.data));
  const data = JSON.parse(dec.decode(pt));
  data.reminders = data.reminders || {}; data.notes = data.notes || [];
  return data;
}
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
async function wrapRaw(kek, raw) {
  const iv = rand(12);
  return { iv: b64(iv), data: b64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, raw)) };
}
async function unwrapRaw(kek, w) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(w.iv) }, kek, unb64(w.data)));
}
async function useDataKey(raw) {
  vault.raw = raw;
  vault.key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function createVault(pw) {
  const raw = rand(32); const salt = rand(16); const iter = 310000;
  db.vault = { v: 2, salt: b64(salt), iter, pw: await wrapRaw(await deriveKey(pw, salt, iter), raw) };
  await useDataKey(raw);
  vault.data = { reminders: {}, notes: [] };
  await sealVault();
  log("info", "Private folder password set");
  armAutoLock();
}
async function unlockVault(pw) {
  const v = db.vault;
  const kek = await deriveKey(pw, unb64(v.salt), v.iter);
  if (v.v === 2) {
    let raw;
    try { raw = await unwrapRaw(kek, v.pw); } catch { throw new Error("Wrong password"); }
    await useDataKey(raw);
    vault.data = await openVaultWith(vault.key);
  } else {
    // version 1 encrypted the data with the password key directly: upgrade to a wrapped data key
    let data;
    try { data = await openVaultWith(kek); } catch { throw new Error("Wrong password"); }
    const raw = rand(32); const salt = rand(16);
    db.vault = { v: 2, salt: b64(salt), iter: v.iter, pw: await wrapRaw(await deriveKey(pw, salt, v.iter), raw) };
    await useDataKey(raw);
    vault.data = data;
    await sealVault();
  }
  armAutoLock();
}
async function unlockWithDataKey(raw) {
  await useDataKey(raw);
  try { vault.data = await openVaultWith(vault.key); } catch (e) { vault.key = null; vault.raw = null; throw new Error("This key no longer opens the private folder"); }
  armAutoLock();
}
async function changeVaultPassword(current, pw) {
  await unlockVault(current);
  const salt = rand(16);
  db.vault = { ...db.vault, salt: b64(salt), pw: await wrapRaw(await deriveKey(pw, salt, db.vault.iter), vault.raw) };
  await sealVault();
  log("info", "Private folder password changed");
}
function lockVault(quiet) {
  if (!vault.key) return;
  vault.key = null; vault.data = null; vault.raw = null;
  clearTimeout(vault.timer);
  if (state.view === "notes" && state.noteId && !findNote(state.noteId)) state.noteId = null;
  if (!quiet) toast("Private folder locked");
  render();
}
function armAutoLock() {
  clearTimeout(vault.timer);
  vault.timer = setTimeout(() => lockVault(), 5 * 60000);
}
const unlocked = () => Boolean(vault.key);
const pendingAfterUnlock = [];
function requireVault(then) {
  if (unlocked()) { then(); return; }
  pendingAfterUnlock.push(then);
  openVaultDialog(db.vault ? "unlock" : "setup");
}

// ================================================================== store: reminders
function rTitle(r) {
  if (!isPrivate(r)) return r.title;
  return unlocked() ? (vault.data.reminders[r.id] || {}).title || "Private reminder" : "Private reminder";
}
function rSubs(r) {
  if (!isPrivate(r)) return r.subtasks || [];
  return unlocked() ? (vault.data.reminders[r.id] || {}).subtasks || [] : [];
}
function rNotes(r) {
  if (!isPrivate(r)) return r.notes || "";
  return unlocked() ? (vault.data.reminders[r.id] || {}).notes || "" : "";
}
const canSee = (r) => !isPrivate(r) || unlocked();
function remindTime(r) {
  if (r.done) return null;
  if (r.snoozed_until) return parse(r.snoozed_until);
  const due = parse(r.due);
  return due ? addMin(due, -(r.remind_before || 0)) : null;
}
function cleanReminder(f) {
  const out = {};
  if ("title" in f) {
    const t = String(f.title || "").trim();
    if (!t) throw new Error("Please enter a title");
    out.title = t.slice(0, 200);
  }
  if ("notes" in f) out.notes = String(f.notes || "").slice(0, 4000);
  if ("due" in f) {
    if (f.due && Number.isNaN(parse(f.due)?.getTime())) throw new Error("Invalid date or time");
    out.due = f.due ? String(f.due).slice(0, 16) : null;
  }
  if ("remind_before" in f) out.remind_before = Math.max(0, Math.min(43200, Number(f.remind_before) || 0));
  if ("priority" in f) out.priority = PRIORITIES.includes(f.priority) ? f.priority : "normal";
  if ("repeat" in f) out.repeat = REPEATS.includes(f.repeat) ? f.repeat : "none";
  if ("folder" in f) out.folder = db.folders.some((x) => x.id === f.folder) ? f.folder : "personal";
  if ("nag" in f) out.nag = Boolean(f.nag);
  if ("geo" in f) out.geo = f.geo && f.geo.place ? { place: String(f.geo.place).slice(0, 60), when: f.geo.when === "leave" ? "leave" : "arrive" } : null;
  if ("subtasks" in f) out.subtasks = (Array.isArray(f.subtasks) ? f.subtasks : []).filter((x) => x && String(x.text || "").trim())
    .slice(0, 50).map((x) => ({ id: x.id || uid(), text: String(x.text).trim().slice(0, 200), done: Boolean(x.done) }));
  return out;
}
const PRIVATE_FIELDS = ["title", "notes", "subtasks"];
function hidePrivate(r, vals) { vault.data.reminders[r.id] = vals; r.title = ""; r.notes = ""; r.subtasks = []; }
function addReminder(fields) {
  const f = cleanReminder({ title: fields.title, notes: fields.notes || "", due: fields.due || null, remind_before: fields.remind_before || 0,
    priority: fields.priority || "normal", repeat: fields.repeat || "none", folder: fields.folder || "personal",
    nag: Boolean(fields.nag), geo: fields.geo || null, subtasks: fields.subtasks || [] });
  if (f.repeat !== "none" && !f.due) throw new Error("A repeating reminder needs a date and time");
  if (isPrivate(f) && !unlocked()) throw new Error("Unlock the Private folder first");
  snapshot("add reminder");
  const r = { id: uid(), ...f, att: 0, snoozed_until: null, reminded_at: null, done: false, completed_at: null, created_at: fmt(new Date()) };
  if (isPrivate(r)) hidePrivate(r, { title: r.title, notes: r.notes, subtasks: r.subtasks });
  db.reminders.push(r);
  log("created", isPrivate(r) ? "Added a private reminder" : `Added “${r.title}”`);
  persist(r);
  return r;
}
function updateReminder(id, fields) {
  const r = db.reminders.find((x) => x.id === id);
  if (!r) throw new Error("Reminder not found");
  const f = cleanReminder(fields);
  const wasPrivate = isPrivate(r);
  const toPrivate = "folder" in f ? f.folder === "private" : wasPrivate;
  if ((wasPrivate || toPrivate) && !unlocked()) throw new Error("Unlock the Private folder first");
  if ((f.repeat ?? r.repeat) !== "none" && !("due" in f ? f.due : r.due)) throw new Error("A repeating reminder needs a date and time");
  snapshot("edit reminder");
  const vals = { title: f.title ?? rTitle(r), notes: f.notes ?? rNotes(r), subtasks: f.subtasks ?? rSubs(r) };
  for (const k of PRIVATE_FIELDS) delete f[k];
  if (("due" in f && f.due !== r.due) || ("remind_before" in f && f.remind_before !== r.remind_before) || ("geo" in f)) {
    f.reminded_at = null; f.snoozed_until = null;
  }
  Object.assign(r, f);
  if (toPrivate) hidePrivate(r, vals); else {
    Object.assign(r, vals);
    if (wasPrivate) delete vault.data.reminders[r.id];
  }
  log("edited", toPrivate ? "Edited a private reminder" : `Edited “${vals.title}”`);
  persist(r, wasPrivate);
  return r;
}
function toggleSubtask(r, sid) {
  const subs = rSubs(r).map((x) => (x.id === sid ? { ...x, done: !x.done } : x));
  updateReminder(r.id, { subtasks: subs });
}
function persist(item, alsoPrivate) {
  if ((isPrivate(item) || alsoPrivate) && unlocked()) sealVault(); else save();
}
function setDone(id, done) {
  const r = db.reminders.find((x) => x.id === id);
  if (!r) return null;
  snapshot(done ? "complete" : "reopen");
  const now = new Date();
  const name = canSee(r) ? `“${rTitle(r)}”` : "a private reminder";
  if (done && r.repeat !== "none" && r.due) {
    r.due = fmt(nextOccurrence(parse(r.due), r.repeat, now));
    Object.assign(r, { reminded_at: null, snoozed_until: null, last_done: fmt(now) });
    log("completed", `Completed ${name} — next ${whenText(parse(r.due), now)}`);
  } else if (done) {
    Object.assign(r, { done: true, completed_at: fmt(now), snoozed_until: null });
    log("completed", `Completed ${name}`);
  } else {
    Object.assign(r, { done: false, completed_at: null, reminded_at: null });
    log("reopened", `Reopened ${name}`);
  }
  save();
  return r;
}
function snoozeUntil(id, date) {
  const r = db.reminders.find((x) => x.id === id);
  if (!r) return null;
  snapshot("snooze");
  Object.assign(r, { snoozed_until: fmt(date), reminded_at: null });
  log("snoozed", `Snoozed ${canSee(r) ? `“${rTitle(r)}”` : "a private reminder"} until ${whenText(date, new Date())}`);
  save();
  return r;
}
function smartSnoozeOptions(now = new Date()) {
  const at = (d, hh, mm = 0) => { const x = new Date(d); x.setHours(hh, mm, 0, 0); return x; };
  const o = [["10 minutes", addMin(now, 10)], ["30 minutes", addMin(now, 30)], ["1 hour", addMin(now, 60)]];
  if (now < at(now, 13)) o.push(["After lunch", at(now, 14)]);
  if (now < at(now, 17, 30)) o.push(["This evening", at(now, 18)]);
  if (now < at(now, 20, 30)) o.push(["Tonight", at(now, 21)]);
  const tm = new Date(now); tm.setDate(tm.getDate() + 1); o.push(["Tomorrow morning", at(tm, 9)]);
  const nw = new Date(now); nw.setDate(nw.getDate() + (((8 - nw.getDay()) % 7) || 7)); o.push(["Next Monday", at(nw, 9)]);
  return o;
}
function openSnoozeMenu(anchor, id, after) {
  closeMenus();
  const rect = anchor.getBoundingClientRect();
  const menu = h("div", { class: "menu", role: "menu" },
    h("div", { class: "menu-title" }, "Snooze until"),
    smartSnoozeOptions().map(([label, d]) => h("button", { role: "menuitem", onclick: () => { closeMenus(); snoozeUntil(id, d); toast(`Snoozed until ${whenText(d, new Date())}`, true); if (after) after(); render(); } },
      h("span", {}, label), h("span", { class: "muted small" }, dayDiff(d, new Date()) === 0 ? timeText(d) : `${dayLabel(d, new Date())} ${timeText(d)}`))));
  document.body.append(menu);
  const w = 280; const left = Math.min(window.innerWidth - w - 8, Math.max(8, rect.right - w));
  const top = rect.bottom + 6 + menu.offsetHeight > window.innerHeight ? Math.max(8, rect.top - menu.offsetHeight - 6) : rect.bottom + 6;
  menu.style.cssText = `left:${left}px;top:${top}px;width:${w}px`;
  setTimeout(() => document.addEventListener("pointerdown", menuAway), 0);
}
function menuAway(e) { if (!e.target.closest(".menu")) closeMenus(); }
function closeMenus() { $$(".menu").forEach((m) => m.remove()); document.removeEventListener("pointerdown", menuAway); }
function snooze(id, minutes) {
  const r = db.reminders.find((x) => x.id === id);
  if (!r) return null;
  snapshot("snooze");
  Object.assign(r, { snoozed_until: fmt(addMin(new Date(), minutes)), reminded_at: null });
  log("snoozed", `Snoozed ${canSee(r) ? `“${rTitle(r)}”` : "a private reminder"} for ${minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}`);
  save();
  return r;
}
function removeReminder(id) {
  const r = db.reminders.find((x) => x.id === id);
  if (!r) return;
  if (isPrivate(r) && !unlocked()) throw new Error("Unlock the Private folder first");
  snapshot("delete reminder");
  db.reminders = db.reminders.filter((x) => x.id !== id);
  log("deleted", isPrivate(r) ? "Deleted a private reminder" : `Deleted “${r.title}”`);
  if (isPrivate(r)) { delete vault.data.reminders[id]; sealVault(); } else save();
}
function dueNow() {
  const now = new Date();
  const fired = db.reminders.filter((r) => {
    if (r.done) return false;
    const t = remindTime(r);
    if (!t || t > now) return false;
    if (!r.reminded_at) return true;
    return Boolean(r.nag) && now - parse(r.reminded_at) >= NAG_MS; // nagging: again every 5 minutes until done
  });
  if (fired.length) { for (const r of fired) r.reminded_at = fmtSec(now); save(); }
  return fired;
}

// ---------------------------------------------------------------- store: todos, board, notes
function addTodo(text) {
  text = String(text || "").trim();
  if (!text) throw new Error("Type something to add");
  snapshot("add to-do");
  const t = { id: uid(), text: text.slice(0, 300), done: false, created_at: fmt(new Date()), completed_at: null };
  db.todos.push(t);
  log("created", `Added to-do “${t.text}”`);
  save();
  return t;
}
function toggleTodo(id) {
  const t = db.todos.find((x) => x.id === id); if (!t) return;
  snapshot("toggle to-do");
  t.done = !t.done; t.completed_at = t.done ? fmt(new Date()) : null;
  if (t.done) log("completed", `Checked off “${t.text}”`);
  save();
}
function addCard(title, status = "todo", extra = {}) {
  title = String(title || "").trim();
  if (!title) throw new Error("Give the card a name");
  snapshot("add card");
  const c = { id: uid(), title: title.slice(0, 200), status, priority: extra.priority || "normal", due: extra.due || null, created_at: fmt(new Date()), completed_at: null };
  db.board.push(c);
  log("created", `Added “${c.title}” to Things to Do`);
  save();
  return c;
}
function moveCard(id, status) {
  const c = db.board.find((x) => x.id === id); if (!c || c.status === status) return;
  snapshot("move card");
  c.status = status; c.completed_at = status === "done" ? fmt(new Date()) : null;
  log(status === "done" ? "completed" : "edited", `Moved “${c.title}” to ${BOARD_COLS.find((x) => x.id === status).name}`);
  save();
}
const allNotes = () => [...db.notes, ...(unlocked() ? vault.data.notes : [])];
const findNote = (id) => allNotes().find((n) => n.id === id);
function addNote({ title = "", body = "", folder = "personal" } = {}) {
  if (folder === "private" && !unlocked()) throw new Error("Unlock the Private folder first");
  snapshot("add note");
  const now = fmt(new Date());
  const n = { id: uid(), title: String(title).slice(0, 200), body: String(body), folder, pinned: false, created_at: now, updated_at: now };
  if (folder === "private") { vault.data.notes.push(n); sealVault(); } else { db.notes.push(n); save(); }
  log("created", folder === "private" ? "Added a private note" : `Added note “${n.title || "Untitled"}”`);
  return n;
}
let noteSaveTimer = null;
function updateNote(id, fields, quiet) {
  const n = findNote(id); if (!n) return;
  const was = n.folder;
  if ("folder" in fields && fields.folder !== was) {
    if ((fields.folder === "private" || was === "private") && !unlocked()) { toast("Unlock the Private folder first"); return; }
    snapshot("move note");
    if (was === "private") vault.data.notes = vault.data.notes.filter((x) => x.id !== id); else db.notes = db.notes.filter((x) => x.id !== id);
    if (fields.folder === "private") vault.data.notes.push(n); else db.notes.push(n);
  }
  Object.assign(n, fields, { updated_at: fmt(new Date()) });
  if (!quiet) log("edited", n.folder === "private" ? "Edited a private note" : `Edited note “${n.title || "Untitled"}”`);
  if (n.folder === "private" || was === "private") {
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(() => sealVault(), quiet ? 400 : 0);
    save();
  } else save();
}
function removeNote(id) {
  const n = findNote(id); if (!n) return;
  snapshot("delete note");
  if (n.folder === "private") { vault.data.notes = vault.data.notes.filter((x) => x.id !== id); sealVault(); } else { db.notes = db.notes.filter((x) => x.id !== id); save(); }
  log("deleted", n.folder === "private" ? "Deleted a private note" : `Deleted note “${n.title || "Untitled"}”`);
  if (state.noteId === id) state.noteId = null;
}

// ================================================================== view state
const state = { view: db.settings.lastView || "today", prevView: "today", search: "", showDone: false, noteId: null, histTab: "completed", composer: "" };
const BOARD_COLS = [
  { id: "todo", name: "To Do", color: "#64748b" },
  { id: "doing", name: "In Progress", color: "#3b82f6" },
  { id: "done", name: "Done", color: "#10b981" },
];
const SMART = [
  { id: "today", name: "Today", icon: "today", color: "#3b82f6" },
  { id: "scheduled", name: "Scheduled", icon: "scheduled", color: "#ef4444" },
  { id: "all", name: "All", icon: "all", color: "#475569" },
  { id: "overdue", name: "Overdue", icon: "overdue", color: "#f97316" },
  { id: "flagged", name: "Flagged", icon: "flagged", color: "#eab308" },
  { id: "history", name: "History", icon: "history", color: "#8b5cf6" },
];
const WORKSPACE = [
  { id: "todo", name: "To-Do List", icon: "todo", color: "#10b981" },
  { id: "board", name: "Things to Do", icon: "board", color: "#06b6d4" },
  { id: "notes", name: "Notepad", icon: "notes", color: "#eab308" },
];

function openReminders() { return db.reminders.filter((r) => !r.done && canSee(r)); }
function counts(now) {
  const open = openReminders();
  return {
    today: open.filter((r) => r.due && dayDiff(parse(r.due), now) === 0).length,
    scheduled: open.filter((r) => r.due).length,
    all: open.length,
    overdue: open.filter((r) => r.due && parse(r.due) < now).length,
    flagged: open.filter((r) => r.priority === "high").length,
    history: db.reminders.filter((r) => r.done && canSee(r)).length,
    todo: db.todos.filter((t) => !t.done).length,
    board: db.board.filter((c) => c.status !== "done").length,
    notes: allNotes().length,
  };
}

function setView(v) {
  state.view = v;
  if (v !== "search") { db.settings.lastView = v; save(); }
  state.showDone = false;
  closeSidebar();
  render();
  $("#view").scrollTop = 0;
}

// ================================================================== rendering: sidebar
function renderSidebar(now = new Date()) {
  const c = counts(now);
  const nav = $("#nav");
  const tile = (s) => h("button", { class: `tile${state.view === s.id ? " on" : ""}`, style: `--c:${s.color}`, onclick: () => setView(s.id), "aria-label": `${s.name}, ${c[s.id]}` },
    h("span", { class: "tile-icon" }, icon(s.icon, 16)), h("span", { class: "tile-count" }, String(c[s.id] ?? "")), h("span", { class: "tile-name" }, s.name));
  const row = (id, name, ic, color, count, extra) => h("button", { class: `nav-row${state.view === id ? " on" : ""}`, style: `--c:${color}`, onclick: () => setView(id) },
    h("span", { class: "nav-icon" }, icon(ic, 16)), h("span", { class: "nav-name" }, name), extra || null, count ? h("span", { class: "nav-count" }, String(count)) : null);

  const folders = db.folders.map((f) => {
    const n = f.id === "private" && !unlocked() ? 0 : db.reminders.filter((r) => !r.done && r.folder === f.id).length;
    const lock = f.id === "private" ? h("span", { class: "nav-lock", title: unlocked() ? "Unlocked" : "Locked" }, icon(unlocked() ? "unlock" : "lock", 13)) : null;
    const r = row(`folder:${f.id}`, f.name, f.icon || "folder", f.color, n, lock);
    if (!f.builtin) {
      r.append(h("span", { class: "nav-edit", role: "button", tabindex: "0", title: "Edit folder", "aria-label": `Edit ${f.name}`, onclick: (e) => { e.stopPropagation(); openFolderDialog(f); } }, icon("more", 14)));
    }
    return r;
  });

  nav.replaceChildren(...[
    h("div", { class: "tiles" }, SMART.map(tile)),
    h("div", { class: "nav-label" }, "Workspace"),
    WORKSPACE.map((w) => row(w.id, w.name, w.icon, w.color, c[w.id] ?? (w.count ? w.count(now) : null))),
    h("div", { class: "nav-label" }, "Folders", h("button", { class: "nav-add", title: "New folder", "aria-label": "New folder", onclick: () => openFolderDialog() }, icon("plus", 14))),
    folders,
  ].flat());
}

// ================================================================== rendering: main
function viewMeta(v) {
  const s = [...SMART, ...WORKSPACE].find((x) => x.id === v);
  if (s) return { title: s.name, icon: s.icon, color: s.color };
  if (v.startsWith("folder:")) { const f = folderById(v.slice(7)); return { title: f.name, icon: f.icon || "folder", color: f.color }; }
  if (v === "search") return { title: "Search", icon: "search", color: "#475569" };
  return { title: "Reminders", icon: "all", color: "#475569" };
}

function render() {
  const now = new Date();
  renderSidebar(now);
  const meta = viewMeta(state.view);
  $("#viewTitle").textContent = meta.title;
  const vi = $("#viewIcon"); vi.style.setProperty("--c", meta.color); vi.replaceChildren(icon(meta.icon, 20));
  const c = counts(now);
  document.title = c.overdue ? `(${c.overdue}) Nudge` : "Nudge";
  $("#newBtn").lastElementChild.textContent = { todo: "New to-do", board: "New card", notes: "New note" }[state.view] || "New reminder";
  renderView(now);
}

function renderView(now = new Date()) {
  const v = state.view;
  const root = $("#view");
  let content; let sub = "";
  if (v === "todo") [content, sub] = viewTodo();
  else if (v === "board") [content, sub] = viewBoard(now);
  else if (v === "notes") [content, sub] = viewNotes(now);
  else if (v === "history") [content, sub] = viewHistory(now);
  else if (v === "search") [content, sub] = viewSearch(now);
  else if (VIEWS[v]) [content, sub] = VIEWS[v](now);
  else [content, sub] = viewReminders(v, now);
  $("#viewSub").textContent = sub;
  root.replaceChildren(content);
  root.dataset.view = v.split(":")[0];
}

// ---------------------------------------------------------------- reminders
function reminderFilter(v, now) {
  const open = (r) => !r.done && canSee(r);
  if (v === "today") return (r) => open(r) && r.due && dayDiff(parse(r.due), now) <= 0;
  if (v === "scheduled") return (r) => open(r) && r.due;
  if (v === "overdue") return (r) => open(r) && r.due && parse(r.due) < now;
  if (v === "flagged") return (r) => open(r) && r.priority === "high";
  if (v.startsWith("folder:")) { const id = v.slice(7); return (r) => r.folder === id && !r.done && canSee(r); }
  return open;
}
const byDue = (a, b) => ((a.due === null) - (b.due === null)) || String(a.due).localeCompare(String(b.due)) || a.id - b.id;

function groupReminders(v, list, now) {
  const groups = new Map();
  const put = (k, r) => { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); };
  for (const r of list) {
    const due = parse(r.due);
    if (v === "today") {
      if (dayDiff(due, now) < 0) put("Overdue", r);
      else put(due.getHours() < 12 ? "Morning" : due.getHours() < 17 ? "Afternoon" : "Tonight", r);
    } else if (v === "scheduled") {
      put(due < now && dayDiff(due, now) < 0 ? "Overdue" : dayLabel(due, now), r);
    } else if (v === "overdue") {
      put(dayDiff(due, now) === 0 ? "Earlier today" : dayLabel(due, now), r);
    } else {
      if (!due) put("No date", r);
      else if (due < now) put("Overdue", r);
      else { const d = dayDiff(due, now); put(d === 0 ? "Today" : d === 1 ? "Tomorrow" : d < 7 ? "This week" : "Later", r); }
    }
  }
  if (v === "today") {
    const order = ["Overdue", "Morning", "Afternoon", "Tonight"];
    return new Map(order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)]));
  }
  if (!["scheduled", "overdue"].includes(v)) {
    const order = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date"];
    return new Map(order.filter((k) => groups.has(k)).map((k) => [k, groups.get(k)]));
  }
  return groups;
}

function viewReminders(v, now) {
  if (v === "folder:private" && !unlocked()) return [lockedScreen(), "Locked"];
  const list = db.reminders.filter(reminderFilter(v, now)).sort(byDue);
  const groups = groupReminders(v, list, now);
  const wrap = h("div", { class: "rem-view" });
  wrap.append(composer(v, now));
  if (!list.length) wrap.append(emptyState(v));
  for (const [name, items] of groups) {
    wrap.append(h("section", { class: `group g-${name.toLowerCase().replace(/\s+/g, "-")}` },
      h("h3", { class: "group-title" }, name, h("span", { class: "group-count" }, String(items.length))),
      h("div", { class: "card list" }, items.map((r) => reminderRow(r, now)))));
  }
  if (v.startsWith("folder:")) {
    const done = db.reminders.filter((r) => r.folder === v.slice(7) && r.done && canSee(r));
    if (done.length) {
      wrap.append(h("button", { class: "link-btn", onclick: () => { state.showDone = !state.showDone; renderView(); } },
        state.showDone ? `Hide completed (${done.length})` : `Show completed (${done.length})`));
      if (state.showDone) wrap.append(h("div", { class: "card list" }, done.map((r) => reminderRow(r, now))));
    }
  }
  const overdue = list.filter((r) => r.due && parse(r.due) < now).length;
  const sub = list.length ? `${list.length} reminder${list.length > 1 ? "s" : ""}${overdue && v !== "overdue" ? ` · ${overdue} overdue` : ""}` : "All clear";
  return [wrap, sub];
}

function emptyState(v) {
  const msg = {
    today: ["Nothing due today", "Enjoy your day — or say “Remind me to…”"],
    overdue: ["You're all caught up", "No overdue reminders."],
    flagged: ["No flagged reminders", "Say “… it's urgent” or set priority to High."],
    scheduled: ["Nothing scheduled", "Reminders with a date show up here."],
  }[v] || ["No reminders", "Add one above or tap the mic."];
  return h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon(viewMeta(v).icon, 30)), h("h3", {}, msg[0]), h("p", { class: "muted" }, msg[1]));
}

function lockedScreen() {
  const has = Boolean(db.vault);
  return h("div", { class: "empty locked" },
    h("div", { class: "empty-icon lock" }, icon("lock", 34)),
    h("h3", {}, has ? "Private folder is locked" : "Protect your private reminders"),
    h("p", { class: "muted" }, has ? "Enter your password to see private reminders and notes." : "Set a password. Private reminders and notes are encrypted on this device."),
    h("button", { class: "btn primary", onclick: () => openVaultDialog(has ? "unlock" : "setup") }, icon(has ? "unlock" : "lock", 16), has ? "Unlock" : "Set password"));
}

function reminderRow(r, now) {
  const due = parse(r.due);
  const late = !r.done && due && due < now;
  const f = folderById(r.folder);
  const title = rTitle(r);
  const notes = rNotes(r);
  const meta = [];
  if (due) meta.push(h("span", { class: `chip time${late ? " late" : ""}` }, icon("clock", 12), whenText(due, now)));
  if (due && !r.done) meta.push(h("span", { class: `rel${late ? " late" : ""}` }, relative(due, now)));
  if (r.repeat !== "none") meta.push(h("span", { class: "chip" }, icon("repeat", 12), REPEAT_LABEL[r.repeat]));
  if (r.remind_before && !r.done) meta.push(h("span", { class: "chip" }, icon("bell", 12), `${r.remind_before >= 60 ? `${r.remind_before / 60} h` : `${r.remind_before} min`} before`));
  if (r.snoozed_until && !r.done) meta.push(h("span", { class: "chip" }, icon("snooze", 12), `Snoozed to ${timeText(parse(r.snoozed_until))}`));
  const subs = rSubs(r);
  if (subs.length) meta.push(h("span", { class: `chip${subs.every((x) => x.done) ? " okc" : ""}` }, icon("todo", 12), `${subs.filter((x) => x.done).length}/${subs.length}`));
  if (r.geo) meta.push(h("span", { class: "chip geo" }, icon("pin", 12), `${r.geo.when === "leave" ? "Leaving" : "Arriving at"} ${placeLabel(r.geo.place)}`));
  if (r.nag && !r.done) meta.push(h("span", { class: "chip nagc", title: "Repeats every 5 minutes until done" }, icon("repeat", 12), "Until done"));
  if (r.att) meta.push(h("span", { class: "chip" }, icon("upload", 12), `${r.att} file${r.att > 1 ? "s" : ""}`));
  for (const fn of hooks.rowChips) { try { const c = fn(r, now); if (c) meta.push(c); } catch (e) { console.warn(e); } }
  if (!state.view.startsWith("folder:")) meta.push(h("span", { class: "chip folder", style: `--c:${f.color}` }, h("i", { class: "dot" }), f.name));
  if (r.done && r.completed_at) meta.push(h("span", { class: "rel" }, `Completed ${whenText(parse(r.completed_at), now)}`));

  return h("div", { class: `rem${r.done ? " done" : ""}${late ? " late" : ""} p-${r.priority}`, style: `--c:${f.color}` },
    h("button", { class: "ring", "aria-label": r.done ? `Reopen ${title}` : `Complete ${title}`, title: r.done ? "Reopen" : r.repeat !== "none" ? "Done — move to next time" : "Mark as done",
      onclick: (e) => { const row = e.currentTarget.closest(".rem"); row.classList.add("completing"); setTimeout(() => act(() => setDone(r.id, !r.done), r.done ? null : "Completed"), r.done ? 0 : 280); } },
    icon("check", 13)),
    h("div", { class: "rem-body", onclick: () => openEditor(r), role: "button", tabindex: "0", onkeydown: (e) => { if (e.key === "Enter") openEditor(r); } },
      h("div", { class: "rem-title" }, isPrivate(r) ? icon("lock", 13) : null, title, r.priority === "high" ? h("span", { class: "flag", title: "High priority" }, icon("flagged", 13)) : null,
        r.priority === "low" ? h("span", { class: "low-tag" }, "low") : null),
      notes ? h("div", { class: "rem-notes" }, notes) : null,
      meta.length ? h("div", { class: "rem-meta" }, meta) : null),
    h("div", { class: "rem-actions" },
      !r.done ? h("button", { class: "icon-btn sm", title: "Snooze…", "aria-label": "Snooze", onclick: (e) => openSnoozeMenu(e.currentTarget, r.id) }, icon("snooze", 15)) : null,
      h("button", { class: "icon-btn sm", title: "Edit", "aria-label": `Edit ${title}`, onclick: () => openEditor(r) }, icon("edit", 15)),
      h("button", { class: "icon-btn sm danger", title: "Delete", "aria-label": `Delete ${title}`, onclick: () => act(() => removeReminder(r.id), "Reminder deleted") }, icon("trash", 15))));
}

// The smart "add" bar: natural language with a live preview of what was understood.
function findPlace(name) {
  if (!name) return null;
  const n = String(name).toLowerCase();
  return db.places.find((p) => p.id === name || p.name.toLowerCase() === n) || null;
}
const placeLabel = (name) => { const p = findPlace(name); return p ? p.name : String(name).replace(/^\w/, (c) => c.toUpperCase()); };
function parseReminderText(text, v) {
  const t = text.trim();
  const explicit = /^(?:remind|set|create|add|wake|don'?t|remember)\b/i.test(t);
  const p = NLP.parse(explicit ? t : `remind me to ${t}`, new Date(), nlpOpts());
  if (p.intent !== "reminder") return null;
  if (!p.folder && v.startsWith("folder:")) p.folder = v.slice(7);
  if (!p.due && v === "today") { const d = new Date(Date.now() + 3600000); d.setMinutes(0, 0, 0); p.due = fmt(d); }
  if (!p.title) p.title = t;
  return p;
}
const dateOrder = () => (/^en-US/i.test(navigator.language || "") ? "mdy" : "dmy");
const nlpOpts = () => ({ folders: db.folders, places: db.places, dateOrder: dateOrder() });

function composer(v, now) {
  const input = h("input", { class: "composer-input", placeholder: "Add a reminder — try “Pay rent on the 1st at 10am #work”", value: state.composer, "aria-label": "New reminder", maxlength: "300" });
  const preview = h("div", { class: "composer-preview" });
  const update = () => {
    state.composer = input.value;
    preview.replaceChildren();
    const t = input.value.trim();
    if (!t) return;
    const p = parseReminderText(t, v);
    if (!p) return;
    const chips = [h("span", { class: "chip strong" }, p.title)];
    if (p.due) chips.push(h("span", { class: "chip" }, icon("clock", 12), whenText(parse(p.due), new Date())));
    if (p.repeat !== "none") chips.push(h("span", { class: "chip" }, icon("repeat", 12), REPEAT_LABEL[p.repeat]));
    if (p.folder) { const f = folderById(p.folder); chips.push(h("span", { class: "chip folder", style: `--c:${f.color}` }, h("i", { class: "dot" }), f.name)); }
    if (p.priority === "high") chips.push(h("span", { class: "chip flagc" }, icon("flagged", 12), "High"));
    if (p.remind_before) chips.push(h("span", { class: "chip" }, icon("bell", 12), `${p.remind_before} min before`));
    preview.append(...chips);
  };
  const submit = (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) { input.focus(); return; }
    const p = parseReminderText(t, v) || { title: t, due: null, repeat: "none" };
    const fields = { title: p.title, due: p.due, repeat: p.repeat, priority: p.priority || "normal", folder: p.folder || "personal", remind_before: p.remind_before || 0, nag: p.nag, geo: p.geo };
    const go = () => {
      try {
        addReminder(fields);
        state.composer = "";
        render();
        toast(`Added “${fields.title}”${fields.due ? ` · ${whenText(parse(fields.due), new Date())}` : ""}`, true);
        $(".composer-input")?.focus();
      } catch (err) { toast(err.message); }
    };
    if (fields.folder === "private") requireVault(go); else go();
  };
  input.addEventListener("input", update);
  queueMicrotask(update);
  return h("form", { class: "composer card", onsubmit: submit },
    h("div", { class: "composer-row" },
      h("span", { class: "composer-plus" }, icon("plus", 18)), input,
      h("button", { type: "button", class: "icon-btn", title: "More options", "aria-label": "More options", onclick: () => {
        const p = input.value.trim() ? parseReminderText(input.value, v) : null;
        openEditor(null, p ? { title: p.title, due: p.due, repeat: p.repeat, priority: p.priority || "normal", folder: p.folder || defaultFolder(), remind_before: p.remind_before || 0 } : { folder: defaultFolder() });
      } }, icon("more", 16)),
      h("button", { class: "btn primary sm" }, "Add")),
    preview);
}
const defaultFolder = () => (state.view.startsWith("folder:") ? state.view.slice(7) : "personal");

// ---------------------------------------------------------------- to-do list
function viewTodo() {
  const items = db.todos;
  const done = items.filter((t) => t.done).length;
  const input = h("input", { placeholder: "Add a to-do and press Enter", "aria-label": "New to-do", maxlength: "300" });
  const form = h("form", { class: "todo-add", onsubmit: (e) => { e.preventDefault(); try { addTodo(input.value); input.value = ""; renderAll(); $(".todo-add input")?.focus(); } catch (err) { toast(err.message); } } },
    h("span", { class: "composer-plus" }, icon("plus", 18)), input, h("button", { class: "btn primary sm" }, "Add"));
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  let dragId = null;
  const list = h("div", { class: "card list todo-list" }, items.map((t) => {
    const text = h("span", { class: "todo-text", title: "Double-click to edit" }, t.text);
    const row = h("div", { class: `todo${t.done ? " done" : ""}`, draggable: "true", "data-id": t.id },
      h("span", { class: "grip", "aria-hidden": "true" }, icon("grip", 14)),
      h("button", { class: "box", "aria-label": t.done ? `Uncheck ${t.text}` : `Check ${t.text}`, onclick: () => { toggleTodo(t.id); renderAll(); } }, icon("check", 13)),
      text,
      h("button", { class: "icon-btn sm", title: "Edit", "aria-label": `Edit ${t.text}`, onclick: () => editInline(text, t.text, (val) => { snapshot("edit to-do"); t.text = val; save(); renderAll(); }) }, icon("edit", 14)),
      h("button", { class: "icon-btn sm danger", title: "Delete", "aria-label": `Delete ${t.text}`, onclick: () => { snapshot("delete to-do"); db.todos = db.todos.filter((x) => x !== t); log("deleted", `Deleted to-do “${t.text}”`); save(); renderAll(); toast("To-do deleted", true); } }, icon("trash", 14)));
    text.addEventListener("dblclick", () => editInline(text, t.text, (val) => { snapshot("edit to-do"); t.text = val; save(); renderAll(); }));
    row.addEventListener("dragstart", (e) => { dragId = t.id; row.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drop-target"); });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault(); row.classList.remove("drop-target");
      if (dragId == null || dragId === t.id) return;
      snapshot("reorder");
      const from = db.todos.findIndex((x) => x.id === dragId); const [m] = db.todos.splice(from, 1);
      db.todos.splice(db.todos.findIndex((x) => x.id === t.id), 0, m); save(); renderAll();
    });
    return row;
  }));
  const wrap = h("div", { class: "todo-view" },
    h("div", { class: "card progress-card" },
      h("div", { class: "progress-text" }, h("strong", {}, `${done} of ${items.length}`), h("span", { class: "muted" }, " completed")),
      h("div", { class: "progress" }, h("div", { class: "bar", style: `width:${pct}%` })),
      h("span", { class: "pct" }, `${pct}%`)),
    h("div", { class: "card composer" }, form),
    items.length ? list : h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon("todo", 30)), h("h3", {}, "Your list is empty"), h("p", { class: "muted" }, "Add items above, or say “Add milk to my to-do list”.")),
    done ? h("button", { class: "link-btn", onclick: () => { snapshot("clear completed"); db.todos = db.todos.filter((t) => !t.done); log("deleted", `Cleared ${done} completed to-do(s)`); save(); renderAll(); toast("Cleared completed", true); } }, `Clear ${done} completed`) : null);
  return [wrap, `${items.length - done} left`];
}
function editInline(span, value, onSave) {
  const inp = h("input", { class: "inline-edit", value, maxlength: "300", "aria-label": "Edit" });
  span.replaceWith(inp); inp.focus(); inp.select();
  let doneFlag = false;
  const finish = (ok) => { if (doneFlag) return; doneFlag = true; const v = inp.value.trim(); if (ok && v && v !== value) onSave(v); else renderAll(); };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); });
  inp.addEventListener("blur", () => finish(true));
}

// ---------------------------------------------------------------- things to do (board)
function viewBoard(now) {
  const cols = BOARD_COLS.map((col) => {
    const cards = db.board.filter((c) => c.status === col.id);
    const input = h("input", { placeholder: "+ Add a card", "aria-label": `Add card to ${col.name}`, maxlength: "200" });
    const colEl = h("section", { class: "col", style: `--c:${col.color}`, "data-status": col.id },
      h("header", { class: "col-head" }, h("i", { class: "dot" }), h("span", {}, col.name), h("span", { class: "col-count" }, String(cards.length))),
      h("form", { class: "col-add", onsubmit: (e) => { e.preventDefault(); try { addCard(input.value, col.id); input.value = ""; renderAll(); $(`.col[data-status="${col.id}"] .col-add input`)?.focus(); } catch (err) { toast(err.message); } } }, input),
      h("div", { class: "col-cards" }, cards.map((c) => boardCard(c, col, now)), cards.length ? null : h("div", { class: "col-empty" }, "Drop cards here")));
    colEl.addEventListener("dragover", (e) => { e.preventDefault(); colEl.classList.add("drop-target"); });
    colEl.addEventListener("dragleave", (e) => { if (!colEl.contains(e.relatedTarget)) colEl.classList.remove("drop-target"); });
    colEl.addEventListener("drop", (e) => { e.preventDefault(); colEl.classList.remove("drop-target"); const id = Number(e.dataTransfer.getData("text/plain")); if (id) { moveCard(id, col.id); renderAll(); } });
    return colEl;
  });
  const open = db.board.filter((c) => c.status !== "done").length;
  return [h("div", { class: "board" }, cols), `${open} open · ${db.board.length - open} done`];
}
function boardCard(c, col, now) {
  const idx = BOARD_COLS.findIndex((x) => x.id === c.status);
  const title = h("div", { class: "bc-title" }, c.title);
  const el = h("article", { class: `bcard p-${c.priority}`, draggable: "true" },
    title,
    h("div", { class: "bc-foot" },
      c.due ? h("span", { class: `chip${parse(c.due) < now && c.status !== "done" ? " late" : ""}` }, icon("clock", 12), whenText(parse(c.due), now)) : h("span", { class: "muted small" }, dayLabel(parse(c.created_at), now)),
      h("span", { class: "spacer" }),
      idx > 0 ? h("button", { class: "icon-btn xs", title: `Move to ${BOARD_COLS[idx - 1].name}`, "aria-label": "Move left", onclick: () => { moveCard(c.id, BOARD_COLS[idx - 1].id); renderAll(); } }, icon("left", 14)) : null,
      idx < 2 ? h("button", { class: "icon-btn xs", title: `Move to ${BOARD_COLS[idx + 1].name}`, "aria-label": "Move right", onclick: () => { moveCard(c.id, BOARD_COLS[idx + 1].id); renderAll(); } }, icon("right", 14)) : null,
      hooks.cardActions.map((fn) => { try { return fn(c); } catch { return null; } }),
      h("button", { class: "icon-btn xs", title: c.priority === "high" ? "Unflag" : "Flag as high priority", "aria-label": "Toggle priority", onclick: () => { snapshot("flag"); c.priority = c.priority === "high" ? "normal" : "high"; save(); renderAll(); } }, icon("flagged", 13)),
      h("button", { class: "icon-btn xs danger", title: "Delete", "aria-label": `Delete ${c.title}`, onclick: () => { snapshot("delete card"); db.board = db.board.filter((x) => x !== c); log("deleted", `Deleted card “${c.title}”`); save(); renderAll(); toast("Card deleted", true); } }, icon("trash", 13))));
  title.addEventListener("dblclick", () => editInline(title, c.title, (v) => { snapshot("rename card"); c.title = v; save(); renderAll(); }));
  el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(c.id)); el.classList.add("dragging"); });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  return el;
}

// ---------------------------------------------------------------- notepad
function viewNotes(now) {
  const q = (state.noteQuery || "").toLowerCase();
  const notes = allNotes().filter((n) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || b.updated_at.localeCompare(a.updated_at));
  if (state.noteId && !findNote(state.noteId)) state.noteId = null;
  const current = state.noteId ? findNote(state.noteId) : null;
  const lockedCount = !unlocked() && db.vault ? "Private notes are locked" : null;

  const search = h("input", { type: "search", placeholder: "Search notes", value: state.noteQuery || "", "aria-label": "Search notes",
    oninput: (e) => { state.noteQuery = e.target.value; const pos = e.target.selectionStart; renderView(); const s = $(".notes-search input"); s.focus(); s.setSelectionRange(pos, pos); } });
  const listPane = h("div", { class: "notes-list card" },
    h("div", { class: "notes-search" }, icon("search", 15), search, h("button", { class: "icon-btn", title: "New note", "aria-label": "New note", onclick: () => newNote() }, icon("plus", 17))),
    h("div", { class: "notes-items" },
      notes.map((n) => {
        const f = folderById(n.folder);
        return h("button", { class: `note-item${current && current.id === n.id ? " on" : ""}`, onclick: () => { state.noteId = n.id; renderView(); } },
          h("div", { class: "ni-top" }, n.pinned ? icon("pin", 12) : null, n.folder === "private" ? icon("lock", 12) : null, h("strong", {}, n.title || firstLine(n.body) || "Untitled")),
          h("div", { class: "ni-snip" }, snippet(n)),
          h("div", { class: "ni-meta" }, h("i", { class: "dot", style: `--c:${f.color}` }), f.name, " · ", dayLabel(parse(n.updated_at), now)));
      }),
      lockedCount ? h("button", { class: "note-item locked-row", onclick: () => openVaultDialog("unlock") }, icon("lock", 14), lockedCount, " — unlock") : null,
      !notes.length && !lockedCount ? h("p", { class: "muted pad" }, q ? "No matching notes." : "No notes yet.") : null));

  let editor;
  if (current) {
    const status = h("span", { class: "muted small" }, `Edited ${whenText(parse(current.updated_at), now)}`);
    const words = h("span", { class: "muted small" }, wordCount(current.body));
    const ti = h("input", { class: "note-title", value: current.title, placeholder: "Title", maxlength: "200", "aria-label": "Note title" });
    const body = h("textarea", { class: "note-body", placeholder: "Start writing…", "aria-label": "Note text" });
    body.value = current.body;
    const saveNow = () => {
      updateNote(current.id, { title: ti.value, body: body.value }, true);
      status.textContent = "Saved"; words.textContent = wordCount(body.value);
      const item = $(".note-item.on strong"); if (item) item.textContent = ti.value || firstLine(body.value) || "Untitled";
      const snip = $(".note-item.on .ni-snip"); if (snip) snip.textContent = snippet(current);
    };
    let t;
    const debounced = () => { status.textContent = "Saving…"; clearTimeout(t); t = setTimeout(saveNow, 350); };
    ti.addEventListener("input", debounced); body.addEventListener("input", debounced);
    const folderSel = h("select", { class: "mini-select", "aria-label": "Folder", onchange: (e) => {
      const to = e.target.value;
      const go = () => { updateNote(current.id, { folder: to }); renderAll(); };
      if (to === "private" || current.folder === "private") requireVault(go); else go();
    } }, db.folders.map((f) => h("option", { value: f.id, selected: f.id === current.folder }, f.name)));
    editor = h("div", { class: "note-editor card" },
      h("div", { class: "note-toolbar" },
        h("button", { class: "icon-btn only-mobile", "aria-label": "Back to notes", onclick: () => { state.noteId = null; renderView(); } }, icon("left", 18)),
        folderSel,
        h("button", { class: "icon-btn", title: "Create a reminder from this note (select text first to use just that part)", "aria-label": "Remind me about this", onclick: () => remindFromNote(current, body) }, icon("bell", 16)),
        h("button", { class: `icon-btn${current.pinned ? " on" : ""}`, title: current.pinned ? "Unpin" : "Pin to top", "aria-label": "Pin", onclick: () => { updateNote(current.id, { pinned: !current.pinned }, true); renderView(); } }, icon("pin", 16)),
        h("span", { class: "spacer" }), words, status,
        h("button", { class: "icon-btn danger", title: "Delete note", "aria-label": "Delete note", onclick: () => { removeNote(current.id); renderAll(); toast("Note deleted", true); } }, icon("trash", 16))),
      ti, body);
    queueMicrotask(() => { if (!current.title && !current.body) ti.focus(); });
  } else {
    editor = h("div", { class: "note-editor card empty-editor" },
      h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon("notes", 30)), h("h3", {}, "Select or create a note"),
        h("p", { class: "muted" }, "Or say “Take a note …”"), h("button", { class: "btn primary", onclick: () => newNote() }, icon("plus", 16), "New note")));
  }
  return [h("div", { class: `notes${current ? " has-current" : ""}` }, listPane, editor), `${allNotes().length} note${allNotes().length === 1 ? "" : "s"}`];
}
function remindFromNote(n, ta) {
  const sel = ta && ta.selectionEnd > ta.selectionStart ? ta.value.slice(ta.selectionStart, ta.selectionEnd).trim() : "";
  const text = sel || n.title || firstLine(n.body) || "Note";
  const p = parseReminderText(text.slice(0, 300), "all") || { title: text };
  openEditor(null, { title: p.title || text, due: p.due || null, repeat: p.repeat || "none", priority: p.priority || "normal",
    folder: n.folder === "private" ? "private" : n.folder, notes: `From note “${n.title || firstLine(n.body) || "Untitled"}”${sel && sel !== p.title ? `\n${sel}` : ""}` });
}
const firstLine = (s) => String(s || "").split("\n").find((l) => l.trim())?.trim().slice(0, 60) || "";
const snippet = (n) => String(n.body || "").replace(/\s+/g, " ").slice(n.title ? 0 : firstLine(n.body).length, 120).trim() || "No additional text";
const wordCount = (s) => { const n = (String(s).match(/\S+/g) || []).length; return `${n} word${n === 1 ? "" : "s"}`; };
function newNote(folder) {
  folder = folder || (state.view.startsWith("folder:") ? state.view.slice(7) : "personal");
  const go = () => { const n = addNote({ folder }); state.noteId = n.id; if (state.view !== "notes") setView("notes"); else renderAll(); };
  if (folder === "private") requireVault(go); else go();
}

// ---------------------------------------------------------------- history
function viewHistory(now) {
  const tabs = h("div", { class: "segmented", role: "tablist" },
    [["completed", "Completed"], ["activity", "Activity"]].map(([id, name]) =>
      h("button", { role: "tab", "aria-selected": String(state.histTab === id), class: state.histTab === id ? "on" : "", onclick: () => { state.histTab = id; renderView(); } }, name)));
  const wrap = h("div", { class: "history" }, tabs);
  if (state.histTab === "completed") {
    const items = [
      ...db.reminders.filter((r) => r.done && canSee(r)).map((r) => ({ at: r.completed_at, kind: "Reminder", title: rTitle(r), color: folderById(r.folder).color,
        reopen: () => act(() => setDone(r.id, false), "Reopened"), del: () => act(() => removeReminder(r.id), "Deleted") })),
      ...db.todos.filter((t) => t.done).map((t) => ({ at: t.completed_at, kind: "To-do", title: t.text, color: "#10b981",
        reopen: () => { toggleTodo(t.id); renderAll(); }, del: () => { snapshot("delete"); db.todos = db.todos.filter((x) => x !== t); save(); renderAll(); } })),
      ...db.board.filter((c) => c.status === "done").map((c) => ({ at: c.completed_at || c.created_at, kind: "Things to Do", title: c.title, color: "#06b6d4",
        reopen: () => { moveCard(c.id, "todo"); renderAll(); }, del: () => { snapshot("delete"); db.board = db.board.filter((x) => x !== c); save(); renderAll(); } })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (!items.length) wrap.append(h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon("history", 30)), h("h3", {}, "Nothing completed yet"), h("p", { class: "muted" }, "Completed reminders, to-dos and cards appear here.")));
    const groups = new Map();
    for (const it of items) { const k = it.at ? dayLabel(parse(it.at), now) : "Earlier"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    for (const [k, list] of groups) {
      wrap.append(h("h3", { class: "group-title" }, k, h("span", { class: "group-count" }, String(list.length))),
        h("div", { class: "card list" }, list.map((it) => h("div", { class: "hist-row", style: `--c:${it.color}` },
          h("span", { class: "hist-check" }, icon("check", 12)),
          h("div", { class: "hist-body" }, h("div", { class: "hist-title" }, it.title), h("div", { class: "muted small" }, `${it.kind}${it.at ? ` · ${timeText(parse(it.at))}` : ""}`)),
          h("button", { class: "btn ghost sm", onclick: it.reopen }, "Reopen"),
          h("button", { class: "icon-btn sm danger", "aria-label": "Delete", title: "Delete", onclick: it.del }, icon("trash", 14))))));
    }
    return [wrap, `${items.length} completed`];
  }
  const ICON_FOR = { created: "plus", completed: "check", deleted: "trash", snoozed: "snooze", edited: "edit", reopened: "undo", info: "sparkles", reminded: "bell" };
  const groups = new Map();
  for (const e of db.history) { const k = dayLabel(parse(e.at), now); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  if (!db.history.length) wrap.append(h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon("history", 30)), h("h3", {}, "No activity yet")));
  for (const [k, list] of groups) {
    wrap.append(h("h3", { class: "group-title" }, k),
      h("div", { class: "card timeline" }, list.map((e) => h("div", { class: `tl-row t-${e.type}` },
        h("span", { class: "tl-icon" }, icon(ICON_FOR[e.type] || "clock", 13)),
        h("span", { class: "tl-text" }, e.text), h("span", { class: "muted small" }, timeText(parse(e.at)))))));
  }
  if (db.history.length) wrap.append(h("button", { class: "link-btn", onclick: () => { if (confirm("Clear the activity log?")) { db.history = []; save(); renderView(); } } }, "Clear activity log"));
  return [wrap, `${db.history.length} events`];
}

// ---------------------------------------------------------------- search
function viewSearch(now) {
  const q = state.search.trim().toLowerCase();
  const has = (s) => String(s || "").toLowerCase().includes(q);
  const rem = db.reminders.filter((r) => canSee(r) && (has(rTitle(r)) || has(rNotes(r)))).sort(byDue);
  const todos = db.todos.filter((t) => has(t.text));
  const cards = db.board.filter((c) => has(c.title));
  const notes = allNotes().filter((n) => has(n.title) || has(n.body));
  const wrap = h("div", { class: "search-view" });
  const sec = (name, n, body) => n ? wrap.append(h("h3", { class: "group-title" }, name, h("span", { class: "group-count" }, String(n))), body) : null;
  sec("Reminders", rem.length, h("div", { class: "card list" }, rem.map((r) => reminderRow(r, now))));
  sec("To-dos", todos.length, h("div", { class: "card list" }, todos.map((t) => h("button", { class: "search-row", onclick: () => setView("todo") }, icon("todo", 15), t.text, t.done ? h("span", { class: "chip" }, "done") : null))));
  sec("Things to Do", cards.length, h("div", { class: "card list" }, cards.map((c) => h("button", { class: "search-row", onclick: () => setView("board") }, icon("board", 15), c.title, h("span", { class: "chip" }, BOARD_COLS.find((x) => x.id === c.status).name)))));
  sec("Notes", notes.length, h("div", { class: "card list" }, notes.map((n) => h("button", { class: "search-row", onclick: () => { state.noteId = n.id; state.search = ""; $("#search").value = ""; setView("notes"); } }, icon("notes", 15), n.title || firstLine(n.body) || "Untitled"))));
  const total = rem.length + todos.length + cards.length + notes.length;
  if (!total) wrap.append(h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon("search", 30)), h("h3", {}, `No results for “${state.search}”`)));
  return [wrap, `${total} result${total === 1 ? "" : "s"}`];
}

function renderAll() { render(); }
function act(fn, msg) {
  try { fn(); if (msg) toast(msg, true); } catch (e) { toast(e.message); }
  render();
}

// ================================================================== toast
let toastTimer;
function toast(text, withUndo) {
  const t = $("#toast");
  fill(t, h("span", {}, text), withUndo && undoStack.length ? h("button", { class: "toast-undo", onclick: () => { const l = undo(); t.hidden = true; if (l) toast(`Undid ${l}`); } }, "Undo") : null);
  t.hidden = false; t.classList.remove("out");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add("out"); setTimeout(() => { t.hidden = true; }, 250); }, withUndo ? 5000 : 3200);
}

// ================================================================== editor dialog
let editing = null;
function fillFolderSelect(sel, value) {
  sel.replaceChildren(...db.folders.map((f) => h("option", { value: f.id, selected: f.id === value }, f.name)));
}
function openEditor(r, preset) {
  const go = () => {
    editing = r;
    const f = $("#editForm");
    const src = r ? { title: rTitle(r), notes: rNotes(r), due: r.due, remind_before: r.remind_before, priority: r.priority, repeat: r.repeat, folder: r.folder, nag: r.nag, geo: r.geo, subtasks: rSubs(r) }
      : { title: "", notes: "", due: null, remind_before: 0, priority: "normal", repeat: "none", folder: defaultFolder(), nag: false, geo: null, subtasks: [], ...(preset || {}) };
    $("#editTitle").textContent = r ? "Edit reminder" : "New reminder";
    f.title.value = src.title || "";
    f.notes.value = src.notes || "";
    f.date.value = src.due ? src.due.slice(0, 10) : "";
    f.time.value = src.due ? src.due.slice(11, 16) : "";
    f.remind_before.value = String(src.remind_before || 0);
    if (!f.remind_before.value) { f.remind_before.append(h("option", { value: String(src.remind_before) }, `${src.remind_before} minutes before`)); f.remind_before.value = String(src.remind_before); }
    f.priority.value = src.priority || "normal";
    f.repeat.value = src.repeat || "none";
    fillFolderSelect(f.folder, src.folder || "personal");
    f.nag.checked = Boolean(src.nag);
    fillGeoSelect(f.geo, src.geo);
    editSubs = (src.subtasks || []).map((x) => ({ ...x }));
    renderSubs();
    runHooks(hooks.editorOpen, r, src);
    $("#editDelete").hidden = !r;
    $("#editError").textContent = "";
    $("#editDialog").showModal();
    if (!r) setTimeout(() => f.title.focus(), 50);
  };
  if (r && isPrivate(r)) requireVault(go); else go();
}
let editSubs = [];
function fillGeoSelect(sel, geo) {
  const opts = [h("option", { value: "" }, "No location")];
  const known = new Set();
  for (const p of db.places) {
    known.add(p.name.toLowerCase());
    opts.push(h("option", { value: `arrive:${p.id}` }, `Arriving at ${p.name}`), h("option", { value: `leave:${p.id}` }, `Leaving ${p.name}`));
  }
  if (geo && geo.place && !findPlace(geo.place)) opts.push(h("option", { value: `${geo.when}:${geo.place}` }, `${geo.when === "leave" ? "Leaving" : "Arriving at"} ${placeLabel(geo.place)} (not set up)`));
  if (!db.places.length) opts.push(h("option", { value: "", disabled: true }, "Add places in Settings → Places"));
  fill(sel, opts);
  const p = geo && findPlace(geo.place);
  sel.value = geo ? `${geo.when}:${p ? p.id : geo.place}` : "";
}
function renderSubs() {
  const list = $("#subList");
  fill(list, editSubs.map((x, i) => h("div", { class: "sub-row" },
    h("input", { type: "checkbox", checked: x.done, "aria-label": "Done", onchange: (e) => { x.done = e.target.checked; renderSubs(); } }),
    h("input", { class: "sub-text", value: x.text, maxlength: "200", "aria-label": "Step", oninput: (e) => { x.text = e.target.value; } }),
    h("button", { type: "button", class: "icon-btn xs danger", "aria-label": "Remove step", onclick: () => { editSubs.splice(i, 1); renderSubs(); } }, icon("x", 13)))));
  $("#subCount").textContent = editSubs.length ? `${editSubs.filter((x) => x.done).length}/${editSubs.length}` : "";
}
$("#subAdd").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const v = e.target.value.trim(); if (!v) return;
  editSubs.push({ id: uid(), text: v, done: false }); e.target.value = ""; renderSubs();
});
$("#quickDates").addEventListener("click", (e) => {
  const q = e.target.closest("button")?.dataset.q; if (!q) return;
  const f = $("#editForm"); const d = new Date(); d.setSeconds(0, 0);
  if (q === "clear") { f.date.value = ""; f.time.value = ""; return; }
  if (q === "30m") d.setMinutes(d.getMinutes() + 30);
  else if (q === "1h") d.setHours(d.getHours() + 1);
  else if (q === "tonight") { d.setHours(20, 0); if (d < new Date()) { d.setTime(Date.now() + 3600000); d.setMinutes(0); } }
  else if (q === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(9, 0); }
  else if (q === "weekend") { d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7)); d.setHours(10, 0); }
  f.date.value = fmt(d).slice(0, 10); f.time.value = fmt(d).slice(11, 16);
});
$("#editForm").addEventListener("submit", (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  e.preventDefault();
  const f = e.target;
  let due = null;
  if (f.date.value || f.time.value) due = `${f.date.value || fmt(new Date()).slice(0, 10)}T${f.time.value || "09:00"}`;
  const [gw, ...gp] = (f.geo.value || "").split(":");
  const fields = { title: f.title.value, notes: f.notes.value, due, remind_before: Number(f.remind_before.value), priority: f.priority.value, repeat: f.repeat.value, folder: f.folder.value,
    nag: f.nag.checked, geo: gp.length ? { when: gw, place: gp.join(":") } : null, subtasks: editSubs.filter((x) => x.text.trim()) };
  const go = () => {
    try {
      const saved = editing ? updateReminder(editing.id, fields) : addReminder(fields);
      runHooks(hooks.editorSave, saved);
      $("#editDialog").close();
      toast(editing ? "Reminder updated" : `Added “${fields.title.trim()}”`, true);
      render();
    } catch (err) { $("#editError").textContent = err.message; }
  };
  if (fields.folder === "private" || (editing && isPrivate(editing))) requireVault(go); else go();
});
$("#editDelete").addEventListener("click", () => {
  if (!editing) return;
  const id = editing.id;
  $("#editDialog").close();
  act(() => removeReminder(id), "Reminder deleted");
});

// ================================================================== vault dialog
let vaultMode = "unlock";
function openVaultDialog(mode) {
  vaultMode = mode;
  const f = $("#vaultForm"); f.reset();
  const cfg = {
    setup: ["Set a password", "Private reminders and notes are encrypted with this password. There is no way to recover it, so keep it safe.", "Set password"],
    unlock: ["Private folder", "Enter your password to unlock. It locks again after 5 minutes.", "Unlock"],
    change: ["Change password", "Enter your current password and a new one.", "Change"],
  }[mode];
  $("#vaultTitle").textContent = cfg[0]; $("#vaultText").textContent = cfg[1]; $("#vaultOk").textContent = cfg[2];
  f.current.hidden = mode !== "change";
  f.pw.placeholder = mode === "change" ? "New password" : "Password";
  f.pw.autocomplete = mode === "unlock" ? "current-password" : "new-password";
  f.pw2.hidden = mode === "unlock";
  $("#vaultReset").hidden = mode !== "unlock";
  runHooks(hooks.vaultDialog, mode);
  $("#vaultError").textContent = "";
  $("#vaultDialog").showModal();
  setTimeout(() => (mode === "change" ? f.current : f.pw).focus(), 50);
}
$("#vaultForm").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") { pendingAfterUnlock.length = 0; return; }
  e.preventDefault();
  const f = e.target; const err = $("#vaultError"); const ok = $("#vaultOk");
  err.textContent = "";
  if (!window.crypto || !crypto.subtle) { err.textContent = "Encryption needs a secure (https) page."; return; }
  if (vaultMode !== "unlock") {
    if (f.pw.value.length < 4) { err.textContent = "Use at least 4 characters."; return; }
    if (f.pw.value !== f.pw2.value) { err.textContent = "The passwords don't match."; return; }
  }
  ok.disabled = true; ok.textContent = "Working…";
  try {
    if (vaultMode === "setup") await createVault(f.pw.value);
    else if (vaultMode === "unlock") await unlockVault(f.pw.value);
    else await changeVaultPassword(f.current.value, f.pw.value);
    $("#vaultDialog").close();
    toast(vaultMode === "change" ? "Password changed" : "Private folder unlocked");
    render();
    while (pendingAfterUnlock.length) pendingAfterUnlock.shift()();
  } catch (x) {
    err.textContent = x.message || "Something went wrong";
    f.pw.select();
  } finally {
    ok.disabled = false; ok.textContent = { setup: "Set password", unlock: "Unlock", change: "Change" }[vaultMode];
  }
});
$("#vaultReset").addEventListener("click", () => {
  if (!confirm("Reset the Private folder? This permanently deletes all private reminders and notes, then lets you set a new password.")) return;
  snapshot("reset private folder");
  db.reminders = db.reminders.filter((r) => r.folder !== "private");
  db.vault = null; vault.key = null; vault.data = null;
  log("deleted", "Private folder reset");
  save();
  openVaultDialog("setup");
  render();
});

// ================================================================== folder dialog
let editingFolder = null; let folderColor = PALETTE[3];
function openFolderDialog(f) {
  editingFolder = f || null;
  const form = $("#folderForm"); form.reset();
  $("#folderTitle").textContent = f ? "Edit folder" : "New folder";
  form.name.value = f ? f.name : "";
  folderColor = f ? f.color : PALETTE[(db.folders.length) % PALETTE.length];
  const sw = $("#swatches");
  sw.replaceChildren(...PALETTE.map((c) => h("button", { type: "button", class: `swatch${c === folderColor ? " on" : ""}`, style: `--c:${c}`, role: "radio", "aria-checked": String(c === folderColor), "aria-label": c,
    onclick: (e) => { folderColor = c; $$(".swatch", sw).forEach((b) => { b.classList.toggle("on", b === e.currentTarget); b.setAttribute("aria-checked", String(b === e.currentTarget)); }); } })));
  $("#folderDelete").hidden = !f || f.builtin;
  $("#folderError").textContent = "";
  $("#folderDialog").showModal();
  setTimeout(() => form.name.focus(), 50);
}
$("#folderForm").addEventListener("submit", (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) { $("#folderError").textContent = "Enter a name."; return; }
  if (db.folders.some((f) => f !== editingFolder && f.name.toLowerCase() === name.toLowerCase())) { $("#folderError").textContent = "A folder with that name exists."; return; }
  snapshot("folder");
  if (editingFolder) { editingFolder.name = name; editingFolder.color = folderColor; } else {
    const f = { id: `f${uid()}`, name: name.slice(0, 40), color: folderColor, icon: FOLDER_ICONS[db.folders.length % FOLDER_ICONS.length] };
    db.folders.push(f);
    log("created", `Created folder “${f.name}”`);
    state.view = `folder:${f.id}`;
  }
  save(); $("#folderDialog").close(); render();
});
$("#folderDelete").addEventListener("click", () => {
  const f = editingFolder; if (!f || f.builtin) return;
  const n = db.reminders.filter((r) => r.folder === f.id).length + db.notes.filter((x) => x.folder === f.id).length;
  if (!confirm(`Delete “${f.name}”?${n ? ` Its ${n} item(s) move to Personal.` : ""}`)) return;
  snapshot("delete folder");
  for (const r of db.reminders) if (r.folder === f.id) r.folder = "personal";
  for (const x of db.notes) if (x.folder === f.id) x.folder = "personal";
  db.folders = db.folders.filter((x) => x !== f);
  log("deleted", `Deleted folder “${f.name}”`);
  if (state.view === `folder:${f.id}`) state.view = "all";
  save(); $("#folderDialog").close(); render(); toast("Folder deleted", true);
});

// ================================================================== settings dialog
function openSettings() {
  const s = db.settings;
  const toggle = (key, label, desc, onchange) => h("label", { class: "set-row" },
    h("div", {}, h("div", { class: "set-label" }, label), desc ? h("div", { class: "muted small" }, desc) : null),
    h("input", { type: "checkbox", class: "switch", checked: s[key], onchange: (e) => { s[key] = e.target.checked; save(); if (onchange) onchange(); } }));
  const select = (key, label, options, onchange) => h("label", { class: "set-row" }, h("div", { class: "set-label" }, label),
    h("select", { class: "mini-select", onchange: (e) => { s[key] = e.target.value; save(); if (onchange) onchange(); } }, options.map(([v, t]) => h("option", { value: v, selected: s[key] === v }, t))));
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const body = $("#settingsBody");
  fill(body,
    h("h3", {}, "Appearance"),
    select("theme", "Theme", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], applyTheme),
    toggle("seconds", "Show seconds on the clock", null, tickClock),
    h("h3", {}, "Reminders"),
    h("div", { class: "set-row" }, h("div", {}, h("div", { class: "set-label" }, "System notifications"),
      h("div", { class: "muted small" }, perm === "granted" ? "On" : perm === "denied" ? "Blocked — allow notifications for this site in your browser settings" : perm === "unsupported" ? "Not supported in this browser" : "Off")),
      perm === "default" ? h("button", { class: "btn primary sm", onclick: async () => { await Notification.requestPermission(); updateNotifyBtn(); openSettings(); } }, "Enable") : null),
    toggle("announce", "Read reminders aloud", "Speaks the reminder when it's due (private ones stay private)."),
    h("h3", {}, "Voice assistant"),
    select("voiceLang", "Language / accent", [["en-IN", "English (India)"], ["en-US", "English (US)"], ["en-GB", "English (UK)"], ["en-AU", "English (Australia)"], ["en-CA", "English (Canada)"], ["ta-IN", "தமிழ் (Tamil)"]]),
    toggle("speak", "Spoken replies", "The assistant answers out loud.", syncSpeakBtn),
    toggle("handsFree", "Hands-free “Hey Nudge”", "Listens for the wake phrase while the app is open (Chrome/Edge).", () => { if (s.handsFree) startWake(); else stopWake(); }),
    !SR ? h("p", { class: "warn" }, "This browser has no speech recognition. Use Chrome, Edge or Safari for voice; typing commands works everywhere.") : null,
    h("h3", {}, "Private folder"),
    h("div", { class: "set-row" }, h("div", {}, h("div", { class: "set-label" }, db.vault ? (unlocked() ? "Unlocked" : "Locked") : "No password set"),
      h("div", { class: "muted small" }, "AES-256 encryption with your password. Locks after 5 minutes.")),
      h("div", { class: "row-btns" },
        db.vault && unlocked() ? h("button", { class: "btn ghost sm", onclick: () => { lockVault(); openSettings(); } }, "Lock now") : null,
        db.vault ? h("button", { class: "btn ghost sm", onclick: () => { $("#settingsDialog").close(); openVaultDialog("change"); } }, "Change password")
          : h("button", { class: "btn primary sm", onclick: () => { $("#settingsDialog").close(); openVaultDialog("setup"); } }, "Set password"))),
    h("h3", {}, "Backup"),
    h("div", { class: "set-row" }, h("div", {}, h("div", { class: "set-label" }, "Move data between devices"),
      h("div", { class: "muted small" }, "Everything is stored only in this browser. Private items stay encrypted in the backup.")),
      h("div", { class: "row-btns" },
        h("button", { class: "btn ghost sm", onclick: exportBackup }, icon("download", 14), "Export"),
        h("button", { class: "btn ghost sm", onclick: () => $("#importFile").click() }, icon("upload", 14), "Import"))),
    hooks.settings.map((fn) => { try { return fn({ toggle, select, s }); } catch (e) { console.warn(e); return null; } }),
    h("h3", {}, "Keyboard"),
    h("div", { class: "muted small keys" }, h("kbd", {}, "Ctrl K"), " assistant  ·  ", h("kbd", {}, "N"), " new item  ·  ", h("kbd", {}, "/"), " search  ·  ", h("kbd", {}, "Esc"), " close"),
  );
  if (!$("#settingsDialog").open) $("#settingsDialog").showModal();
}
$("#settingsClose").addEventListener("click", () => $("#settingsDialog").close());
$("#settingsBtn").addEventListener("click", () => { closeSidebar(); openSettings(); });

const ACCENTS = {
  indigo: ["#4f46e5", "#6366f1", "#8b84ff"], blue: ["#2563eb", "#3b82f6", "#60a5fa"], teal: ["#0d9488", "#14b8a6", "#2dd4bf"],
  green: ["#16a34a", "#22c55e", "#4ade80"], rose: ["#e11d48", "#f43f5e", "#fb7185"], orange: ["#ea580c", "#f97316", "#fb923c"],
  purple: ["#9333ea", "#a855f7", "#c084fc"], slate: ["#334155", "#475569", "#94a3b8"],
};
const darkMq = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : null;
function applyTheme() {
  const t = db.settings.theme;
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme; else root.dataset.theme = t;
  const dark = t === "dark" || (t === "system" && darkMq && darkMq.matches);
  const a = ACCENTS[db.settings.accent] || ACCENTS.indigo;
  root.style.setProperty("--accent", dark ? a[2] : a[0]);
  root.style.setProperty("--accent-2", dark ? a[2] : a[1]);
  root.style.setProperty("--accent-deep", a[0]);
  root.style.setProperty("--accent-soft", "color-mix(in srgb, var(--accent) 15%, var(--surface))");
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = a[0];
}
if (darkMq && darkMq.addEventListener) darkMq.addEventListener("change", applyTheme);

function exportBackup() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `reminders-backup-${fmt(new Date()).slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data && data.version === 2) {
      if (!confirm("Replace everything on this device with this backup?")) return;
      snapshot("import");
      lockVault(true);
      localStorage.setItem(KEY, JSON.stringify(data));
      db = loadDb();
    } else {
      const tasks = Array.isArray(data) ? data : data && data.tasks;
      if (!Array.isArray(tasks)) throw new Error("Not a Reminders backup file");
      if (!confirm(`Add ${tasks.length} reminder(s) from this backup?`)) return;
      snapshot("import");
      for (const t of tasks) if (t && t.title) {
        db.reminders.push({ id: uid(), title: String(t.title).slice(0, 200), notes: String(t.notes || ""), due: t.due || null, remind_before: Number(t.remind_before) || 0,
          priority: PRIORITIES.includes(t.priority) ? t.priority : "normal", repeat: REPEATS.includes(t.repeat) ? t.repeat : "none", folder: "personal",
          snoozed_until: null, reminded_at: t.reminded_at || null, done: Boolean(t.done), completed_at: t.completed_at || null, created_at: t.created_at || fmt(new Date()) });
      }
      save();
    }
    $("#settingsDialog").close();
    render(); toast("Backup imported", true);
  } catch (err) { toast(`Import failed: ${err.message}`); }
});

// ================================================================== clock
function tickClock() {
  const now = new Date();
  let hr = now.getHours() % 12; if (hr === 0) hr = 12;
  $("#clkHM").textContent = `${hr}:${pad(now.getMinutes())}`;
  $("#clkS").textContent = db.settings.seconds ? `:${pad(now.getSeconds())}` : "";
  $("#clkAP").textContent = now.getHours() < 12 ? "AM" : "PM";
  $("#clkDate").textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const next = db.reminders.filter((r) => !r.done && remindTime(r) && remindTime(r) > now).sort((a, b) => remindTime(a) - remindTime(b))[0];
  const nx = $("#clkNext");
  if (next) {
    const t = remindTime(next); const s = Math.max(0, Math.round((t - now) / 1000));
    const span = s < 3600 ? `${Math.floor(s / 60)}m ${pad(s % 60)}s` : s < 86400 ? `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m` : `${Math.round(s / 86400)}d`;
    nx.replaceChildren(icon("bell", 13), h("span", { class: "nx-title" }, canSee(next) ? rTitle(next) : "Private reminder"), h("span", { class: "nx-in" }, span));
    nx.hidden = false;
  } else { nx.replaceChildren(icon("check", 13), h("span", { class: "nx-title" }, "No upcoming reminders")); }
  const mc = $("#mClock");
  {
    fill(mc, h("span", { class: "m-time" }, `${hr}:${pad(now.getMinutes())}${db.settings.seconds ? `:${pad(now.getSeconds())}` : ""}`, h("small", {}, now.getHours() < 12 ? "AM" : "PM")),
      h("span", { class: "m-date" }, now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })),
      next ? h("span", { class: "m-next" }, icon("bell", 12), h("span", {}, canSee(next) ? rTitle(next) : "Private"), $(".nx-in")?.textContent || "") : null);
  }
}

// ================================================================== alerts & notifications
let audioCtx;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [[784, 0], [988, 0.18], [1175, 0.36], [1568, 0.54]].forEach(([f, at]) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.4);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + at); o.stop(t0 + at + 0.42);
    });
  } catch { /* sound is optional */ }
}
async function systemNotify(r, title, text) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body: text, tag: `rem-${r.id}`, renotify: true, requireInteraction: r.priority === "high", icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    vibrate: [200, 100, 200], data: { id: r.id }, actions: [{ action: "done", title: "Done" }, { action: "snooze", title: "Snooze 10 min" }] };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) return await reg.showNotification(title, opts);
    new Notification(title, opts);
  } catch { /* in-page alert still shows */ }
}
let lastFired = null;
function remind(r) {
  lastFired = r.id;
  const due = parse(r.due);
  const title = canSee(r) ? rTitle(r) : "Private reminder";
  const text = r.geo && !due ? `${r.geo.when === "leave" ? "Leaving" : "Arrived at"} ${placeLabel(r.geo.place)}` : due ? `Due ${whenText(due, new Date())}` : "Reminder";
  if (typeof playAlarm === "function") playAlarm(r); else chime();
  systemNotify(r, `⏰ ${title}`, canSee(r) && rNotes(r) ? `${text}\n${rNotes(r)}` : text);
  if (db.settings.announce) setTimeout(() => say(isPrivate(r) ? "You have a private reminder." : `Reminder: ${title}`, null, true), 900);
  log("reminded", isPrivate(r) ? "Private reminder went off" : `Reminder went off: “${title}”`);
  const f = folderById(r.folder);
  const box = h("div", { class: `alert p-${r.priority}`, style: `--c:${f.color}`, role: "alertdialog", "aria-label": `Reminder: ${title}` },
    h("div", { class: "alert-icon" }, icon("bell", 20)),
    h("div", { class: "alert-body" }, h("strong", {}, title), h("span", { class: "muted" }, `${text} · ${f.name}${r.nag ? " · repeats until done" : ""}`)),
    h("div", { class: "alert-actions" },
      h("button", { class: "btn primary sm", onclick: () => { box.remove(); act(() => setDone(r.id, true), "Completed"); } }, "Done"),
      h("button", { class: "btn ghost sm", onclick: () => { box.remove(); act(() => snooze(r.id, 10), "Snoozed 10 min"); } }, "10 min"),
      h("button", { class: "btn ghost sm", onclick: (e) => openSnoozeMenu(e.currentTarget, r.id, () => box.remove()) }, "Later…"),
      h("button", { class: "icon-btn sm", "aria-label": "Dismiss", onclick: () => box.remove() }, icon("x", 14))));
  $$("#alerts .alert").forEach((a) => { if (a.dataset.rid === String(r.id)) a.remove(); });
  box.dataset.rid = String(r.id);
  $("#alerts").append(box);
}
function checkReminders() {
  for (const r of dueNow()) remind(r);
  runHooks(hooks.tick);
  renderSidebar();
  const a = document.activeElement;
  const typing = a && $("#view").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (!typing && !document.querySelector("dialog[open]")) renderView();
}
function handleAction(id, action) {
  if (action === "briefing") { if (typeof showBriefing === "function") showBriefing(); return; }
  id = Number(id);
  if (action === "done") setDone(id, true); else if (action === "snooze") snooze(id, 10);
  render();
}

// ================================================================== voice assistant
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const as = { open: false, listening: false, rec: null, pending: null, finalText: "", voiceMode: false };

function syncSpeakBtn() {
  const b = $("#asSpeak"); b.replaceChildren(icon(db.settings.speak ? "volume" : "mute", 18));
  b.title = db.settings.speak ? "Spoken replies on" : "Spoken replies off";
}
function pickVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const lang = db.settings.voiceLang.toLowerCase();
  const score = (v) => (v.lang.toLowerCase() === lang ? 4 : v.lang.toLowerCase().startsWith("en") ? 1 : 0) +
    (/google|natural|neural|samantha|siri|aria|jenny|zira|heera|neerja/i.test(v.name) ? 2 : 0) + (v.localService ? 0.5 : 0);
  return voices.slice().sort((a, b) => score(b) - score(a))[0] || null;
}
function say(text, then, force) {
  if ((!db.settings.speak && !force) || !("speechSynthesis" in window)) { if (then) setTimeout(then, 250); return; }
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, ""));
    const v = pickVoice(); if (v) u.voice = v;
    u.lang = v ? v.lang : db.settings.voiceLang; u.rate = 1.03; u.pitch = 1.02;
    let done = false;
    const fin = () => { if (done) return; done = true; $("#asOrb").classList.remove("talking"); if (then) then(); };
    u.onend = fin; u.onerror = fin;
    $("#asOrb").classList.add("talking");
    speechSynthesis.speak(u);
    setTimeout(fin, Math.min(15000, 1500 + text.length * 85)); // some browsers never fire onend
  } catch { if (then) then(); }
}

function openAssistant(listen) {
  const el = $("#assistant");
  if (!as.open) {
    el.hidden = false; as.open = true;
    requestAnimationFrame(() => el.classList.add("show"));
    if (!$("#asLog").children.length) {
      addBubble("bot", `${greeting()}! What can I do for you?`);
    }
    renderChips();
    stopWake();
  }
  if (listen && SR) startListening(); else setTimeout(() => $("#asInput").focus(), 60);
}
function closeAssistant() {
  stopListening(); as.pending = null;
  try { speechSynthesis.cancel(); } catch { /* none */ }
  const el = $("#assistant"); el.classList.remove("show");
  setTimeout(() => { el.hidden = true; }, 220);
  as.open = false;
  if (db.settings.handsFree) setTimeout(startWake, 600);
}
function greeting() { const hr = new Date().getHours(); return hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening"; }

function renderChips() {
  const chips = as.pending && as.pending.type === "when"
    ? ["In 30 minutes", "Tonight at 8", "Tomorrow morning", "No time"]
    : ["Remind me to call mom at 6 pm", "What's on today?", "Add milk to my to-do list", "Take a note: ideas for the weekend", "Open notepad", "What's overdue?"];
  $("#asChips").replaceChildren(...chips.map((c) => h("button", { class: "chip-btn", onclick: () => handleCommand(c, false) }, c)));
}

function addBubble(who, text, extra) {
  const log = $("#asLog");
  const b = h("div", { class: `bubble ${who}` }, h("div", { class: "bubble-text" }, text), extra || null);
  log.append(b);
  log.scrollTop = log.scrollHeight;
  while (log.children.length > 40) log.firstChild.remove();
  return b;
}
function reply(text, card, opts = {}) {
  addBubble("bot", text, card);
  const cont = as.voiceMode && (opts.listen || as.pending);
  say(opts.spoken || text, cont ? () => { if (as.open) startListening(); } : null);
}
function resultCard(kind, title, sub, color, actions = []) {
  return h("div", { class: "as-card", style: `--c:${color || "var(--accent)"}` },
    h("div", { class: "as-card-kind" }, kind),
    h("div", { class: "as-card-title" }, title),
    sub ? h("div", { class: "as-card-sub" }, sub) : null,
    actions.length ? h("div", { class: "as-card-actions" }, actions) : null);
}
const undoBtn = () => h("button", { class: "btn ghost sm", onclick: (e) => { const l = undo(); e.target.disabled = true; addBubble("bot", l ? "Done, I've undone that." : "Nothing to undo."); } }, icon("undo", 14), "Undo");

function startListening() {
  if (!SR) { reply("Voice input isn't available in this browser. Try Chrome, Edge or Safari — or just type your request below."); return; }
  if (as.listening) return;
  try { speechSynthesis.cancel(); } catch { /* none */ }
  const rec = new SR();
  rec.lang = db.settings.voiceLang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 4;
  as.rec = rec; as.finalText = ""; as.alts = [];
  const live = $("#asLive");
  rec.onstart = () => { as.listening = true; $("#assistant").classList.add("listening"); $("#asOrb").classList.add("listening"); $("#asHint").textContent = "Listening…"; live.textContent = ""; };
  rec.onspeechstart = () => $("#asOrb").classList.add("hearing");
  rec.onresult = (e) => {
    let interim = ""; let fin = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) { fin += res[0].transcript; as.alts = [...res].map((a) => a.transcript); } else interim += res[0].transcript;
    }
    if (fin) as.finalText += fin;
    live.textContent = (as.finalText + interim).trim();
  };
  rec.onerror = (e) => {
    const msg = { "not-allowed": "I need microphone access. Allow the microphone for this site, then tap the orb again.",
      "service-not-allowed": "Speech recognition is blocked in this browser.", "no-speech": "I didn't hear anything. Tap the orb and try again.",
      network: "Voice recognition needs an internet connection in this browser.", "audio-capture": "No microphone was found." }[e.error];
    if (msg && e.error !== "aborted") { as.pending = e.error === "no-speech" ? as.pending : null; addBubble("bot", msg); }
  };
  rec.onend = () => {
    as.listening = false;
    $("#assistant").classList.remove("listening"); $("#asOrb").classList.remove("listening", "hearing");
    $("#asHint").textContent = SR ? "Tap the orb and speak" : "Type your request";
    const text = bestAlternative(as.finalText.trim(), as.alts);
    live.textContent = "";
    if (text) handleCommand(text, true);
  };
  try { rec.start(); } catch { /* already started */ }
}
function stopListening() { if (as.rec) { try { as.rec.abort(); } catch { /* none */ } } as.listening = false; }

// Speech engines return several guesses; prefer the one that parses into a complete command.
function bestAlternative(text, alts) {
  if (!alts || alts.length < 2 || as.pending) return text;
  const now = new Date();
  const score = (t) => { const p = NLP.parse(t, now, { folders: db.folders }); return (p.intent !== "reminder" ? 2 : 0) + (p.due ? 2 : 0) + (p.title ? 1 : 0) + (p.explicit ? 1 : 0); };
  let best = text; let bestScore = score(text);
  for (const a of alts) { const s = score(a.trim()); if (s > bestScore) { best = a.trim(); bestScore = s; } }
  return best;
}

function handleCommand(text, fromVoice) {
  text = String(text || "").trim();
  if (!text) return;
  as.voiceMode = Boolean(fromVoice);
  addBubble("user", text);
  const now = new Date();
  const opts = nlpOpts();

  // answering a follow-up question?
  const pend = as.pending;
  if (pend) {
    as.pending = null;
    if (pend.type === "when") {
      const w = NLP.parseWhen(text, now, opts);
      if (w.none) return finishReminder(pend.data);
      if (w.due) return finishReminder({ ...pend.data, due: w.due, repeat: w.repeat !== "none" ? w.repeat : pend.data.repeat });
      const p = NLP.parse(text, now, opts);
      if (p.intent === "undo" || p.intent === "stop") return reply("OK, I won't set it.");
      if (p.intent === "reminder" && !p.explicit) {
        as.pending = pend; renderChips();
        return reply("Sorry, I didn't get the time. When should I remind you?", null, { listen: true });
      }
    } else if (pend.type === "title") {
      const p = NLP.parse(`remind me to ${text}`, now, opts);
      return continueReminder({ ...pend.data, title: p.title || text, due: pend.data.due || p.due, hasTime: pend.data.hasTime || p.hasTime });
    }
  }

  const p = NLP.parse(text, now, opts);
  if (aiWanted(p) && typeof aiAssist === "function") return aiAssist(text, p);
  return dispatch(p, text, now);
}
const isTamil = () => /^ta/i.test(db.settings.voiceLang || "");
const T = (en, ta) => (isTamil() && ta ? ta : en);
function taWhen(due) {
  if (!due) return "";
  const d = parse(due); const n = dayDiff(d, new Date());
  const day = n === 0 ? "இன்று" : n === 1 ? "நாளை" : n === 2 ? "நாளை மறுநாள்" : d.toLocaleDateString("ta-IN", { weekday: "long", day: "numeric", month: "long" });
  const hr = d.getHours(); const part = hr < 12 ? "காலை" : hr < 16 ? "மதியம்" : hr < 19 ? "மாலை" : "இரவு";
  return `${day} ${part} ${hr % 12 || 12}:${pad(d.getMinutes())} மணிக்கு`;
}
// Should an unclear command go to the AI model? (only when the user turned it on)
function aiWanted(p) {
  if (!db.settings.ai || (!db.settings.aiKey && !serverUrl())) return false;
  return p.intent === "unknown" || (p.intent === "reminder" && !p.explicit && !p.due && !p.geo);
}
function remember(kind, item) { as.last = item ? { kind, id: item.id } : null; }
function dispatch(p, text, now = new Date()) {
  const opts = nlpOpts();
  switch (p.intent) {
    case "reminder": return continueReminder(p, text);
    case "todo": {
      try { const t = addTodo(p.title); remember("todo", t); render(); return reply(T(`Added “${t.text}” to your to-do list.`, `“${t.text}” உங்கள் பட்டியலில் சேர்க்கப்பட்டது.`), resultCard("To-do", t.text, "To-Do List", "#10b981", [undoBtn(), h("button", { class: "btn ghost sm", onclick: () => setView("todo") }, "Open")])); } catch (e) { return reply(e.message); }
    }
    case "board": {
      try {
        const c = addCard(p.title, p.status, { priority: p.priority || "normal", due: p.due });
        remember("board", c);
        render();
        return reply(`Added “${c.title}” to Things to Do${p.status === "doing" ? ", in progress" : ""}.`, resultCard("Things to Do", c.title, BOARD_COLS.find((x) => x.id === c.status).name, "#06b6d4", [undoBtn(), h("button", { class: "btn ghost sm", onclick: () => setView("board") }, "Open")]));
      } catch (e) { return reply(e.message); }
    }
    case "note": {
      const folder = p.folder || "personal";
      const go = () => {
        try {
          const n = addNote({ title: p.body ? p.title : "", body: p.body, folder });
          remember("note", n);
          render();
          reply(p.body ? T("Got it, I've saved that note.", "சரி, குறிப்பைச் சேமித்தேன்.") : "I've created a new note for you.", resultCard("Note", n.title || "New note", p.body ? p.body.slice(0, 140) : "Empty note", "#eab308",
            [undoBtn(), h("button", { class: "btn ghost sm", onclick: () => { state.noteId = n.id; setView("notes"); closeAssistant(); } }, "Open")]));
        } catch (e) { reply(e.message); }
      };
      if (folder === "private") { reply("Please unlock your private folder first."); return requireVault(go); }
      return go();
    }
    case "query": return answerQuery(p.range, now);
    case "time": { const t = timeText(now); return reply(T(`It's ${t}.`, `இப்போது நேரம் ${t}.`), resultCard("Time", t, now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }), "#3b82f6")); }
    case "date": { const d = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); return reply(`Today is ${d}.`); }
    case "snooze": {
      const id = lastFired || [...db.reminders].filter((r) => r.reminded_at && !r.done).sort((a, b) => String(b.reminded_at).localeCompare(String(a.reminded_at)))[0]?.id;
      const r = id && snooze(id, p.minutes);
      if (!r) return reply("There's no reminder to snooze right now.");
      $$("#alerts .alert").forEach((a) => a.remove()); render();
      return reply(`Snoozed${canSee(r) ? ` “${rTitle(r)}”` : ""} for ${p.minutes < 60 ? `${p.minutes} minutes` : `${p.minutes / 60} hour${p.minutes === 60 ? "" : "s"}`}.`, null, { listen: false });
    }
    case "navigate": {
      const target = p.target;
      if (target === "settings") { closeAssistant(); return openSettings(); }
      if (VIEWS[target] && !WORKSPACE.some((w) => w.id === target)) return reply("That view isn't available.");
      if (target === "folder:private" && !unlocked()) { reply("Your private folder is locked. Please enter your password."); setView(target); return openVaultDialog(db.vault ? "unlock" : "setup"); }
      setView(target);
      return reply(`Here's ${target.startsWith("folder:") ? `your ${folderById(target.slice(7)).name} folder` : { notes: "your notepad", todo: "your to-do list", board: "Things to Do", history: "your history", overdue: "what's overdue", today: "today", scheduled: "your schedule", all: "all your reminders", flagged: "your flagged reminders", calendar: "your calendar", habits: "your habits", focus: "the focus timer", insights: "your insights" }[target] || "that"}.`);
    }
    case "complete": return completeByName(p.query);
    case "modify": return modifyLast(p);
    case "snoozeUntil": {
      const id = lastFired || as.last?.id;
      const r = id && db.reminders.find((x) => x.id === id);
      if (!r) return reply("There's no reminder to snooze right now.");
      snoozeUntil(r.id, parse(p.due)); $$("#alerts .alert").forEach((a) => a.remove()); render();
      return reply(`OK, I'll remind you again ${NLP.whenPhrase(p.due, new Date())}.`);
    }
    case "briefing": case "summary": case "focusStart": case "focusStop": case "habitAdd": case "habitCheck":
      if (typeof extraIntent === "function") return extraIntent(p, text);
      return reply("That feature isn't loaded yet.");
    case "delete": return deleteByName(p.query, p.kind);
    case "undo": { const l = undo(); return reply(l ? `OK, I've undone the last ${l}.` : "There's nothing to undo."); }
    case "lock": lockVault(true); return reply(db.vault ? "Your private folder is locked." : "You haven't set a private folder password yet.");
    case "clearCompleted": { const n = db.todos.filter((t) => t.done).length; if (!n) return reply("There are no completed to-dos to clear."); snapshot("clear completed"); db.todos = db.todos.filter((t) => !t.done); save(); render(); return reply(`Cleared ${n} completed to-do${n > 1 ? "s" : ""}.`, null); }
    case "help": return reply("You can say things like: “Remind me to pay rent on the 1st at 10 am”, “Remind me every weekday at 7 to stretch”, “Add eggs to my to-do list”, “Add redesign the logo to things to do”, “Take a note …”, “What's on tomorrow?”, “Mark call mom as done”, “Snooze for 15 minutes”, or “Open my work folder”.", null, { spoken: "Try saying: remind me to pay rent on the first at 10 AM. Or: what's on tomorrow?" });
    case "greet": return reply(`${greeting()}! Ask me to remind you about anything.`);
    case "thanks": return reply(["You're welcome!", "Happy to help!", "Anytime!"][Math.floor(Math.random() * 3)]);
    case "stop": return closeAssistant();
    default: return reply(T("Sorry, I didn't catch that. Try “Remind me to … at …”.", "மன்னிக்கவும், புரியவில்லை. “நாளை 5 மணிக்கு … நினைவூட்டு” என்று சொல்லுங்கள்."));
  }
}

// "move it to 6", "make it weekly", "put it in work", "rename it …", "delete it" — acts on the last thing created or mentioned
function modifyLast(p) {
  const last = as.last;
  if (!last) return reply("Which one? Create or mention a reminder first, then say things like “move it to 6”.");
  if (last.kind !== "reminder") {
    const list = { todo: db.todos, board: db.board, note: allNotes() }[last.kind] || [];
    const it = list.find((x) => x.id === last.id);
    if (!it) return reply("I can't find that item any more.");
    if (p.del) { snapshot("delete"); if (last.kind === "todo") db.todos = db.todos.filter((x) => x !== it); else if (last.kind === "board") db.board = db.board.filter((x) => x !== it); else removeNote(it.id); save(); render(); return reply("Deleted it.", null); }
    if (p.done) { if (last.kind === "todo") toggleTodo(it.id); else if (last.kind === "board") moveCard(it.id, "done"); render(); return reply("Marked it as done."); }
    if (p.rename) { snapshot("rename"); if (last.kind === "todo") it.text = p.rename; else if (last.kind === "board") it.title = p.rename; else updateNote(it.id, { title: p.rename }); save(); render(); return reply(`Renamed it to “${p.rename}”.`); }
    return reply("I can only rename, complete or delete that item.");
  }
  const r = db.reminders.find((x) => x.id === last.id);
  if (!r) return reply("I can't find that reminder any more.");
  const go = () => {
    try {
      if (p.del) { removeReminder(r.id); render(); return reply(`Deleted “${rTitle(r) || "the reminder"}”.`, resultCard("Deleted", rTitle(r), "Reminder", "#ef4444", [undoBtn()])); }
      if (p.done) { setDone(r.id, true); render(); return reply(`Marked “${rTitle(r)}” as done.`, null); }
      if (p.calendar) { if (typeof downloadICS === "function") downloadICS([r], rTitle(r)); return reply("Here's a calendar file for it — open it to add it to your calendar.", h("a", { class: "btn ghost sm", href: typeof gcalUrl === "function" ? gcalUrl(r) : "#", target: "_blank", rel: "noopener" }, "Open in Google Calendar")); }
      const ch = { ...p.changes };
      if (p.rename) ch.title = p.rename;
      if (p.notesAppend) ch.notes = [rNotes(r), p.notesAppend].filter(Boolean).join("\n");
      if (p.timeOnly && ch.due && r.due) {
        let hm = ch.due.slice(11);
        if (p.time && !p.time.mer && p.time.h >= 1 && p.time.h <= 12) {
          // "move it to 8" after a 7 PM reminder means 8 PM: take the AM/PM closest to the current time
          const cur = parse(r.due).getHours(); const a = p.time.h % 12; const b = a + 12;
          hm = `${pad(Math.abs(b - cur) < Math.abs(a - cur) ? b : a)}:${pad(p.time.m)}`;
        }
        let d = `${r.due.slice(0, 10)}T${hm}`;
        if (parse(d) <= new Date() && dayDiff(parse(r.due), new Date()) <= 0) d = ch.due;
        ch.due = d;
      }
      if (ch.repeat && !(ch.due || r.due)) ch.due = fmt(new Date(Date.now() + 3600000));
      if (!Object.keys(ch).length) return reply("What should I change? For example “move it to 6 pm” or “make it weekly”.");
      const u = updateReminder(r.id, ch);
      render();
      const bits = [];
      if (ch.due) bits.push(`moved to ${NLP.whenPhrase(u.due, new Date())}`);
      if (ch.repeat) bits.push(`repeats ${REPEAT_LABEL[ch.repeat].toLowerCase()}`);
      if (ch.priority) bits.push(ch.priority === "high" ? "marked urgent" : `priority ${ch.priority}`);
      if (ch.folder) bits.push(`moved to ${folderById(ch.folder).name}`);
      if (ch.title) bits.push(`renamed to “${ch.title}”`);
      if (ch.notes) bits.push("note added");
      if (ch.nag) bits.push("I'll keep reminding you until it's done");
      if (ch.geo) bits.push(`${ch.geo.when === "leave" ? "when you leave" : "when you get to"} ${placeLabel(ch.geo.place)}`);
      if (ch.remind_before != null) bits.push(`${ch.remind_before} minutes early`);
      return reply(`Done — ${bits.join(", ")}.`, resultCard("Updated", rTitle(u), u.due ? whenText(parse(u.due), new Date()) : "No date", folderById(u.folder).color, [undoBtn()]));
    } catch (e) { return reply(e.message); }
  };
  if (isPrivate(r) || p.changes.folder === "private") return requireVault(go);
  return go();
}

function continueReminder(p, raw) {
  const data = { title: p.title, due: p.due, hasTime: p.hasTime, repeat: p.repeat || "none", priority: p.priority || "normal", folder: p.folder || defaultFolderForVoice(), remind_before: p.remind_before || 0, nag: p.nag, geo: p.geo };
  if (!data.title) {
    as.pending = { type: "title", data }; renderChips();
    return reply("What would you like me to remind you about?", null, { listen: true });
  }
  if (!data.due && !data.geo && (p.explicit || as.voiceMode)) {
    as.pending = { type: "when", data }; renderChips();
    return reply(T(`When should I remind you to ${NLP.toSecondPerson(data.title.toLowerCase())}?`, `“${data.title}” எப்போது நினைவூட்ட வேண்டும்?`), null, { listen: true });
  }
  return finishReminder(data, raw);
}
const defaultFolderForVoice = () => (state.view.startsWith("folder:") ? state.view.slice(7) : "personal");

function finishReminder(data) {
  renderChips();
  const go = () => {
    try {
      const r = addReminder(data);
      remember("reminder", r);
      render();
      const f = folderById(r.folder);
      const when = r.due ? NLP.whenPhrase(r.due, new Date()) : "";
      const rep = r.repeat !== "none" ? `, ${REPEAT_LABEL[r.repeat].toLowerCase()}` : "";
      const subject = NLP.toSecondPerson(data.title.charAt(0).toLowerCase() + data.title.slice(1));
      let text = r.due ? `OK, I'll remind you to ${subject} ${when}${rep}${r.nag ? ", and keep reminding you until it's done" : ""}.`
        : r.geo ? `OK, I'll remind you to ${subject} ${r.geo.when === "leave" ? "when you leave" : "when you get to"} ${placeLabel(r.geo.place)}.` : `OK, I added “${data.title}” to your reminders.`;
      if (isTamil()) text = r.due ? `சரி, ${taWhen(r.due)} “${data.title}” என்று நினைவூட்டுகிறேன்.` : `சரி, “${data.title}” சேர்க்கப்பட்டது.`;
      if (r.geo && !findPlace(r.geo.place)) setTimeout(() => addBubble("bot", `I don't know where “${placeLabel(r.geo.place)}” is yet. Add it in Settings → Places (stand there and tap “Use my current location”).`), 300);
      reply(text, resultCard(`Reminder · ${f.name}`, data.title, [r.due ? whenText(parse(r.due), new Date()) : "No date", r.repeat !== "none" ? REPEAT_LABEL[r.repeat] : null, r.priority === "high" ? "High priority" : null, r.remind_before ? `${r.remind_before} min early` : null].filter(Boolean).join(" · "), f.color,
        [undoBtn(), h("button", { class: "btn ghost sm", onclick: () => openEditor(r) }, icon("edit", 14), "Edit")]));
      if ("Notification" in window && Notification.permission === "default" && !as.tipShown && (as.tipShown = true)) setTimeout(() => addBubble("bot", "Tip: enable notifications so reminders reach you even when this tab is in the background.", h("button", { class: "btn primary sm", onclick: async (e) => { await Notification.requestPermission(); e.target.remove(); updateNotifyBtn(); } }, "Enable notifications")), 400);
    } catch (e) { reply(e.message); }
  };
  if (data.folder === "private" && !unlocked()) { reply("That goes in your private folder — please unlock it first."); return requireVault(go); }
  return go();
}

function answerQuery(range, now) {
  const open = db.reminders.filter((r) => !r.done && canSee(r) && r.due);
  const pick = {
    today: (r) => dayDiff(parse(r.due), now) === 0,
    tomorrow: (r) => dayDiff(parse(r.due), now) === 1,
    week: (r) => { const d = dayDiff(parse(r.due), now); return d >= 0 && d < 7; },
    overdue: (r) => parse(r.due) < now,
    upcoming: (r) => parse(r.due) >= now,
  }[range] || (() => true);
  const list = open.filter(pick).sort(byDue);
  const label = { today: "today", tomorrow: "tomorrow", week: "this week", overdue: "overdue", upcoming: "coming up" }[range] || "";
  if (!list.length) return reply(range === "overdue" ? "Nothing is overdue. Nice work!" : `You have no reminders ${label}.`);
  const top = list.slice(0, 5);
  const spoken = top.map((r) => `${rTitle(r)} ${range === "week" || range === "overdue" ? NLP.whenPhrase(r.due, now) : `at ${timeText(parse(r.due))}`}`).join(", ");
  const card = h("div", { class: "as-card list-card" }, list.slice(0, 8).map((r) => h("div", { class: "as-li", style: `--c:${folderById(r.folder).color}` },
    h("i", { class: "dot" }), h("span", {}, rTitle(r)), h("span", { class: "muted small" }, whenText(parse(r.due), now)))));
  const head = range === "overdue" ? `You have ${list.length} overdue reminder${list.length > 1 ? "s" : ""}` : `You have ${list.length} reminder${list.length > 1 ? "s" : ""} ${label}`;
  return reply(`${head}.`, card, { spoken: `${head}: ${spoken}${list.length > 5 ? `, and ${list.length - 5} more` : ""}.` });
}

// Fuzzy title matching for "mark … as done" / "delete …"
const STOP = new Set(["the", "a", "an", "my", "to", "reminder", "task", "todo", "about", "for", "of", "item", "note"]);
const words = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
function similarity(q, t) {
  const a = words(q); const b = words(t);
  if (!a.length || !b.length) return 0;
  const qs = a.join(" "); const ts = b.join(" ");
  if (qs === ts) return 1;
  if (ts.includes(qs) || qs.includes(ts)) return 0.85;
  const hit = a.filter((w) => b.some((x) => x === w || (w.length > 3 && (x.startsWith(w) || w.startsWith(x))))).length;
  return hit / Math.max(a.length, b.length);
}
function findItems(query, kinds = ["reminder", "todo", "board", "note"]) {
  const out = [];
  if (kinds.includes("reminder")) for (const r of db.reminders) if (!r.done && canSee(r)) out.push({ kind: "reminder", item: r, title: rTitle(r) });
  if (kinds.includes("todo")) for (const t of db.todos) if (!t.done) out.push({ kind: "todo", item: t, title: t.text });
  if (kinds.includes("board")) for (const c of db.board) if (c.status !== "done") out.push({ kind: "board", item: c, title: c.title });
  if (kinds.includes("note")) for (const n of allNotes()) out.push({ kind: "note", item: n, title: n.title || firstLine(n.body) });
  return out.map((x) => ({ ...x, score: similarity(query, x.title) })).filter((x) => x.score >= 0.5).sort((a, b) => b.score - a.score);
}
function completeByName(q) {
  const m = findItems(q, ["reminder", "todo", "board"])[0];
  if (!m && typeof checkHabitByName === "function" && checkHabitByName(q)) return null;
  if (!m) return reply(`I couldn't find anything called “${q}”.`);
  remember(m.kind, m.item);
  if (m.kind === "reminder") setDone(m.item.id, true);
  else if (m.kind === "todo") toggleTodo(m.item.id);
  else moveCard(m.item.id, "done");
  render();
  return reply(`Nice! I've marked “${m.title}” as done.`, resultCard("Completed", m.title, { reminder: "Reminder", todo: "To-do", board: "Things to Do" }[m.kind], "#10b981", [undoBtn()]));
}
function deleteByName(q, kind) {
  const m = findItems(q, kind === "note" ? ["note"] : ["reminder", "todo", "board", "note"])[0];
  if (!m) return reply(`I couldn't find anything called “${q}”.`);
  try {
    if (m.kind === "reminder") removeReminder(m.item.id);
    else if (m.kind === "todo") { snapshot("delete to-do"); db.todos = db.todos.filter((x) => x !== m.item); save(); }
    else if (m.kind === "board") { snapshot("delete card"); db.board = db.board.filter((x) => x !== m.item); save(); }
    else removeNote(m.item.id);
  } catch (e) { return reply(e.message); }
  render();
  return reply(`Deleted “${m.title}”.`, resultCard("Deleted", m.title, { reminder: "Reminder", todo: "To-do", board: "Things to Do", note: "Note" }[m.kind], "#ef4444", [undoBtn()]));
}

// ---------------------------------------------------------------- hands-free wake phrase
const wake = { rec: null, on: false };
function startWake() {
  if (!SR || !db.settings.handsFree || as.open || document.hidden || wake.on) return;
  const rec = new SR();
  rec.lang = db.settings.voiceLang; rec.continuous = true; rec.interimResults = false;
  wake.rec = rec; wake.on = true;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      const t = e.results[i][0].transcript.trim();
      const m = t.match(/\b(?:hey|hi|ok|okay)\s+(?:nudge|reminders?|assistant|siri)\b[,.!]?\s*(.*)$/i);
      if (m) {
        stopWake();
        openAssistant(!m[1]);
        if (m[1]) handleCommand(m[1], true);
        return;
      }
    }
  };
  rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { db.settings.handsFree = false; save(); toast("Microphone blocked — hands-free turned off"); } };
  rec.onend = () => { wake.on = false; if (db.settings.handsFree && !as.open && !document.hidden) setTimeout(startWake, 400); };
  try { rec.start(); } catch { wake.on = false; }
}
function stopWake() { if (wake.rec) { const r = wake.rec; wake.rec = null; wake.on = false; try { r.onend = null; r.abort(); } catch { /* none */ } } }

// ---------------------------------------------------------------- assistant wiring
$("#micBtn").addEventListener("click", () => openAssistant(true));
$("#asClose").addEventListener("click", closeAssistant);
$("#asOrb").addEventListener("click", () => { if (as.listening) stopListening(); else startListening(); });
$("#asSpeak").addEventListener("click", () => { db.settings.speak = !db.settings.speak; save(); syncSpeakBtn(); if (!db.settings.speak) try { speechSynthesis.cancel(); } catch { /* none */ } });
$("#asForm").addEventListener("submit", (e) => { e.preventDefault(); const v = $("#asInput").value; $("#asInput").value = ""; handleCommand(v, false); });
$("#assistant").addEventListener("click", (e) => { if (e.target.id === "assistant") closeAssistant(); });

// ================================================================== shell: sidebar, buttons, keys
function openSidebar() { $("#sidebar").classList.add("open"); $("#scrim").hidden = false; }
function closeSidebar() { $("#sidebar").classList.remove("open"); $("#scrim").hidden = true; }
$("#menuBtn").addEventListener("click", openSidebar);
$("#sideClose").addEventListener("click", closeSidebar);
$("#scrim").addEventListener("click", closeSidebar);
$("#newBtn").addEventListener("click", () => newItem());
function newItem() {
  if (state.view === "todo") return $(".todo-add input")?.focus();
  if (state.view === "board") return $('.col[data-status="todo"] .col-add input')?.focus();
  if (state.view === "notes") return newNote();
  openEditor(null, { folder: defaultFolder() });
}
$("#search").addEventListener("input", (e) => {
  state.search = e.target.value;
  if (state.search.trim()) { if (state.view !== "search") state.prevView = state.view; state.view = "search"; } else if (state.view === "search") state.view = state.prevView;
  render();
});
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); if (as.open) closeAssistant(); else openAssistant(false); return; }
  if (e.key === "Escape" && as.open && !document.querySelector("dialog[open]")) { closeAssistant(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]") || as.open) return;
  if (e.key === "/") { e.preventDefault(); openSidebar(); $("#search").focus(); }
  else if (e.key.toLowerCase() === "n") { e.preventDefault(); newItem(); }
});

const nb = $("#notifyBtn");
function updateNotifyBtn() { nb.hidden = !("Notification" in window) || Notification.permission !== "default"; }
nb.addEventListener("click", async () => { await Notification.requestPermission(); updateNotifyBtn(); chime(); });
document.addEventListener("click", () => { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); });

// ---------------------------------------------------------------- install (home screen)
let installPrompt = null;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isPhone = () => window.matchMedia("(max-width: 860px), (pointer: coarse)").matches;
function updateInstallUi() {
  const can = !isStandalone();
  $("#installBtn").hidden = !can;
  let dismissed = 0; try { dismissed = Number(localStorage.getItem("nudge.installDismissed")) || 0; } catch { /* ignore */ }
  $("#installBar").hidden = !can || Date.now() - dismissed < 7 * 864e5 || !(isPhone() || installPrompt);
}
function installHelp() {
  const share = '<span class="ios-share" aria-label="Share"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4M12 2v13"/></svg></span>';
  const ua = navigator.userAgent;
  let html;
  if (isIOS()) {
    html = `<ol><li>Tap the <b>Share</b> button ${share} (at the bottom of Safari, or in the address bar).</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>. Open Nudge from your home screen.</li></ol>
      <p>Don't see “Add to Home Screen”? Open this page in <b>Safari</b> first. Notifications on iPhone need iOS 16.4 or later and work once Nudge is on your home screen.</p>`;
  } else if (/SamsungBrowser/i.test(ua)) {
    html = "<ol><li>Tap the menu <b>≡</b> at the bottom.</li><li>Tap <b>Add page to</b> → <b>Home screen</b> (or <b>Install</b>).</li></ol>";
  } else if (/Android/i.test(ua)) {
    html = `<ol><li>Tap the menu <b>⋮</b> at the top right of Chrome.</li><li>Tap <b>Install app</b> (or <b>Add to Home screen</b>).</li><li>Tap <b>Install</b>.</li></ol>
      <p>Using another browser? Open this page in <b>Chrome</b> for the best experience.</p>`;
  } else {
    html = "<ol><li>In <b>Chrome</b> or <b>Edge</b>, click the install icon at the right end of the address bar.</li><li>Click <b>Install</b>.</li></ol><p>In Safari on a Mac: <b>File → Add to Dock</b>.</p>";
  }
  $("#installSteps").innerHTML = html;
  $("#installDialog").showModal();
}
async function doInstall() {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice; installPrompt = null;
    if (outcome === "accepted") toast("Nudge is being added to your home screen");
    updateInstallUi(); return;
  }
  installHelp();
}
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; updateInstallUi(); });
window.addEventListener("appinstalled", () => { installPrompt = null; updateInstallUi(); toast("Nudge installed"); });
$("#installBtn").addEventListener("click", doInstall);
$("#installBarBtn").addEventListener("click", doInstall);
$("#installBarClose").addEventListener("click", () => { try { localStorage.setItem("nudge.installDismissed", String(Date.now())); } catch { /* ignore */ } updateInstallUi(); });
$("#installClose").addEventListener("click", () => $("#installDialog").close());
updateInstallUi();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* still works online */ });
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "reminder-action") handleAction(e.data.id, e.data.action); });
}
const params = new URLSearchParams(location.search);
if (params.get("task")) { handleAction(params.get("task"), params.get("action")); history.replaceState(null, "", location.pathname); }

// other tabs / windows
window.addEventListener("storage", async (e) => {
  if (e.key !== KEY) return;
  db = loadDb();
  if (vault.key && db.vault && db.vault.data) { try { vault.data = await openVaultWith(vault.key); } catch { lockVault(true); } }
  render();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stopWake(); return; }
  checkReminders(); tickClock();
  if (db.settings.handsFree) startWake();
});
["pointerdown", "keydown"].forEach((ev) => document.addEventListener(ev, () => { if (vault.key) armAutoLock(); }, { passive: true }));
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

// ================================================================== boot
applyTheme();
hydrateIcons();
syncSpeakBtn();
updateNotifyBtn();
if (!$("#nav")) throw new Error("layout missing");
if (state.view.startsWith("folder:") && !db.folders.some((f) => `folder:${f.id}` === state.view)) state.view = "today";
if (state.view === "search") state.view = "today";
render();
tickClock();
setInterval(tickClock, 1000);
checkReminders();
setInterval(checkReminders, CHECK_MS);
if (db.settings.handsFree) startWake();
