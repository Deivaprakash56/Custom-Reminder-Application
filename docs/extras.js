"use strict";
if (window.NUDGE_REDIRECTING) throw new Error("Opening the sign-in page");
// extras.js — features layered on top of app.js through its hooks:
// alarm sounds, attachments, calendar (.ics + view), habits, focus timer, insights, morning briefing,
// location reminders, push notifications, encrypted sync, AI fallback, biometric unlock, shortcuts & share.

Object.assign(ICONS, {
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-8"/>',
  flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  map: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  finger: '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>',
});
WORKSPACE.push(
  { id: "calendar", name: "Calendar", icon: "scheduled", color: "#ef4444" },
  { id: "habits", name: "Habits", icon: "flame", color: "#ec4899", count: () => habitsDueToday().length || null },
  { id: "focus", name: "Focus Timer", icon: "clock", color: "#f97316" },
  { id: "insights", name: "Insights", icon: "chart", color: "#6366f1" },
);

const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDaysX = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
const weekStart = (d) => { const s = startOfDay(d); return addDaysX(s, -((s.getDay() + 6) % 7)); };
const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
async function notifyNow(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    const o = { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png" };
    if (reg) await reg.showNotification(title, o); else new Notification(title, o);
  } catch { /* in-app UI still shows it */ }
}

// ================================================================== alarm sounds
const SOUNDS = { chime: "Chime", bell: "Bell", marimba: "Marimba", digital: "Digital beeps", gentle: "Gentle rise", alarm: "Alarm clock", custom: "My own sound…" };
function synth(name, vol = 0.8) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx; const t0 = ctx.currentTime + 0.02;
    const tone = (at, f, dur, type = "sine", v = 0.25, attack = 0.01) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * vol), t0 + at + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g).connect(ctx.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
    };
    if (name === "bell") [0, 1.2].forEach((s) => { tone(s, 880, 1.1, "sine", 0.3, 0.005); tone(s, 1760, 0.8, "sine", 0.12, 0.005); tone(s, 2637, 0.5, "sine", 0.06, 0.005); });
    else if (name === "marimba") [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(i * 0.16, f, 0.3, "triangle", 0.35, 0.004));
    else if (name === "digital") for (let i = 0; i < 8; i++) tone(i * 0.18 + (i >= 4 ? 0.3 : 0), 2000, 0.1, "square", 0.08, 0.002);
    else if (name === "gentle") [392, 494, 587, 784].forEach((f, i) => tone(i * 0.45, f, 1.4, "sine", 0.18, 0.3));
    else if (name === "alarm") for (let i = 0; i < 12; i++) tone(i * 0.12, i % 2 ? 1200 : 1500, 0.1, "sawtooth", 0.07, 0.003);
    else [[784, 0], [988, 0.18], [1175, 0.36], [1568, 0.54]].forEach(([f, at]) => tone(at, f, 0.4, "sine", 0.22, 0.02));
  } catch { /* sound is optional */ }
}
async function customSoundUrl() {
  const blob = await idbGet("blobs", "sound").catch(() => null);
  return blob ? URL.createObjectURL(blob) : null;
}
async function playAlarm(r, preview) {
  const s = db.settings; const vol = s.volume ?? 0.8;
  const once = async () => {
    if (s.sound === "custom") {
      const url = await customSoundUrl();
      if (url) { const a = new Audio(url); a.volume = vol; try { await a.play(); return; } catch { /* fall back */ } }
    }
    synth(s.sound === "custom" ? "chime" : s.sound, vol);
  };
  await once();
  if (!preview && r && (r.priority === "high" || r.nag)) setTimeout(once, 2200);
}

// ================================================================== IndexedDB (attachments, custom sound)
let idbConn = null;
function idbOpen() {
  if (idbConn) return idbConn;
  idbConn = new Promise((res, rej) => {
    const rq = indexedDB.open("reminders-files", 1);
    rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore("files", { keyPath: "id" }).createIndex("rid", "rid"); d.createObjectStore("blobs"); };
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  return idbConn;
}
async function idbDo(store, mode, fn) {
  const d = await idbOpen();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const st = t.objectStore(store);
    const rq = fn(st); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const idbGet = (store, key) => idbDo(store, "readonly", (s) => s.get(key));
const idbPut = (store, val, key) => idbDo(store, "readwrite", (s) => (key === undefined ? s.put(val) : s.put(val, key)));
const idbDel = (store, key) => idbDo(store, "readwrite", (s) => s.delete(key));
const filesFor = (rid) => idbDo("files", "readonly", (s) => s.index("rid").getAll(rid));

// ================================================================== attachments in the reminder editor
let attPending = []; let attExisting = []; let attRemoved = [];
async function attBlob(rec) {
  if (!rec.enc) return rec.data;
  if (!vault.key) throw new Error("Unlock the Private folder to open this file");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.iv) }, vault.key, rec.data);
  return new Blob([pt], { type: rec.type });
}
async function renderAttach() {
  const list = $("#attachList");
  const items = [...attExisting.filter((a) => !attRemoved.includes(a.id)).map((a) => ({ rec: a })), ...attPending.map((p, i) => ({ pend: p, i }))];
  fill(list, await Promise.all(items.map(async (it) => {
    const name = it.rec ? it.rec.name : it.pend.name; const type = it.rec ? it.rec.type : it.pend.type;
    let thumb = icon("upload", 18);
    if (/^image\//.test(type)) {
      try { const b = it.rec ? await attBlob(it.rec) : it.pend; thumb = h("img", { src: URL.createObjectURL(b), alt: "" }); } catch { thumb = icon("lock", 16); }
    }
    return h("div", { class: "att" },
      h("button", { type: "button", class: "att-open", title: `Open ${name}`, onclick: async () => {
        try { const b = it.rec ? await attBlob(it.rec) : it.pend; window.open(URL.createObjectURL(b), "_blank", "noopener"); } catch (e) { toast(e.message); }
      } }, h("span", { class: "att-thumb" }, thumb), h("span", { class: "att-name" }, name)),
      h("button", { type: "button", class: "icon-btn xs danger", "aria-label": `Remove ${name}`, onclick: () => { if (it.rec) attRemoved.push(it.rec.id); else attPending.splice(it.i, 1); renderAttach(); } }, icon("x", 13)));
  })));
}
$("#attachBtn").addEventListener("click", () => $("#attachInput").click());
$("#attachInput").addEventListener("change", (e) => {
  for (const f of e.target.files) { if (f.size > 15 * 1024 * 1024) { toast(`${f.name} is larger than 15 MB`); continue; } attPending.push(f); }
  e.target.value = ""; renderAttach();
});
hooks.editorOpen.push(async (r) => {
  attPending = []; attRemoved = []; attExisting = [];
  try { attExisting = r ? await filesFor(r.id) : []; } catch { /* storage unavailable */ }
  renderAttach();
  updateCalLinks();
});
hooks.editorSave.push(async (r) => {
  try {
    for (const id of attRemoved) await idbDel("files", id);
    for (const f of attPending) {
      const rec = { id: `a${uid()}`, rid: r.id, name: f.name, type: f.type || "application/octet-stream", size: f.size, created: fmt(new Date()) };
      if (isPrivate(r) && vault.key) { const iv = rand(12); rec.enc = true; rec.iv = b64(iv); rec.data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vault.key, await f.arrayBuffer()); } else rec.data = f;
      await idbPut("files", rec);
    }
    const count = (await filesFor(r.id)).length;
    if ((r.att || 0) !== count) { r.att = count; save(); render(); }
  } catch (e) { toast(`Couldn't save attachments: ${e.message}`); }
});

// ================================================================== calendar files (.ics) and Google Calendar links
const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const RRULE = { daily: "FREQ=DAILY", weekdays: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", weekly: "FREQ=WEEKLY", monthly: "FREQ=MONTHLY", yearly: "FREQ=YEARLY" };
const fold = (line) => { const out = []; let l = line; while (l.length > 74) { out.push(l.slice(0, 74)); l = ` ${l.slice(74)}`; } out.push(l); return out.join("\r\n"); };
function reminderText(r) { const subs = rSubs(r); return [rNotes(r), ...subs.map((x) => `${x.done ? "☑" : "☐"} ${x.text}`)].filter(Boolean).join("\n"); }
function toICS(list) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nudge//Custom Reminder Application//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const r of list) {
    if (!r.due || !canSee(r)) continue;
    const d = parse(r.due);
    L.push("BEGIN:VEVENT", `UID:${r.id}@reminders.app`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(d)}`, `DTEND:${icsDate(addMin(d, 15))}`, fold(`SUMMARY:${icsEsc(rTitle(r))}`));
    const desc = reminderText(r); if (desc) L.push(fold(`DESCRIPTION:${icsEsc(desc)}`));
    if (r.repeat !== "none" && RRULE[r.repeat]) L.push(`RRULE:${RRULE[r.repeat]}`);
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${icsEsc(rTitle(r))}`), `TRIGGER:-PT${r.remind_before || 0}M`, "END:VALARM", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.join("\r\n") + "\r\n";
}
function downloadICS(list, name = "reminders") {
  const blob = new Blob([toICS(list)], { type: "text/calendar" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${String(name).replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "reminders"}.ics` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function gcalUrl(r) {
  const d = parse(r.due) || addMin(new Date(), 60);
  const q = new URLSearchParams({ action: "TEMPLATE", text: rTitle(r) || r.title || "Reminder", dates: `${icsDate(d)}/${icsDate(addMin(d, 15))}`, details: reminderText(r) || r.notes || "" });
  if (r.repeat && r.repeat !== "none") q.set("recur", `RRULE:${RRULE[r.repeat]}`);
  return `https://calendar.google.com/calendar/render?${q}`;
}
function formReminder() {
  const f = $("#editForm");
  const due = f.date.value || f.time.value ? `${f.date.value || ymd(new Date())}T${f.time.value || "09:00"}` : null;
  return { id: editing ? editing.id : Date.now(), title: f.title.value || "Reminder", notes: f.notes.value, due, repeat: f.repeat.value, remind_before: Number(f.remind_before.value), folder: "personal", subtasks: editSubs };
}
function updateCalLinks() {
  const r = formReminder();
  $("#gcalBtn").href = gcalUrl(r);
  $("#icsBtn").disabled = !r.due; $("#gcalBtn").classList.toggle("disabled", !r.due);
}
$("#editForm").addEventListener("input", updateCalLinks);
$("#quickDates").addEventListener("click", () => setTimeout(updateCalLinks, 0));
$("#icsBtn").addEventListener("click", () => { const r = formReminder(); if (r.due) downloadICS([r], r.title); });

// ================================================================== Calendar view
state.cal = { mode: "month", cursor: new Date(), sel: ymd(new Date()) };
function occurrences(r, from, to) {
  if (!r.due) return [];
  let d = parse(r.due); const out = [];
  if (r.repeat === "none" || r.done) { if (d >= from && d < to) out.push(d); return out; }
  for (let i = 0; i < 400 && d < to; i++) { if (d >= from) out.push(d); d = nextOccurrence(d, r.repeat, d); }
  return out;
}
function calItems(from, to) {
  const map = new Map();
  for (const r of db.reminders) {
    if (!canSee(r)) continue;
    occurrences(r, from, to).forEach((d, i) => {
      const k = ymd(d); if (!map.has(k)) map.set(k, []);
      map.get(k).push({ r, d, ghost: i > 0 || (r.repeat !== "none" && ymd(d) !== ymd(parse(r.due))) });
    });
  }
  for (const list of map.values()) list.sort((a, b) => a.d - b.d);
  return map;
}
function calChip(it) {
  const f = folderById(it.r.folder);
  const el = h("div", { class: `cal-chip${it.r.done ? " done" : ""}${it.ghost ? " ghost" : ""}`, style: `--c:${f.color}`, title: `${rTitle(it.r)} · ${timeText(it.d)}`, draggable: it.ghost ? null : "true",
    onclick: (e) => { e.stopPropagation(); openEditor(it.r); } },
  h("i", { class: "dot" }), h("span", { class: "cal-n" }, rTitle(it.r)), h("span", { class: "cal-t" }, timeText(it.d).replace(":00", "").replace(" ", "").toLowerCase()));
  if (!it.ghost) el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(it.r.id)); });
  return el;
}
function calDropTarget(el, key) {
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop-target"); });
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    e.preventDefault(); el.classList.remove("drop-target");
    const r = db.reminders.find((x) => String(x.id) === e.dataTransfer.getData("text/plain"));
    if (!r || !r.due) return;
    const go = () => { try { updateReminder(r.id, { due: `${key}${r.due.slice(10)}` }); state.cal.sel = key; render(); toast(`Moved to ${dayLabel(parse(key + "T00:00"), new Date())}`, true); } catch (err) { toast(err.message); } };
    if (isPrivate(r)) requireVault(go); else go();
  });
}
VIEWS.calendar = (now) => {
  const c = state.cal; const cur = new Date(c.cursor);
  let from; let to; let label;
  if (c.mode === "month") {
    const first = new Date(cur.getFullYear(), cur.getMonth(), 1);
    from = weekStart(first); to = addDaysX(from, 42);
    label = first.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  } else {
    from = weekStart(cur); to = addDaysX(from, 7);
    label = `${from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDaysX(to, -1).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }
  const items = calItems(from, to);
  const step = (n) => { const d = new Date(c.cursor); if (c.mode === "month") d.setMonth(d.getMonth() + n, 1); else d.setDate(d.getDate() + 7 * n); c.cursor = d; renderView(); };
  const bar = h("div", { class: "cal-bar" },
    h("div", { class: "cal-nav" },
      h("button", { class: "icon-btn", "aria-label": "Previous", onclick: () => step(-1) }, icon("left", 18)),
      h("button", { class: "btn ghost sm", onclick: () => { c.cursor = new Date(); c.sel = ymd(new Date()); renderView(); } }, "Today"),
      h("button", { class: "icon-btn", "aria-label": "Next", onclick: () => step(1) }, icon("right", 18)),
      h("h2", { class: "cal-label" }, label)),
    h("div", { class: "cal-tools" },
      h("div", { class: "segmented" }, [["month", "Month"], ["week", "Week"]].map(([m, t]) => h("button", { class: c.mode === m ? "on" : "", onclick: () => { c.mode = m; renderView(); } }, t))),
      h("button", { class: "btn ghost sm", title: "Download these reminders as a calendar file", onclick: () => downloadICS(db.reminders.filter((r) => r.due && !r.done && canSee(r)), "reminders") }, icon("download", 14), "Export .ics")));
  let grid;
  if (c.mode === "month") {
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = addDaysX(from, i); const k = ymd(d); const list = items.get(k) || [];
      const cell = h("div", { class: `cal-cell${d.getMonth() !== cur.getMonth() ? " out" : ""}${k === ymd(now) ? " today" : ""}${k === c.sel ? " sel" : ""}`, role: "button", tabindex: "0", "aria-label": `${d.toDateString()}, ${list.length} reminders`,
        onclick: () => { c.sel = k; renderView(); }, ondblclick: () => openEditor(null, { due: `${k}T09:00`, folder: defaultFolder() }) },
      h("div", { class: "cal-day" }, String(d.getDate())), list.slice(0, 3).map(calChip), list.length > 3 ? h("div", { class: "cal-more" }, `+${list.length - 3} more`) : null);
      calDropTarget(cell, k);
      days.push(cell);
    }
    grid = h("div", { class: "cal-grid" }, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => h("div", { class: "cal-wd" }, w)), days);
  } else {
    grid = h("div", { class: "cal-week" }, Array.from({ length: 7 }, (_, i) => {
      const d = addDaysX(from, i); const k = ymd(d); const list = items.get(k) || [];
      const col = h("div", { class: `cal-col${k === ymd(now) ? " today" : ""}${k === c.sel ? " sel" : ""}`, onclick: () => { c.sel = k; renderView(); }, ondblclick: () => openEditor(null, { due: `${k}T09:00`, folder: defaultFolder() }) },
        h("div", { class: "cal-col-head" }, h("span", {}, WD_SHORT[d.getDay()]), h("strong", {}, String(d.getDate()))), list.map(calChip), list.length ? null : h("div", { class: "cal-empty" }, "—"));
      calDropTarget(col, k);
      return col;
    }));
  }
  const sel = parse(`${c.sel}T00:00`);
  const selList = (items.get(c.sel) || calItems(startOfDay(sel), addDaysX(startOfDay(sel), 1)).get(c.sel) || []);
  const seen = new Set();
  const panel = h("aside", { class: "cal-side card" },
    h("div", { class: "cal-side-head" }, h("div", {}, h("strong", {}, sel.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })), h("div", { class: "muted small" }, `${selList.length} reminder${selList.length === 1 ? "" : "s"}`)),
      h("button", { class: "btn primary sm", onclick: () => openEditor(null, { due: `${c.sel}T09:00`, folder: defaultFolder() }) }, icon("plus", 14), "Add")),
    selList.length ? h("div", { class: "list" }, selList.filter((it) => !seen.has(it.r.id) && seen.add(it.r.id)).map((it) => reminderRow(it.r, now)))
      : h("p", { class: "muted pad" }, "Nothing on this day. Double-click a day to add a reminder, or drag reminders between days."));
  return [h("div", { class: "cal" }, bar, h("div", { class: "cal-body" }, h("div", { class: "card cal-main" }, grid), panel)), label];
};

// ================================================================== Habits
const habitsScheduledOn = (hb, d) => (hb.days || [0, 1, 2, 3, 4, 5, 6]).includes(d.getDay());
function habitStreak(hb, today = new Date()) {
  let n = 0; let d = startOfDay(today); const created = startOfDay(parse(hb.created) || today);
  if (!hb.log[ymd(d)]) d = addDaysX(d, -1);
  for (let i = 0; i < 1500 && d >= created; i++, d = addDaysX(d, -1)) {
    if (!habitsScheduledOn(hb, d)) continue;
    if (hb.log[ymd(d)]) n++; else break;
  }
  return n;
}
function habitBest(hb) {
  let best = 0; let run = 0; let d = startOfDay(parse(hb.created) || new Date()); const end = startOfDay(new Date());
  for (let i = 0; i < 1500 && d <= end; i++, d = addDaysX(d, 1)) {
    if (!habitsScheduledOn(hb, d)) continue;
    if (hb.log[ymd(d)]) { run++; best = Math.max(best, run); } else if (ymd(d) !== ymd(end)) run = 0;
  }
  return best;
}
function habitsDueToday() { const t = new Date(); return db.habits.filter((hb) => habitsScheduledOn(hb, t) && !hb.log[ymd(t)]); }
function addHabit(name, days, color) {
  name = String(name || "").trim(); if (!name) throw new Error("Name the habit");
  snapshot("add habit");
  const hb = { id: uid(), name: name.slice(0, 80), days: days && days.length ? days : [0, 1, 2, 3, 4, 5, 6], color: color || PALETTE[db.habits.length % PALETTE.length], log: {}, created: fmt(new Date()) };
  db.habits.push(hb); log("created", `Started habit “${hb.name}”`); save();
  return hb;
}
function toggleHabit(hb, key = ymd(new Date())) {
  snapshot("habit check-in");
  if (hb.log[key]) delete hb.log[key]; else { hb.log[key] = true; log("completed", `Checked in “${hb.name}” — ${habitStreak(hb)} day streak`); }
  save();
}
function checkHabitByName(q) {
  const m = db.habits.map((hb) => ({ hb, s: similarity(q, hb.name) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s)[0];
  if (!m) return false;
  if (!m.hb.log[ymd(new Date())]) toggleHabit(m.hb);
  render();
  const st = habitStreak(m.hb);
  reply(`Nice! “${m.hb.name}” checked in — ${st} day${st === 1 ? "" : "s"} in a row. 🔥`, null);
  return true;
}
let habitDraftDays = [0, 1, 2, 3, 4, 5, 6];
VIEWS.habits = (now) => {
  const name = h("input", { placeholder: "New habit — e.g. Drink 8 glasses of water", maxlength: "80", "aria-label": "Habit name" });
  const dayBtns = h("div", { class: "day-pick", role: "group", "aria-label": "Days" }, ["S", "M", "T", "W", "T", "F", "S"].map((l, i) =>
    h("button", { type: "button", class: habitDraftDays.includes(i) ? "on" : "", "aria-pressed": String(habitDraftDays.includes(i)), title: WD_SHORT[i],
      onclick: (e) => { habitDraftDays = habitDraftDays.includes(i) ? habitDraftDays.filter((x) => x !== i) : [...habitDraftDays, i].sort(); e.currentTarget.classList.toggle("on"); } }, l)));
  const form = h("form", { class: "card habit-add", onsubmit: (e) => { e.preventDefault(); try { addHabit(name.value, habitDraftDays); render(); toast("Habit added", true); } catch (err) { toast(err.message); } } },
    h("span", { class: "composer-plus" }, icon("plus", 18)), name, dayBtns, h("button", { class: "btn primary sm" }, "Add habit"));
  const ws = weekStart(now);
  const cards = db.habits.map((hb) => {
    const st = habitStreak(hb, now); const best = habitBest(hb); const doneToday = Boolean(hb.log[ymd(now)]); const due = habitsScheduledOn(hb, now);
    const dots = Array.from({ length: 7 }, (_, i) => {
      const d = addDaysX(ws, i); const k = ymd(d); const sch = habitsScheduledOn(hb, d); const future = d > now;
      return h("button", { class: `hdot${hb.log[k] ? " on" : ""}${!sch ? " off" : ""}${k === ymd(now) ? " today" : ""}`, disabled: future || !sch, title: `${d.toDateString()}${hb.log[k] ? " ✓" : ""}`,
        "aria-label": `${WD_SHORT[d.getDay()]} ${hb.log[k] ? "done" : "not done"}`, onclick: () => { toggleHabit(hb, k); renderView(); renderSidebar(); } }, WD_SHORT[d.getDay()][0]);
    });
    const sched = hb.days.length === 7 ? "Every day" : hb.days.join() === "1,2,3,4,5" ? "Weekdays" : hb.days.map((d) => WD_SHORT[d]).join(", ");
    return h("article", { class: "habit card", style: `--c:${hb.color}` },
      h("div", { class: "habit-top" },
        h("div", {}, h("div", { class: "habit-name" }, hb.name), h("div", { class: "muted small" }, sched)),
        h("button", { class: "icon-btn sm danger", "aria-label": `Delete ${hb.name}`, onclick: () => { if (!confirm(`Delete habit “${hb.name}”?`)) return; snapshot("delete habit"); db.habits = db.habits.filter((x) => x !== hb); save(); render(); toast("Habit deleted", true); } }, icon("trash", 14))),
      h("div", { class: "habit-streak" }, h("span", { class: `flame${st ? " lit" : ""}` }, icon("flame", 22)), h("strong", {}, String(st)), h("span", { class: "muted" }, ` day streak · best ${best}`)),
      h("div", { class: "hdots" }, dots),
      h("button", { class: `btn ${doneToday ? "ghost" : "primary"} habit-check`, disabled: !due && !doneToday, onclick: () => { toggleHabit(hb); render(); } },
        icon("check", 15), doneToday ? "Done today" : due ? "Check in for today" : "Not scheduled today"));
  });
  const dueN = habitsDueToday().length;
  return [h("div", { class: "habits" }, form,
    db.habits.length ? h("div", { class: "habit-grid" }, cards) : h("div", { class: "empty" }, h("div", { class: "empty-icon" }, icon("flame", 30)), h("h3", {}, "Build a streak"), h("p", { class: "muted" }, "Add a habit above, or say “Add a habit drink water every day”."))),
  db.habits.length ? `${dueN ? `${dueN} to do today` : "All done for today 🎉"}` : "No habits yet"];
};

// ================================================================== Focus timer (Pomodoro)
const FOCUS_KEY = "reminders.focus";
let focus = (() => { try { return JSON.parse(localStorage.getItem(FOCUS_KEY)) || { mode: null }; } catch { return { mode: null }; } })();
const saveFocus = () => { try { localStorage.setItem(FOCUS_KEY, JSON.stringify(focus)); } catch { /* ignore */ } };
const focusLeft = () => (focus.mode ? (focus.paused ? focus.remaining : focus.endsAt - Date.now()) : 0);
function focusStart(mins, item = {}, mode = "focus") {
  mins = Math.max(1, Math.min(180, Number(mins) || db.settings.focusMin || 25));
  focus = { mode, mins, total: mins * 60000, endsAt: Date.now() + mins * 60000, paused: false, remaining: null, itemKind: item.kind || null, itemId: item.id || null, title: item.title || "", startedAt: Date.now() };
  saveFocus(); focusRender();
}
function focusPause() {
  if (!focus.mode) return;
  if (focus.paused) { focus.endsAt = Date.now() + focus.remaining; focus.paused = false; focus.remaining = null; } else { focus.remaining = focus.endsAt - Date.now(); focus.paused = true; }
  saveFocus(); focusRender();
}
function focusLog(mins) {
  db.focusLog.push({ at: fmt(new Date()), mins, title: focus.title || "", kind: focus.itemKind, id: focus.itemId });
  if (db.focusLog.length > 2000) db.focusLog.splice(0, db.focusLog.length - 2000);
  if (focus.itemKind === "board") { const c = db.board.find((x) => x.id === focus.itemId); if (c) c.focus = (c.focus || 0) + mins; }
  log("completed", `Focused ${mins} min${focus.title ? ` on “${focus.title}”` : ""}`);
  save();
}
function focusStop() {
  if (focus.mode === "focus") { const done = Math.floor((focus.total - focusLeft()) / 60000); if (done >= 1) focusLog(done); }
  focus = { mode: null }; saveFocus(); focusRender();
}
function focusTick() {
  if (!focus.mode || focus.paused) { focusRender(true); return; }
  if (Date.now() < focus.endsAt) { focusRender(true); return; }
  if (focus.mode === "focus") {
    const item = { kind: focus.itemKind, id: focus.itemId, title: focus.title };
    focusLog(focus.mins);
    playAlarm(null, true);
    notifyNow("🍅 Focus session complete", `Great work${item.title ? ` on “${item.title}”` : ""}! Take a ${db.settings.breakMin || 5}-minute break.`, "focus");
    say(`Focus session complete. Take a ${db.settings.breakMin || 5} minute break.`, null, true);
    focusStart(db.settings.breakMin || 5, item, "break");
  } else {
    playAlarm(null, true);
    notifyNow("☕ Break's over", "Ready for the next focus session?", "focus");
    focus = { mode: null }; saveFocus(); focusRender();
  }
  render();
}
function ringSvg(frac, size, stroke, cls = "") {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const t = document.createElement("template");
  t.innerHTML = `<svg class="ring-svg ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${stroke}"/><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.max(0, Math.min(1, frac)))}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  return t.content.firstChild;
}
function focusRender(tickOnly) {
  const w = $("#focusWidget");
  const show = Boolean(focus.mode) && state.view !== "focus";
  w.hidden = !show;
  if (show) {
    const frac = 1 - focusLeft() / focus.total;
    fill(w, h("span", { class: `fw-ring ${focus.mode}` }, ringSvg(frac, 34, 4)),
      h("button", { class: "fw-main", onclick: () => setView("focus") }, h("strong", {}, mmss(focusLeft())), h("span", {}, focus.mode === "break" ? "Break" : focus.title || "Focus")),
      h("button", { class: "icon-btn sm", "aria-label": focus.paused ? "Resume" : "Pause", onclick: focusPause }, icon(focus.paused ? "play" : "pause", 14)),
      h("button", { class: "icon-btn sm", "aria-label": "Stop", onclick: focusStop }, icon("stop", 14)));
  }
  if (state.view === "focus") {
    if (tickOnly && $(".focus-time")) {
      $(".focus-time").textContent = mmss(focus.mode ? focusLeft() : (db.settings.focusMin || 25) * 60000);
      const ring = $(".focus-ring"); if (ring && focus.mode) ring.replaceChildren(ringSvg(1 - focusLeft() / focus.total, 260, 14));
    } else if (!tickOnly) renderView();
  }
}
VIEWS.focus = (now) => {
  const running = Boolean(focus.mode);
  const today = db.focusLog.filter((x) => x.at.slice(0, 10) === ymd(now));
  const mins = today.reduce((n, x) => n + x.mins, 0);
  const weekMins = db.focusLog.filter((x) => parse(x.at) >= weekStart(now)).reduce((n, x) => n + x.mins, 0);
  const opts = [h("option", { value: "" }, "No specific task"),
    ...db.board.filter((c) => c.status !== "done").map((c) => h("option", { value: `board:${c.id}` }, `Things to Do · ${c.title}`)),
    ...db.todos.filter((t) => !t.done).map((t) => h("option", { value: `todo:${t.id}` }, `To-do · ${t.text}`))];
  const taskSel = h("select", { class: "mini-select wide", "aria-label": "Task" }, opts);
  const custom = h("input", { type: "number", min: "1", max: "180", value: String(db.settings.focusMin || 25), class: "mini-num", "aria-label": "Minutes" });
  const pick = () => { const [k, id] = taskSel.value.split(":"); if (!k) return {}; const it = (k === "board" ? db.board : db.todos).find((x) => String(x.id) === id); return it ? { kind: k, id: it.id, title: it.title || it.text } : {}; };
  const frac = running ? 1 - focusLeft() / focus.total : 0;
  const wrap = h("div", { class: "focus" },
    h("div", { class: "card focus-card" },
      h("div", { class: `focus-ring ${focus.mode || "idle"}` }, ringSvg(frac, 260, 14)),
      h("div", { class: "focus-center" },
        h("div", { class: "focus-mode" }, running ? (focus.mode === "break" ? "Break" : "Focus") : "Ready"),
        h("div", { class: "focus-time" }, mmss(running ? focusLeft() : (db.settings.focusMin || 25) * 60000)),
        h("div", { class: "focus-task muted" }, running ? focus.title || (focus.mode === "break" ? "Stretch, breathe, drink water" : "Deep work") : "Pick a task and start")),
      running
        ? h("div", { class: "focus-ctrl" },
          h("button", { class: "btn primary", onclick: focusPause }, icon(focus.paused ? "play" : "pause", 16), focus.paused ? "Resume" : "Pause"),
          h("button", { class: "btn ghost", onclick: focusStop }, icon("stop", 16), "Stop"))
        : h("div", { class: "focus-setup" },
          taskSel,
          h("div", { class: "focus-presets" },
            [[25, 5], [50, 10], [15, 3]].map(([f, b]) => h("button", { class: "chip-btn", onclick: () => { db.settings.focusMin = f; db.settings.breakMin = b; save(); custom.value = String(f); renderView(); } }, `${f} / ${b}`)),
            custom, h("span", { class: "muted small" }, "min")),
          h("button", { class: "btn primary big", onclick: () => { db.settings.focusMin = Number(custom.value) || 25; save(); focusStart(db.settings.focusMin, pick()); renderView(); } }, icon("play", 16), "Start focus"))),
    h("div", { class: "focus-stats" },
      h("div", { class: "card stat" }, h("div", { class: "stat-v" }, `${mins}`), h("div", { class: "stat-l" }, "minutes today")),
      h("div", { class: "card stat" }, h("div", { class: "stat-v" }, `${today.length}`), h("div", { class: "stat-l" }, "sessions today")),
      h("div", { class: "card stat" }, h("div", { class: "stat-v" }, `${Math.round(weekMins / 6) / 10}`), h("div", { class: "stat-l" }, "hours this week"))),
    today.length ? h("div", { class: "card list" }, today.slice().reverse().map((x) => h("div", { class: "tl-row" }, h("span", { class: "tl-icon" }, icon("clock", 13)), h("span", { class: "tl-text" }, x.title || "Focus session"), h("span", { class: "muted small" }, `${x.mins} min · ${timeText(parse(x.at))}`)))) : null);
  return [wrap, running ? `${focus.mode === "break" ? "Break" : "Focusing"} · ${mmss(focusLeft())} left` : `${mins} min focused today`];
};
hooks.cardActions.push((c) => (c.status === "done" ? null : h("button", { class: "icon-btn xs", title: "Start a focus session on this", "aria-label": "Focus on this", onclick: () => { focusStart(db.settings.focusMin || 25, { kind: "board", id: c.id, title: c.title }); setView("focus"); } }, icon("play", 12))));
setInterval(focusTick, 1000);

// ================================================================== Insights (weekly summary)
state.insightsWeek = 0;
function weekStats(ws) {
  const we = addDaysX(ws, 7); const now = new Date();
  const inWeek = (s) => { const d = parse(s); return d && d >= ws && d < we; };
  const completed = db.history.filter((e) => e.type === "completed" && inWeek(e.at) && !/^Focused /.test(e.text));
  const perDay = Array(7).fill(0);
  for (const e of completed) perDay[(parse(e.at).getDay() + 6) % 7]++;
  const missed = db.reminders.filter((r) => !r.done && r.due && inWeek(r.due) && parse(r.due) < now).length;
  const focusMin = db.focusLog.filter((x) => inWeek(x.at)).reduce((n, x) => n + x.mins, 0);
  let sched = 0; let hit = 0;
  for (const hb of db.habits) for (let i = 0; i < 7; i++) { const d = addDaysX(ws, i); if (d > now || !habitsScheduledOn(hb, d) || d < startOfDay(parse(hb.created))) continue; sched++; if (hb.log[ymd(d)]) hit++; }
  const created = db.history.filter((e) => e.type === "created" && inWeek(e.at)).length;
  return { completed: completed.length, perDay, missed, focusMin, habitRate: sched ? Math.round((hit / sched) * 100) : null, created };
}
function weeklySummaryText(offset = 0) {
  const ws = addDaysX(weekStart(new Date()), 7 * offset);
  const a = weekStats(ws); const b = weekStats(addDaysX(ws, -7));
  const best = a.perDay.indexOf(Math.max(...a.perDay));
  const parts = [`${offset ? "Last week" : "This week"} you completed ${a.completed} item${a.completed === 1 ? "" : "s"}`];
  if (b.completed) parts[0] += `, ${a.completed >= b.completed ? `up ${a.completed - b.completed}` : `down ${b.completed - a.completed}`} from the week before`;
  if (a.completed) parts.push(`your most productive day was ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][best]}`);
  if (a.missed) parts.push(`${a.missed} reminder${a.missed === 1 ? " is" : "s are"} still overdue`);
  if (a.focusMin) parts.push(`you focused for ${a.focusMin >= 60 ? `${Math.round(a.focusMin / 6) / 10} hours` : `${a.focusMin} minutes`}`);
  if (a.habitRate != null) parts.push(`and kept ${a.habitRate}% of your habits`);
  return `${parts.join(", ")}.`;
}
function barChart(values, labels, highlight, width = 560) {
  const W = Math.max(280, Math.round(width)); const H = 220; const pt = 18; const pb = 28; const pl = 8; const pr = 8;
  const max = Math.max(1, ...values); const n = values.length; const slot = (W - pl - pr) / n; const bw = Math.min(36, slot * 0.5);
  const ticks = [0, Math.ceil(max / 2), max];
  let s = `<svg class="bars" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Completed per day: ${values.map((v, i) => `${labels[i]} ${v}`).join(", ")}">`;
  for (const t of ticks) { const y = H - pb - ((H - pt - pb) * t) / max; s += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="grid"/><text x="${W - pr}" y="${y - 4}" class="tick" text-anchor="end">${t}</text>`; }
  values.forEach((v, i) => {
    const x = pl + slot * i + (slot - bw) / 2; const hgt = ((H - pt - pb) * v) / max; const y = H - pb - hgt;
    const r = Math.min(4, hgt / 2);
    const path = hgt > 0 ? `M${x},${H - pb} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - pb} Z` : "";
    s += `<g class="bar${i === highlight ? " hl" : ""}"><rect x="${pl + slot * i}" y="${pt}" width="${slot}" height="${H - pt - pb}" class="hit"/>${path ? `<path d="${path}"/>` : ""}<title>${labels[i]}: ${v} completed</title>`;
    if (i === highlight || v === max) s += `<text x="${x + bw / 2}" y="${y - 6}" class="val" text-anchor="middle">${v}</text>`;
    s += `<text x="${x + bw / 2}" y="${H - 8}" class="lbl" text-anchor="middle">${labels[i]}</text></g>`;
  });
  s += "</svg>";
  const t = document.createElement("template"); t.innerHTML = s; return t.content.firstChild;
}
function chartHolder(values, hl) {
  const holder = h("div", { class: "chart-holder" });
  const draw = () => { const w = holder.clientWidth; if (w) holder.replaceChildren(barChart(values, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], hl, w)); };
  requestAnimationFrame(draw);
  return holder;
}
window.addEventListener("resize", () => { if (state.view === "insights") renderView(); });
VIEWS.insights = (now) => {
  const off = state.insightsWeek;
  const ws = addDaysX(weekStart(now), 7 * off);
  const a = weekStats(ws); const b = weekStats(addDaysX(ws, -7));
  const delta = a.completed - b.completed;
  const label = `${ws.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${addDaysX(ws, 6).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  const tile = (v, l, sub, cls = "") => h("div", { class: `card stat ${cls}` }, h("div", { class: "stat-v" }, v), h("div", { class: "stat-l" }, l), sub ? h("div", { class: "stat-sub" }, sub) : null);
  const wdCount = Array(7).fill(0);
  for (const r of db.reminders) if (r.due) wdCount[(parse(r.due).getDay() + 6) % 7]++;
  const busiest = wdCount.some(Boolean) ? ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][wdCount.indexOf(Math.max(...wdCount))] : "—";
  const todayIdx = off === 0 ? (now.getDay() + 6) % 7 : -1;
  return [h("div", { class: "insights" },
    h("div", { class: "cal-bar" },
      h("div", { class: "cal-nav" },
        h("button", { class: "icon-btn", "aria-label": "Previous week", onclick: () => { state.insightsWeek--; renderView(); } }, icon("left", 18)),
        h("button", { class: "btn ghost sm", disabled: off === 0, onclick: () => { state.insightsWeek = 0; renderView(); } }, "This week"),
        h("button", { class: "icon-btn", "aria-label": "Next week", disabled: off >= 0, onclick: () => { state.insightsWeek++; renderView(); } }, icon("right", 18)),
        h("h2", { class: "cal-label" }, label))),
    h("div", { class: "card summary-card" }, icon("sparkles", 18), h("p", {}, weeklySummaryText(off)),
      h("button", { class: "btn ghost sm", onclick: () => say(weeklySummaryText(off), null, true) }, icon("volume", 14), "Read aloud")),
    h("div", { class: "stat-row" },
      tile(String(a.completed), "completed", b.completed || delta ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} vs previous week` : null, delta > 0 ? "up" : delta < 0 ? "down" : ""),
      tile(String(a.missed), "still overdue"),
      tile(a.focusMin >= 60 ? `${Math.round(a.focusMin / 6) / 10}h` : `${a.focusMin}m`, "focus time"),
      tile(a.habitRate == null ? "—" : `${a.habitRate}%`, "habits kept"),
      tile(busiest, "busiest day", "by reminders scheduled")),
    h("div", { class: "card chart-card" }, h("div", { class: "chart-head" }, h("strong", {}, "Completed per day"), h("span", { class: "muted small" }, `${a.created} new item${a.created === 1 ? "" : "s"} added this week`)),
      chartHolder(a.perDay, todayIdx))), label];
};

// ================================================================== Morning briefing
function briefingText(now = new Date()) {
  const today = db.reminders.filter((r) => !r.done && canSee(r) && r.due && dayDiff(parse(r.due), now) === 0).sort(byDue);
  const overdue = db.reminders.filter((r) => !r.done && canSee(r) && r.due && parse(r.due) < startOfDay(now)).length;
  const habits = habitsDueToday();
  const doing = db.board.filter((c) => c.status === "doing");
  const hr = now.getHours();
  const parts = [`${hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening"}! It's ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}.`];
  if (today.length) parts.push(`You have ${today.length} reminder${today.length === 1 ? "" : "s"} today: ${today.slice(0, 5).map((r) => `${rTitle(r)} at ${timeText(parse(r.due))}`).join(", ")}${today.length > 5 ? `, and ${today.length - 5} more` : ""}.`);
  else parts.push("Your schedule is clear today.");
  if (overdue) parts.push(`${overdue} item${overdue === 1 ? " is" : "s are"} overdue.`);
  if (habits.length) parts.push(`Habits to keep: ${habits.map((x) => x.name).join(", ")}.`);
  if (doing.length) parts.push(`In progress: ${doing.slice(0, 3).map((c) => c.title).join(", ")}.`);
  const todos = db.todos.filter((t) => !t.done).length;
  if (todos) parts.push(`And ${todos} thing${todos === 1 ? "" : "s"} on your to-do list.`);
  if (now.getDay() === 1) parts.push(weeklySummaryText(-1));
  return parts.join(" ");
}
function showBriefing() {
  openAssistant(false);
  const now = new Date();
  const today = db.reminders.filter((r) => !r.done && canSee(r) && r.due && dayDiff(parse(r.due), now) === 0).sort(byDue);
  const card = h("div", { class: "as-card list-card" }, h("div", { class: "as-card-kind" }, "Today"),
    today.length ? today.slice(0, 8).map((r) => h("div", { class: "as-li", style: `--c:${folderById(r.folder).color}` }, h("i", { class: "dot" }), h("span", {}, rTitle(r)), h("span", { class: "muted small" }, timeText(parse(r.due)))))
      : h("div", { class: "muted small" }, "Nothing scheduled"),
    habitsDueToday().length ? h("div", { class: "muted small" }, `Habits: ${habitsDueToday().map((x) => x.name).join(", ")}`) : null);
  reply(briefingText(now), card);
}
hooks.tick.push(() => {
  const s = db.settings; const now = new Date();
  if (!s.briefing || document.hidden || s.lastBriefing === ymd(now)) return;
  const [hh, mm] = (s.briefingTime || "08:00").split(":").map(Number);
  const at = new Date(now); at.setHours(hh, mm, 0, 0);
  if (now >= at && now - at < 4 * 3600000) { s.lastBriefing = ymd(now); save(); showBriefing(); }
});

// ================================================================== voice intents handled here
function extraIntent(p) {
  switch (p.intent) {
    case "briefing": { const t = briefingText(); return reply(t); }
    case "summary": setView("insights"); return reply(weeklySummaryText(0));
    case "focusStart": {
      let item = {};
      if (p.title) {
        const m = findItems(p.title, ["board", "todo"])[0];
        item = m ? { kind: m.kind, id: m.item.id, title: m.title } : { title: p.title };
      }
      const mins = p.minutes || db.settings.focusMin || 25;
      focusStart(mins, item); setView("focus");
      return reply(`Starting a ${mins}-minute focus session${item.title ? ` on “${item.title}”` : ""}. I'll tell you when it's time for a break.`);
    }
    case "focusStop": if (!focus.mode) return reply("No focus session is running."); focusStop(); return reply("Focus session stopped.");
    case "habitAdd": {
      const days = p.repeat === "weekdays" ? [1, 2, 3, 4, 5] : p.repeat === "weekly" && p.repeatDay != null ? [p.repeatDay] : [0, 1, 2, 3, 4, 5, 6];
      try { const hb = addHabit(p.title, days); render(); return reply(`New habit: “${hb.name}”. Say “check in ${hb.name.toLowerCase()}” when you've done it.`, null); } catch (e) { return reply(e.message); }
    }
    case "habitCheck": if (checkHabitByName(p.query)) return null; return reply(`I couldn't find a habit called “${p.query}”. Say “add a habit ${p.query.toLowerCase()}” to start one.`);
    default: return reply("Sorry, I can't do that yet.");
  }
}

// ================================================================== Location reminders
const GEO_KEY = "reminders.geoState";
let geoState = (() => { try { return JSON.parse(localStorage.getItem(GEO_KEY)) || {}; } catch { return {}; } })();
let geoWatch = null; let geoLast = null;
function geoDistance(a, b) {
  const R = 6371000; const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const geoWanted = () => db.settings.geo && db.places.length && db.reminders.some((r) => !r.done && r.geo && !r.reminded_at);
function geoSync() {
  if (!("geolocation" in navigator)) return;
  if (geoWanted() && !document.hidden) {
    if (geoWatch == null) geoWatch = navigator.geolocation.watchPosition(geoOnPos, (e) => { if (e.code === 1) { db.settings.geo = false; save(); toast("Location permission denied — location reminders are off"); } }, { enableHighAccuracy: false, maximumAge: 60000, timeout: 60000 });
  } else if (geoWatch != null) { navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
}
function geoOnPos(pos) {
  const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
  geoLast = here;
  for (const pl of db.places) {
    const d = geoDistance(here, pl); const prev = geoState[pl.id];
    const inside = prev ? d <= (pl.radius || 150) + 60 : d <= (pl.radius || 150);
    if (prev === undefined) { geoState[pl.id] = inside; continue; }
    if (inside !== prev) { geoState[pl.id] = inside; geoFire(pl, inside ? "arrive" : "leave"); }
  }
  try { localStorage.setItem(GEO_KEY, JSON.stringify(geoState)); } catch { /* ignore */ }
}
function geoFire(place, when) {
  const hits = db.reminders.filter((r) => !r.done && r.geo && r.geo.when === when && !r.reminded_at && findPlace(r.geo.place) === place);
  if (!hits.length) return;
  for (const r of hits) r.reminded_at = fmtSec(new Date());
  save();
  for (const r of hits) remind(r);
  render();
}
hooks.afterSave.push(() => setTimeout(geoSync, 0));
document.addEventListener("visibilitychange", geoSync);

// ================================================================== companion server: push + sync + AI proxy
// With an account, the server is the one the site is configured with (config.js); otherwise the user's own.
const serverUrl = () => String((SESSION ? SESSION.api || (window.NUDGE_CONFIG || {}).api : db.settings.server) || "").trim().replace(/\/+$/, "");
async function api(path, { method = "GET", body } = {}) {
  if (!serverUrl()) throw new Error("Add your server URL in Settings first");
  const headers = body ? { "Content-Type": "application/json" } : {};
  if (SESSION) headers.Authorization = `Bearer ${SESSION.token}`;
  let res;
  try { res = await fetch(serverUrl() + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("You're offline. Changes are saved on this device and will sync later."); }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && SESSION && /^\/(me|auth)\//.test(path)) { sessionExpired(); throw new Error("Please sign in again"); }
  if (!res.ok && res.status !== 409) throw new Error(j.error || `Server error ${res.status}`);
  return { status: res.status, ...j };
}
function sessionExpired() {
  try { localStorage.removeItem("nudge.session"); } catch { /* ignore */ }
  toast("Your session ended. Please sign in again.");
  setTimeout(() => location.replace("login.html"), 1200);
}
function deviceId() {
  let id = null;
  try { id = localStorage.getItem("reminders.deviceId"); } catch { /* ignore */ }
  if (!id) { id = b64url(rand(18)); try { localStorage.setItem("reminders.deviceId", id); } catch { /* ignore */ } }
  return id;
}

// ---------------------------------------------------------------- push
async function enablePush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser doesn't support push notifications. On iPhone, install the app to the home screen first.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site");
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api("/vapid");
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey && b64url(sub.options.applicationServerKey) !== publicKey) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64url(publicKey) });
  await api(`/device/${deviceId()}/subscribe`, { method: "POST", body: { subscription: sub.toJSON() } });
  db.settings.push = true; save();
  await pushSchedule(true);
}
async function disablePush() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch { /* ignore */ }
  try { await api(`/device/${deviceId()}`, { method: "DELETE" }); } catch { /* ignore */ }
  db.settings.push = false; save();
}
let pushTimer = null; let pushSig = "";
function pushItems() {
  const now = Date.now(); const horizon = now + 35 * 86400000; const s = db.settings;
  const items = [];
  for (const r of db.reminders) {
    if (r.done) continue;
    const t = remindTime(r); if (!t) continue;
    const at = t.getTime(); if (at < now - 60000 || at > horizon) continue;
    const f = folderById(r.folder);
    items.push({ id: r.id, at, nag: Boolean(r.nag), priority: r.priority, tag: `rem-${r.id}`,
      title: isPrivate(r) ? "🔒 Private reminder" : s.pushTitles ? `⏰ ${rTitle(r)}` : "⏰ Reminder",
      body: `${r.due ? `Due ${whenText(parse(r.due), new Date(at))}` : "Reminder"} · ${f.name}` });
  }
  items.sort((a, b) => a.at - b.at);
  if (s.briefing) {
    const [hh, mm] = (s.briefingTime || "08:00").split(":").map(Number);
    const b = new Date(); b.setHours(hh, mm, 0, 0); if (b.getTime() <= now || s.lastBriefing === ymd(b)) b.setDate(b.getDate() + 1);
    const n = db.reminders.filter((r) => !r.done && r.due && ymd(parse(r.due)) === ymd(b)).length;
    items.push({ id: `brief-${ymd(b)}`, at: b.getTime(), kind: "briefing", tag: "briefing", title: "☀️ Your day at a glance", body: `${n} reminder${n === 1 ? "" : "s"} today. Tap for your briefing.` });
  }
  return items.slice(0, 250);
}
async function pushSchedule(force) {
  if (!db.settings.push || !serverUrl()) return;
  const items = pushItems(); const sig = JSON.stringify(items);
  if (!force && sig === pushSig) return;
  await api(`/device/${deviceId()}/schedule`, { method: "PUT", body: { items } });
  pushSig = sig;
}
hooks.afterSave.push(() => { if (!db.settings.push) return; clearTimeout(pushTimer); pushTimer = setTimeout(() => pushSchedule().catch((e) => console.warn("push schedule", e)), 2500); });

// ---------------------------------------------------------------- end-to-end encrypted sync
const SYNC_COLS = ["reminders", "todos", "board", "notes", "folders", "habits", "places", "focusLog"];
const SYNC_BASE = SESSION ? `nudge.syncbase.${SESSION.user.id}` : "reminders-pro.syncbase";
const accountSync = () => Boolean(SESSION);
const sync = { key: null, id: null, busy: false, again: false, applying: false, status: "", timer: null };
async function sha256(text) { return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))); }
async function syncSetup(pass) {
  pass = String(pass || "").trim();
  if (pass.length < 12) throw new Error("Use a sync code of at least 12 characters");
  sync.id = [...(await sha256(`reminders-sync-id:${pass}`))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  const salt = (await sha256(`reminders-sync-salt:${pass}`)).slice(0, 16);
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  sync.key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function syncPart(d) { const o = {}; for (const k of SYNC_COLS) o[k] = d[k] || []; o.history = d.history || []; o.vault = d.vault || null; o.nextId = d.nextId || 1; return o; }
function mergeList(B, L, R) {
  const key = (x) => String(x.id);
  const mb = new Map(B.map((x) => [key(x), JSON.stringify(x)]));
  const ml = new Map(L.map((x) => [key(x), x])); const mr = new Map(R.map((x) => [key(x), x]));
  const ids = [...new Set([...L.map(key), ...R.map(key)])];
  const out = [];
  for (const id of ids) {
    const l = ml.get(id); const r = mr.get(id); const b = mb.get(id);
    const ls = l ? JSON.stringify(l) : undefined; const rs = r ? JSON.stringify(r) : undefined;
    let pick;
    if (ls === rs) pick = l;
    else if (ls === b) pick = r;          // only remote changed (or deleted)
    else if (rs === b) pick = l;          // only local changed (or deleted)
    else pick = l || r;                   // both changed: keep local; an edit beats a delete
    if (pick) out.push(pick);
  }
  return out;
}
function mergeDb(base, local, remote) {
  const out = { ...local };
  for (const k of SYNC_COLS) out[k] = mergeList((base && base[k]) || [], local[k] || [], remote[k] || []);
  const seen = new Set();
  out.history = [...(local.history || []), ...(remote.history || [])].filter((e) => { const k = `${e.at}|${e.text}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 400);
  out.vault = JSON.stringify(local.vault) !== JSON.stringify(base ? base.vault : null) ? local.vault : remote.vault;
  out.nextId = Math.max(local.nextId || 1, remote.nextId || 1);
  return out;
}
async function sealJSON(obj) {
  if (accountSync()) return JSON.stringify(obj); // account data is protected by the sign-in; the Private folder stays encrypted
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sync.key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ v: 1, iv: b64(iv), data: b64(ct) });
}
async function openJSON(str) {
  if (accountSync()) return JSON.parse(str);
  const o = JSON.parse(str);
  try { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(o.iv) }, sync.key, unb64(o.data)))); } catch { throw new Error("Wrong sync code for this data"); }
}
function syncStatus(t) { sync.status = t; const el = $("#syncStatus"); if (el) el.textContent = t; }
function applyMerged(m) {
  if (JSON.stringify(syncPart(db)) === JSON.stringify(m)) return;
  const vaultChanged = JSON.stringify(db.vault) !== JSON.stringify(m.vault);
  sync.applying = true;
  for (const k of SYNC_COLS) db[k] = m[k];
  db.history = m.history; db.vault = m.vault; db.nextId = Math.max(db.nextId, m.nextId || 1);
  save();
  sync.applying = false;
  if (vaultChanged && vault.key) { if (db.vault && db.vault.data) openVaultWith(vault.key).then((d) => { vault.data = d; render(); }).catch(() => lockVault(true)); else lockVault(true); }
  render();
}
async function syncNow(manual) {
  if (!accountSync() && (!db.settings.sync || !serverUrl() || !sync.key)) return;
  if (sync.busy) { sync.again = true; return; }
  const path = accountSync() ? "/me/data" : `/sync/${sync.id}`;
  sync.busy = true; syncStatus("Syncing…");
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const remote = await api(path);
      const remoteObj = remote.data ? await openJSON(remote.data) : null;
      let base = null; try { base = JSON.parse(localStorage.getItem(SYNC_BASE)); } catch { /* none */ }
      const local = syncPart(db);
      const merged = remoteObj ? mergeDb(base, local, remoteObj) : local;
      const put = await api(path, { method: "PUT", body: { baseRev: remote.rev, data: await sealJSON(merged) } });
      if (put.status === 409) continue;
      applyMerged(merged);
      try { localStorage.setItem(SYNC_BASE, JSON.stringify(merged)); } catch { /* storage full */ }
      syncStatus(`Synced at ${timeText(new Date())}`);
      if (manual) toast("Synced");
      sync.lastOk = Date.now();
      return true;
    }
    throw new Error("Too many changes at once — try again");
  } catch (e) {
    syncStatus(`Sync failed: ${e.message}`);
    if (manual) toast(`Sync failed: ${e.message}`);
    return false;
  } finally {
    sync.busy = false;
    if (sync.again) { sync.again = false; setTimeout(syncNow, 800); }
  }
}
hooks.afterSave.push(() => { if (sync.applying || !(accountSync() || (db.settings.sync && sync.key))) return; clearTimeout(sync.timer); sync.timer = setTimeout(syncNow, accountSync() ? 2500 : 4000); });
window.addEventListener("online", () => syncNow());
if (accountSync()) setTimeout(() => syncNow(), 400);
setInterval(() => { if (!document.hidden) syncNow(); }, 120000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
(async () => {
  try { const pass = localStorage.getItem("reminders.syncpass"); if (!accountSync() && pass && db.settings.sync) { await syncSetup(pass); syncNow(); } } catch (e) { console.warn("sync init", e); }
})();
async function signOut() {
  if (!(await syncNow())) {
    if (!confirm("Some changes haven't reached the server yet (are you offline?). Sign out anyway and lose them on this device?")) return;
  }
  try { await api("/auth/logout", { method: "POST" }); } catch { /* signed out locally anyway */ }
  try { if (db.settings.push) await disablePush(); } catch { /* ignore */ }
  try { localStorage.removeItem(KEY); localStorage.removeItem(SYNC_BASE); localStorage.removeItem("nudge.session"); } catch { /* ignore */ }
  location.replace("login.html");
}
async function changeAccountPassword(cur, next, again) {
  if (next.length < 8) throw new Error("Use a new password of at least 8 characters");
  if (next !== again) throw new Error("The new passwords don't match");
  const { loginKey } = await import("./auth.js");
  const email = SESSION.user.email;
  const r = await api("/auth/password", { method: "POST", body: { key: await loginKey(email, cur), newKey: await loginKey(email, next) } });
  SESSION.token = r.token; localStorage.setItem("nudge.session", JSON.stringify(SESSION));
}
function accountSection() {
  if (!SESSION) return null;
  const u = SESSION.user;
  const cur = h("input", { type: "password", class: "mini-select", placeholder: "Current password", autocomplete: "current-password", "aria-label": "Current password" });
  const nw = h("input", { type: "password", class: "mini-select", placeholder: "New password", autocomplete: "new-password", "aria-label": "New password" });
  const nw2 = h("input", { type: "password", class: "mini-select", placeholder: "Repeat new password", autocomplete: "new-password", "aria-label": "Repeat new password" });
  return [h("h3", {}, "Account"),
    row(u.name || u.email, u.name ? u.email : "Signed in",
      h("button", { class: "btn ghost sm", onclick: () => syncNow(true) }, icon("cloud", 13), "Sync now"),
      h("button", { class: "btn ghost sm", onclick: (e) => { if (confirm(`Sign out of Nudge (${u.email})?`)) busy(e.target, signOut); } }, "Sign out")),
    h("p", { class: "muted small", id: "syncStatus" }, sync.status || "Your reminders, notes and lists sync to your account automatically. Attachments and custom sounds stay on each device."),
    row("Change password", null, cur, nw, nw2, h("button", { class: "btn primary sm", onclick: (e) => busy(e.target, async () => { await changeAccountPassword(cur.value, nw.value, nw2.value); toast("Password changed. Other devices will need to sign in again."); }) }, "Change"))];
}
function newSyncCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = rand(20); let s = "";
  for (let i = 0; i < 20; i++) { s += alphabet[b[i] % alphabet.length]; if (i % 5 === 4 && i < 19) s += "-"; }
  return s;
}

// ---------------------------------------------------------------- AI fallback (Claude)
const AI_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["intent", "title", "due", "repeat", "folder", "priority", "notes", "range", "target", "minutes"],
  properties: {
    intent: { type: "string", enum: ["reminder", "todo", "board", "note", "query", "complete", "delete", "navigate", "snooze", "unknown"] },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    due: { anyOf: [{ type: "string" }, { type: "null" }] },
    repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly", "monthly", "yearly"] },
    folder: { anyOf: [{ type: "string" }, { type: "null" }] },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    notes: { anyOf: [{ type: "string" }, { type: "null" }] },
    range: { anyOf: [{ type: "string", enum: ["today", "tomorrow", "week", "overdue", "upcoming"] }, { type: "null" }] },
    target: { anyOf: [{ type: "string" }, { type: "null" }] },
    minutes: { anyOf: [{ type: "integer" }, { type: "null" }] },
  },
};
function aiSystem(now) {
  return [
    "You convert one spoken or typed request for a personal reminders app into JSON that matches the schema.",
    `Current local date and time: ${now.toLocaleString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} (${fmt(now)}).`,
    `Folders (use the id): ${db.folders.map((f) => `${f.id} = ${f.name}`).join(", ")}.`,
    "Intents: reminder = something to be reminded about (title + due); todo = a checklist or shopping item; board = a project task for the Things to Do board; note = information to save (put the text in notes, a short title in title); query = a question about the schedule (set range); complete / delete = an existing item (title = its name); navigate = open a screen (target is one of today, scheduled, all, overdue, flagged, history, todo, board, notes, calendar, habits, focus, insights); snooze = snooze the current alert (minutes); unknown = anything else.",
    "Write due as local time in the form YYYY-MM-DDTHH:MM with no timezone. Pick the next future time when the time is ambiguous; use 09:00 when only a day is given; null when no time is given.",
    "title is a short phrase in the user's own language without the time words, e.g. \"Call mom\". Use folder null unless the user names one. Use priority high only when the user says it is urgent or important.",
  ].join("\n");
}
async function aiCall(text) {
  const s = db.settings; const now = new Date(); const system = aiSystem(now);
  let res;
  if (!s.aiKey && serverUrl()) {
    res = await fetch(`${serverUrl()}/ai`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ system, text, schema: AI_SCHEMA }) });
  } else {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": s.aiKey, "anthropic-version": "2026-10-21", "anthropic-beta": "server-side-fallback-2026-07-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({ model: "claude-opus-5-5", max_tokens: 1024, fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema", schema: AI_SCHEMA } }, system, messages: [{ role: "user", content: text }] }),
    });
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j.error && (j.error.message || j.error)) || `AI request failed (${res.status})`);
  if (j.stop_reason === "refusal") throw new Error("The AI declined this request");
  const block = (j.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("Empty AI response");
  return JSON.parse(block.text);
}
function aiToParsed(a, local) {
  const p = { raw: local.raw, intent: a.intent || "unknown" };
  const folder = a.folder && db.folders.some((f) => f.id === a.folder) ? a.folder : null;
  const due = a.due && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(a.due) ? a.due.slice(0, 16) : null;
  switch (p.intent) {
    case "reminder": return { ...p, explicit: true, title: a.title || local.title, due, hasTime: Boolean(due), repeat: due ? a.repeat || "none" : "none", priority: a.priority === "normal" ? null : a.priority, folder, remind_before: null, nag: local.nag, geo: local.geo };
    case "todo": return { ...p, title: a.title };
    case "board": return { ...p, title: a.title, status: "todo", priority: a.priority, due };
    case "note": return { ...p, title: a.title || "Note", body: a.notes || a.title || "", folder };
    case "query": return { ...p, range: a.range || "today" };
    case "complete": return { ...p, query: a.title || "" };
    case "delete": return { ...p, query: a.title || "", kind: null };
    case "navigate": return { ...p, target: a.target || "today" };
    case "snooze": return { ...p, minutes: a.minutes || 10 };
    default: return local.intent === "reminder" ? local : p;
  }
}
async function aiAssist(text, local) {
  const thinking = addBubble("bot", "Thinking…");
  thinking.classList.add("thinking");
  try {
    const a = await aiCall(text);
    thinking.remove();
    return dispatch(aiToParsed(a, local), text);
  } catch (e) {
    thinking.remove();
    console.warn("AI fallback", e);
    if (/401|invalid x-api-key|authentication/i.test(e.message)) addBubble("bot", "The AI key was rejected — check it in Settings → AI assistant.");
    return dispatch(local, text);
  }
}

// ================================================================== biometric unlock (WebAuthn PRF)
const bioSupported = () => Boolean(window.PublicKeyCredential && navigator.credentials && window.isSecureContext);
async function bioPrf(rawId, salt) {
  const a = await navigator.credentials.get({ publicKey: { challenge: rand(32), allowCredentials: [{ type: "public-key", id: rawId }], userVerification: "required", timeout: 60000, extensions: { prf: { eval: { first: salt } } } } });
  const out = a.getClientExtensionResults().prf?.results?.first;
  if (!out) throw new Error("Fingerprint/face unlock isn't supported on this device");
  return out;
}
async function bioKek(buf) {
  const k = await crypto.subtle.importKey("raw", buf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("reminders-private-folder") }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function bioEnable() {
  if (!unlocked() || !vault.raw) throw new Error("Unlock the Private folder first");
  const salt = rand(32);
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: "Nudge" }, user: { id: rand(16), name: "private-folder", displayName: "Nudge · Private folder" }, challenge: rand(32),
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" }, timeout: 60000,
    extensions: { prf: { eval: { first: salt } } } } });
  const ext = cred.getClientExtensionResults().prf;
  if (!ext || ext.enabled === false) throw new Error("This device's fingerprint/face sensor can't protect encryption keys in the browser (WebAuthn PRF not supported).");
  const out = ext.results?.first || await bioPrf(cred.rawId, salt);
  db.vault = { ...db.vault, bio: { cred: b64(cred.rawId), salt: b64(salt), ...(await wrapRaw(await bioKek(out), vault.raw)) } };
  save();
  log("info", "Fingerprint/face unlock enabled for the Private folder");
}
async function bioUnlock() {
  const b = db.vault && db.vault.bio; if (!b) throw new Error("Fingerprint unlock isn't set up");
  const out = await bioPrf(unb64(b.cred), unb64(b.salt));
  let raw; try { raw = await unwrapRaw(await bioKek(out), b); } catch { throw new Error("Fingerprint unlock failed — use your password"); }
  await unlockWithDataKey(raw);
}
hooks.vaultDialog.push((mode) => { $("#vaultBio").hidden = !(mode === "unlock" && db.vault && db.vault.bio && bioSupported()); });
$("#vaultBio").addEventListener("click", async () => {
  try {
    await bioUnlock();
    $("#vaultDialog").close(); toast("Private folder unlocked"); render();
    while (pendingAfterUnlock.length) pendingAfterUnlock.shift()();
  } catch (e) { $("#vaultError").textContent = e.message; }
});

// ================================================================== settings sections
const row = (label, desc, ...right) => h("div", { class: "set-row" }, h("div", {}, h("div", { class: "set-label" }, label), desc ? h("div", { class: "muted small" }, desc) : null), h("div", { class: "row-btns" }, right));
const busy = async (btn, fn) => { const t = btn.textContent; btn.disabled = true; btn.textContent = "Working…"; try { await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; btn.textContent = t; openSettings(); } };
hooks.settings.push(({ toggle, s }) => [
  accountSection(),
  h("h3", {}, "Look & sound"),
  row("Accent colour", null, h("div", { class: "swatches small" }, Object.entries(ACCENTS).map(([k, v]) => h("button", { type: "button", class: `swatch${s.accent === k ? " on" : ""}`, style: `--c:${v[0]}`, "aria-label": k, title: k, onclick: () => { s.accent = k; save(); applyTheme(); openSettings(); } })))),
  row("Alarm sound", null,
    h("select", { class: "mini-select", "aria-label": "Alarm sound", onchange: (e) => { s.sound = e.target.value; save(); if (s.sound === "custom") $("#soundFile").click(); else playAlarm(null, true); } }, Object.entries(SOUNDS).map(([k, t]) => h("option", { value: k, selected: s.sound === k }, t))),
    h("button", { class: "btn ghost sm", onclick: () => playAlarm(null, true) }, icon("play", 12), "Test"),
    h("input", { type: "file", id: "soundFile", accept: "audio/*", hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; if (f.size > 5e6) { toast("Choose a sound under 5 MB"); return; } await idbPut("blobs", f, "sound"); s.sound = "custom"; save(); toast(`Alarm sound set to ${f.name}`); playAlarm(null, true); } })),
  row("Volume", null, h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: String(s.volume ?? 0.8), "aria-label": "Volume", onchange: (e) => { s.volume = Number(e.target.value); save(); playAlarm(null, true); } })),
  h("h3", {}, "Morning briefing"),
  toggle("briefing", "Daily briefing", "At the time below, the assistant reads out your day: reminders, overdue items, habits and tasks in progress."),
  row("Briefing time", null, h("input", { type: "time", class: "mini-select", value: s.briefingTime || "08:00", "aria-label": "Briefing time", onchange: (e) => { s.briefingTime = e.target.value; s.lastBriefing = ""; save(); } }),
    h("button", { class: "btn ghost sm", onclick: () => { $("#settingsDialog").close(); showBriefing(); } }, "Play now")),
  h("h3", {}, "Focus timer"),
  row("Focus / break length", "Minutes", h("input", { type: "number", min: "1", max: "180", class: "mini-num", value: String(s.focusMin || 25), "aria-label": "Focus minutes", onchange: (e) => { s.focusMin = Number(e.target.value) || 25; save(); } }),
    h("input", { type: "number", min: "1", max: "60", class: "mini-num", value: String(s.breakMin || 5), "aria-label": "Break minutes", onchange: (e) => { s.breakMin = Number(e.target.value) || 5; save(); } })),
  h("h3", {}, "Places & location reminders"),
  toggle("geo", "Location reminders", "“Remind me when I leave work”. Works while the app is open (or in recent apps).", () => { if (s.geo && navigator.geolocation) navigator.geolocation.getCurrentPosition(geoOnPos, () => {}); geoSync(); }),
  db.places.map((pl) => row(pl.name, `${pl.lat.toFixed(4)}, ${pl.lng.toFixed(4)} · ${pl.radius || 150} m radius`,
    h("button", { class: "icon-btn sm danger", "aria-label": `Delete ${pl.name}`, onclick: () => { db.places = db.places.filter((x) => x !== pl); delete geoState[pl.id]; save(); openSettings(); } }, icon("trash", 14)))),
  (() => {
    const name = h("input", { class: "mini-select", placeholder: db.places.some((p) => p.name === "Home") ? "Place name" : "Home", "aria-label": "Place name", maxlength: "40" });
    return row("Add a place", "Stand at the place, name it, and use your current location.", name,
      h("button", { class: "btn primary sm", onclick: (e) => {
        if (!navigator.geolocation) { toast("Location isn't available in this browser"); return; }
        const n = name.value.trim() || name.placeholder;
        const b = e.currentTarget; b.disabled = true; b.textContent = "Locating…";
        navigator.geolocation.getCurrentPosition((pos) => {
          db.places.push({ id: `pl${uid()}`, name: n.slice(0, 40), lat: pos.coords.latitude, lng: pos.coords.longitude, radius: Math.max(100, Math.min(500, Math.round(pos.coords.accuracy * 2) || 150)) });
          s.geo = true; save(); geoSync(); toast(`Saved “${n}”`); openSettings();
        }, (err) => { toast(`Couldn't get your location: ${err.message}`); openSettings(); }, { enableHighAccuracy: true, timeout: 20000 });
      } }, icon("map", 13), "Use my current location"));
  })(),
  h("h3", {}, "Calendar"),
  row("Export to your calendar app", "Downloads an .ics file with all upcoming reminders (with alarms and repeats). Google Calendar, Apple Calendar and Outlook can import it.",
    h("button", { class: "btn ghost sm", onclick: () => downloadICS(db.reminders.filter((r) => r.due && !r.done && canSee(r)), "reminders") }, icon("download", 14), "Export .ics")),
  db.vault ? [h("h3", {}, "Fingerprint / face unlock"),
    row(db.vault.bio ? "Enabled for the Private folder" : "Unlock the Private folder with your fingerprint or face",
      bioSupported() ? "Uses your device's screen lock (WebAuthn). Your password still works." : "Not available in this browser.",
      db.vault.bio ? h("button", { class: "btn ghost sm", onclick: () => { const { bio, ...rest } = db.vault; db.vault = rest; save(); openSettings(); } }, "Turn off")
        : h("button", { class: "btn primary sm", disabled: !bioSupported(), onclick: (e) => { const go = () => busy(e.target, async () => { await bioEnable(); toast("Fingerprint unlock is on"); }); if (unlocked()) go(); else requireVault(go); } }, icon("finger", 14), "Turn on"))] : null,
  h("h3", {}, SESSION ? "Notifications" : "Companion server (push · sync · AI)"),
  SESSION ? null : h("p", { class: "muted small" }, "Optional. Deploy the free Cloudflare Worker in push-worker/ (see the README) and paste its URL here to get notifications when the app is closed, sync between devices and a server-side AI key."),
  SESSION ? null : row("Server URL", null, h("input", { class: "mini-select wide", placeholder: "https://reminders-push.<you>.workers.dev", value: s.server || "", "aria-label": "Server URL", onchange: (e) => { s.server = e.target.value.trim(); save(); } }),
    h("button", { class: "btn ghost sm", onclick: (e) => busy(e.target, async () => { const r = await api("/health"); toast(`Server OK · push ${r.push ? "ready" : "not configured"} · AI ${r.ai ? "ready" : "off"}`); }) }, "Check")),
  row("Push notifications", s.push ? "On — reminders arrive even when the app is closed." : "Get reminders when the app is closed.",
    s.push ? [h("button", { class: "btn ghost sm", onclick: (e) => busy(e.target, async () => { const r = await api(`/device/${deviceId()}/test`, { method: "POST" }); toast(r.ok ? "Test notification sent" : `Push service said ${r.status}`); }) }, "Send test"),
      h("button", { class: "btn ghost sm", onclick: (e) => busy(e.target, disablePush) }, "Turn off")]
      : h("button", { class: "btn primary sm", disabled: !serverUrl(), onclick: (e) => busy(e.target, async () => { await enablePush(); toast("Push notifications are on"); }) }, icon("bell", 13), "Turn on")),
  s.push ? toggle("pushTitles", "Show reminder titles in push messages", "Off = notifications just say “Reminder” (private reminders never show their title).", () => pushSchedule(true).catch(() => {})) : null,
  SESSION ? null : (() => {
    let pass = ""; try { pass = localStorage.getItem("reminders.syncpass") || ""; } catch { /* ignore */ }
    const inp = h("input", { class: "mini-select wide mono", value: pass || newSyncCode(), "aria-label": "Sync code", spellcheck: "false" });
    return [row("Sync between devices", s.sync ? "On. Use the same sync code on your other devices." : "End-to-end encrypted: the server only stores data it can't read. Use the same code on every device.",
      s.sync ? [h("button", { class: "btn ghost sm", onclick: () => syncNow(true) }, icon("cloud", 13), "Sync now"),
        h("button", { class: "btn ghost sm", onclick: () => { s.sync = false; save(); try { localStorage.removeItem("reminders.syncpass"); localStorage.removeItem(SYNC_BASE); } catch { /* ignore */ } sync.key = null; openSettings(); } }, "Turn off")]
        : h("button", { class: "btn primary sm", disabled: !s.server, onclick: (e) => busy(e.target, async () => { await syncSetup(inp.value); try { localStorage.setItem("reminders.syncpass", inp.value.trim()); localStorage.removeItem(SYNC_BASE); } catch { /* ignore */ } s.sync = true; save(); await syncNow(true); }) }, icon("cloud", 13), "Turn on")),
    row("Sync code", s.sync ? "Keep it secret — anyone with it can read your synced data." : "Keep this code: it's the only key to your synced data.", inp, h("button", { class: "btn ghost sm", onclick: () => { navigator.clipboard?.writeText(inp.value); toast("Sync code copied"); } }, "Copy")),
    h("p", { class: "muted small", id: "syncStatus" }, sync.status || (s.sync ? "" : "Attachments and custom sounds stay on each device."))];
  })(),
  h("h3", {}, "AI assistant (Claude)"),
  toggle("ai", "Use AI when the assistant doesn't understand", "Unclear requests are sent to Claude (claude-opus-5-5) to work out what you meant. Only that one sentence is sent."),
  s.ai ? row("Anthropic API key", serverUrl() ? "Leave empty to use the key stored on your companion server." : "Stored only in this browser. Anyone with access to this device could read it.",
    h("input", { type: "password", class: "mini-select wide", value: s.aiKey || "", placeholder: "sk-ant-…", autocomplete: "off", "aria-label": "Anthropic API key", onchange: (e) => { s.aiKey = e.target.value.trim(); save(); } })) : null,
]);

// ================================================================== home-screen shortcuts & share target
(function handleLaunchParams() {
  const q = new URLSearchParams(location.search);
  const action = q.get("action");
  const shared = [q.get("title"), q.get("text"), q.get("url")].filter(Boolean).join("\n").trim();
  if (!action && !q.get("share")) return;
  history.replaceState(null, "", location.pathname);
  setTimeout(() => {
    if (q.get("share") && shared) {
      openAssistant(false);
      const text = (q.get("text") || q.get("title") || shared).split("\n")[0].slice(0, 200);
      const url = q.get("url") || (shared.match(/https?:\/\/\S+/) || [])[0] || "";
      addBubble("bot", "Save what you shared as…", h("div", { class: "as-card-actions wrap" },
        h("button", { class: "btn primary sm", onclick: () => { closeAssistant(); const p = parseReminderText(text, "all") || { title: text }; openEditor(null, { title: p.title || text, due: p.due, notes: url, folder: "personal" }); } }, icon("bell", 14), "Reminder"),
        h("button", { class: "btn ghost sm", onclick: () => { const n = addNote({ title: q.get("title") || text.slice(0, 60), body: shared }); state.noteId = n.id; closeAssistant(); setView("notes"); } }, icon("notes", 14), "Note"),
        h("button", { class: "btn ghost sm", onclick: () => { addTodo(text); closeAssistant(); setView("todo"); } }, icon("todo", 14), "To-do")));
      return;
    }
    if (action === "new") openEditor(null, { folder: "personal" });
    else if (action === "voice") openAssistant(true);
    else if (action === "briefing") showBriefing();
    else if (["today", "todo", "notes", "calendar", "habits", "focus", "insights", "board"].includes(action)) setView(action);
  }, 300);
})();

// ================================================================== boot
(async () => {
  // drop attachments whose reminder no longer exists
  try {
    const all = await idbDo("files", "readonly", (st) => st.getAll());
    const ids = new Set(db.reminders.map((r) => r.id));
    for (const f of all || []) if (!ids.has(f.rid)) await idbDel("files", f.id);
  } catch { /* storage unavailable */ }
})();
if (db.settings.push) setTimeout(() => pushSchedule(true).catch((e) => console.warn("push", e)), 3000);
applyTheme();
geoSync();
render();
focusRender();
