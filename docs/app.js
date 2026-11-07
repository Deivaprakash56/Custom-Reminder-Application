"use strict";
// Task Reminder - serverless edition (GitHub Pages / installable PWA).
// Tasks are stored on this device (localStorage). The reminder check runs in the page
// every 15 s and again whenever the app comes back to the foreground.

const KEY = "task-reminder.v1";
const CHECK_MS = 15000;
const $ = (s, el = document) => el.querySelector(s);
const state = { filter: "active", search: "" };

// ------------------------------------------------------------------ time helpers
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtSec = (d) => `${fmt(d)}:${pad(d.getSeconds())}`;
const parse = (s) => (s ? new Date(s.length === 16 ? `${s}:00` : s) : null); // local time
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
const addMin = (d, m) => new Date(d.getTime() + m * 60000);

function relative(due, now) {
  const mins = Math.round((due - now) / 60000);
  const abs = Math.abs(mins);
  const span = abs < 60 ? `${abs} min` : abs < 1440 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} d`;
  if (abs === 0) return "now";
  return mins > 0 ? `in ${span}` : `${span} overdue`;
}

function whenText(due, now) {
  const d = dayDiff(due, now);
  const time = due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d === 0) return `Today ${time}`;
  if (d === 1) return `Tomorrow ${time}`;
  if (d === -1) return `Yesterday ${time}`;
  const opts = { weekday: "short", day: "numeric", month: "short" };
  if (due.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return `${due.toLocaleDateString([], opts)} ${time}`;
}

function addMonths(d, n) {
  const day = d.getDate();
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, last));
  return r;
}

function nextOccurrence(due, repeat, after) {
  const step = {
    daily: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours(), d.getMinutes()),
    weekly: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7, d.getHours(), d.getMinutes()),
    monthly: (d) => addMonths(d, 1),
    weekdays: (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + ({ 5: 3, 6: 2 }[d.getDay()] || 1),
      d.getHours(), d.getMinutes()),
  }[repeat];
  let n = step(due);
  while (n <= after) n = step(n);
  return n;
}

// ------------------------------------------------------------------ storage (this device)
const PRIORITIES = ["low", "normal", "high"];
const REPEATS = ["none", "daily", "weekdays", "weekly", "monthly"];

const store = {
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.tasks)) return d;
    } catch { /* fall through */ }
    return { nextId: 1, tasks: [] };
  },
  save(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { alert(`Could not save: ${e.message}`); }
  },
  remindTime(t) {
    if (t.done) return null;
    if (t.snoozed_until) return parse(t.snoozed_until);
    const due = parse(t.due);
    return due ? addMin(due, -t.remind_before) : null;
  },
  clean(data, partial) {
    const out = {};
    if ("title" in data || !partial) {
      const title = String(data.title || "").trim();
      if (!title) throw new Error("Please enter a title");
      out.title = title.slice(0, 200);
    }
    if ("notes" in data) out.notes = String(data.notes || "").slice(0, 2000);
    if ("due" in data) {
      if (data.due && Number.isNaN(parse(data.due)?.getTime())) throw new Error("Invalid date/time");
      out.due = data.due ? String(data.due).slice(0, 16) : null;
    }
    if ("remind_before" in data) out.remind_before = Math.max(0, Math.min(10080, Number(data.remind_before) || 0));
    if ("priority" in data) {
      if (!PRIORITIES.includes(data.priority)) throw new Error("Invalid priority");
      out.priority = data.priority;
    }
    if ("repeat" in data) {
      if (!REPEATS.includes(data.repeat)) throw new Error("Invalid repeat");
      out.repeat = data.repeat;
    }
    return out;
  },
  list() {
    return this.load().tasks.slice().sort((a, b) =>
      (a.done - b.done) || ((a.due === null) - (b.due === null)) ||
      String(a.due).localeCompare(String(b.due)) || (a.id - b.id));
  },
  create(data) {
    const d = this.load();
    const f = this.clean(data, false);
    const t = { id: d.nextId++, title: "", notes: "", due: null, remind_before: 0, priority: "normal",
      repeat: "none", snoozed_until: null, reminded_at: null, done: false, completed_at: null,
      created_at: fmt(new Date()), ...f };
    if (t.repeat !== "none" && !t.due) throw new Error("A repeating task needs a due date & time");
    d.tasks.push(t);
    this.save(d);
    return t;
  },
  mutate(id, fn) {
    const d = this.load();
    const t = d.tasks.find((x) => x.id === id);
    if (!t) throw new Error("Task not found");
    fn(t, d);
    this.save(d);
    return t;
  },
  update(id, data) {
    const f = this.clean(data, true);
    return this.mutate(id, (t) => {
      if ((f.repeat ?? t.repeat) !== "none" && !(("due" in f) ? f.due : t.due)) {
        throw new Error("A repeating task needs a due date & time");
      }
      if (("due" in f && f.due !== t.due) || ("remind_before" in f && f.remind_before !== t.remind_before)) {
        f.reminded_at = null;
        f.snoozed_until = null;
      }
      Object.assign(t, f);
    });
  },
  remove(id) {
    const d = this.load();
    d.tasks = d.tasks.filter((t) => t.id !== id);
    this.save(d);
  },
  setDone(id, done) {
    return this.mutate(id, (t) => {
      const now = new Date();
      if (done && t.repeat !== "none" && t.due) {
        t.due = fmt(nextOccurrence(parse(t.due), t.repeat, now));
        Object.assign(t, { reminded_at: null, snoozed_until: null, completed_at: fmt(now) });
      } else if (done) {
        Object.assign(t, { done: true, completed_at: fmt(now), snoozed_until: null });
      } else {
        Object.assign(t, { done: false, completed_at: null, reminded_at: null });
      }
    });
  },
  snooze(id, minutes) {
    return this.mutate(id, (t) => {
      Object.assign(t, { snoozed_until: fmt(addMin(new Date(), minutes)), reminded_at: null });
    });
  },
  dueNow() {
    const d = this.load();
    const now = new Date();
    const fired = d.tasks.filter((t) => !t.done && !t.reminded_at && (this.remindTime(t) || Infinity) <= now);
    if (fired.length) {
      for (const t of fired) t.reminded_at = fmtSec(now);
      this.save(d);
    }
    return fired;
  },
};

// ------------------------------------------------------------------ rendering
const REPEAT_LABEL = { daily: "every day", weekdays: "weekdays", weekly: "every week", monthly: "every month" };

function groupOf(t, now) {
  if (t.done) return "Completed";
  const due = parse(t.due);
  if (!due) return "No date";
  if (due < now) return "Overdue";
  const d = dayDiff(due, now);
  return d === 0 ? "Today" : d === 1 ? "Tomorrow" : d < 7 ? "This week" : "Later";
}

function visible(t, now) {
  const q = state.search.trim().toLowerCase();
  if (q && !`${t.title} ${t.notes}`.toLowerCase().includes(q)) return false;
  const due = parse(t.due);
  switch (state.filter) {
    case "active": return !t.done;
    case "today": return !t.done && due && dayDiff(due, now) <= 0;
    case "overdue": return !t.done && due && due < now;
    case "upcoming": return !t.done && due && due >= now;
    case "done": return t.done;
    default: return true;
  }
}

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

function taskCard(t, now) {
  const due = parse(t.due);
  const overdue = !t.done && due && due < now;
  const meta = [];
  if (due) {
    meta.push(el("span", {}, whenText(due, now)));
    if (!t.done) meta.push(el("span", { class: overdue ? "late" : "" }, relative(due, now)));
  }
  if (t.repeat !== "none") meta.push(el("span", { class: "badge" }, `↻ ${REPEAT_LABEL[t.repeat]}`));
  if (t.priority !== "normal") meta.push(el("span", { class: "badge" }, `${t.priority} priority`));
  if (t.snoozed_until && !t.done) meta.push(el("span", { class: "badge" }, `💤 until ${whenText(parse(t.snoozed_until), now)}`));
  if (t.done && t.completed_at) meta.push(el("span", {}, `done ${whenText(parse(t.completed_at), now)}`));

  const tools = t.done
    ? [el("button", { onclick: () => act(() => store.setDone(t.id, false)) }, "Reopen")]
    : [
        el("button", { title: "Snooze 10 minutes", onclick: () => act(() => store.snooze(t.id, 10)) }, "+10m"),
        el("button", { title: "Snooze 1 hour", onclick: () => act(() => store.snooze(t.id, 60)) }, "+1h"),
        el("button", { onclick: () => openEdit(t) }, "Edit"),
      ];
  tools.push(el("button", { title: "Delete", "aria-label": `Delete ${t.title}`, onclick: () => remove(t) }, "🗑"));

  return el("article", { class: `task p-${t.priority}${overdue ? " is-overdue" : ""}${t.done ? " is-done" : ""}` },
    el("button", {
      class: "check",
      title: t.done ? "Mark as not done" : t.repeat !== "none" ? "Done - move to next occurrence" : "Mark done",
      "aria-label": t.done ? `Reopen ${t.title}` : `Complete ${t.title}`,
      onclick: () => act(() => store.setDone(t.id, !t.done)),
    }, t.done ? "✓" : ""),
    el("div", { class: "body" },
      el("div", { class: "title" }, t.title),
      meta.length ? el("div", { class: "meta" }, meta) : null,
      t.notes ? el("div", { class: "notes" }, t.notes) : null),
    el("div", { class: "tools" }, tools));
}

function render() {
  const now = new Date();
  const tasks = store.list();
  const shown = tasks.filter((t) => visible(t, now));
  const order = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date", "Completed"];
  const groups = new Map(order.map((g) => [g, []]));
  for (const t of shown) groups.get(groupOf(t, now)).push(t);

  const list = $("#list");
  list.replaceChildren();
  if (!shown.length) {
    list.append(el("p", { class: "empty" }, tasks.length ? "Nothing here. 🎉" : "No tasks yet - add your first one above."));
  }
  for (const [name, items] of groups) {
    if (!items.length) continue;
    list.append(el("section", { class: `group ${name.toLowerCase().replace(/\s/g, "-")}` },
      el("h3", {}, `${name} · ${items.length}`), items.map((t) => taskCard(t, now))));
  }
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && parse(t.due) < now).length;
  const today = open.filter((t) => t.due && dayDiff(parse(t.due), now) === 0).length;
  $("#summary").textContent = `${open.length} open · ${today} due today` + (overdue ? ` · ${overdue} overdue` : "");
  document.title = overdue ? `(${overdue}) Task Reminder` : "Task Reminder";
}

// ------------------------------------------------------------------ reminders
let audioCtx;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;
    [880, 1175, 880].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 0.21);
    });
  } catch { /* sound is optional */ }
}

async function systemNotify(t, text) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const opts = {
    body: t.notes ? `${text}\n${t.notes}` : text,
    tag: `task-${t.id}`,
    renotify: true,
    requireInteraction: t.priority === "high",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    vibrate: [200, 100, 200],
    data: { id: t.id },
    actions: [{ action: "done", title: "Done" }, { action: "snooze", title: "Snooze 10 min" }],
  };
  try {
    // Android only allows notifications through the service worker.
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) return await reg.showNotification(`⏰ ${t.title}`, opts);
    new Notification(`⏰ ${t.title}`, opts);
  } catch { /* in-page alert still shows */ }
}

function remind(t) {
  const due = parse(t.due);
  const text = due ? `Due ${whenText(due, new Date())}` : "Reminder";
  chime();
  systemNotify(t, text);
  const box = el("div", { class: `alert p-${t.priority}`, role: "alertdialog", "aria-label": `Reminder: ${t.title}` },
    el("strong", {}, `⏰ ${t.title}`),
    el("span", { class: "muted" }, text),
    el("div", { class: "tools" },
      el("button", { class: "primary", onclick: () => { box.remove(); act(() => store.setDone(t.id, true)); } }, "Done"),
      el("button", { onclick: () => { box.remove(); act(() => store.snooze(t.id, 10)); } }, "Snooze 10m"),
      el("button", { onclick: () => { box.remove(); act(() => store.snooze(t.id, 60)); } }, "1h"),
      el("button", { class: "ghost", onclick: () => box.remove() }, "Dismiss")));
  $("#alerts").append(box);
}

function checkReminders() {
  for (const t of store.dueNow()) remind(t);
  render();
}

function handleAction(id, action) {
  id = Number(id);
  try {
    if (action === "done") store.setDone(id, true);
    else if (action === "snooze") store.snooze(id, 10);
  } catch { /* task may have been deleted */ }
  render();
}

// ------------------------------------------------------------------ actions
function act(fn) {
  try { fn(); } catch (e) { alert(e.message); }
  render();
}
function remove(t) {
  if (confirm(`Delete "${t.title}"?`)) act(() => store.remove(t.id));
}

function formData(form) {
  const f = new FormData(form);
  return {
    title: f.get("title"),
    due: f.get("due") || null,
    remind_before: Number(f.get("remind_before")),
    priority: f.get("priority"),
    repeat: f.get("repeat"),
    notes: f.get("notes"),
  };
}

$("#addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  try {
    store.create(formData(e.target));
    e.target.reset();
    $("#formError").textContent = "";
    $("#title").focus();
    checkReminders();
  } catch (err) {
    $("#formError").textContent = err.message;
  }
});

$(".quick").addEventListener("click", (e) => {
  const q = e.target.dataset.quick;
  if (!q) return;
  const d = new Date();
  d.setSeconds(0, 0);
  if (q === "10m") d.setMinutes(d.getMinutes() + 10);
  else if (q === "1h") d.setHours(d.getHours() + 1);
  else if (q === "tonight") { d.setHours(20, 0); if (d < new Date()) d.setDate(d.getDate() + 1); }
  else if (q === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(9, 0); }
  $("#addForm").due.value = q === "clear" ? "" : fmt(d);
});

let editing = null;
function openEdit(t) {
  editing = t;
  const f = $("#editForm");
  f.title.value = t.title;
  f.due.value = t.due || "";
  f.remind_before.value = String(t.remind_before);
  if (!f.remind_before.value) f.remind_before.value = "0";
  f.priority.value = t.priority;
  f.repeat.value = t.repeat;
  f.notes.value = t.notes;
  $("#editError").textContent = "";
  $("#editDialog").showModal();
}
$("#editForm").addEventListener("submit", (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  e.preventDefault();
  try {
    store.update(editing.id, formData(e.target));
    $("#editDialog").close();
    checkReminders();
  } catch (err) {
    $("#editError").textContent = err.message;
  }
});

$(".filters").addEventListener("click", (e) => {
  const f = e.target.dataset.filter;
  if (!f) return;
  state.filter = f;
  for (const b of document.querySelectorAll(".filters button")) b.classList.toggle("on", b.dataset.filter === f);
  render();
});
$("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });

// ------------------------------------------------------------------ backup (move tasks between devices)
$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store.load(), null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `tasks-${fmt(new Date()).slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const tasks = Array.isArray(data) ? data : data.tasks;
    if (!Array.isArray(tasks)) throw new Error("Not a Task Reminder backup file");
    if (!confirm(`Replace the tasks on this device with ${tasks.length} task(s) from the backup?`)) return;
    const clean = tasks.filter((t) => t && t.title).map((t, i) => ({
      id: i + 1, title: String(t.title).slice(0, 200), notes: String(t.notes || ""), due: t.due || null,
      remind_before: Number(t.remind_before) || 0, priority: PRIORITIES.includes(t.priority) ? t.priority : "normal",
      repeat: REPEATS.includes(t.repeat) ? t.repeat : "none", snoozed_until: t.snoozed_until || null,
      reminded_at: t.reminded_at || null, done: Boolean(t.done), completed_at: t.completed_at || null,
      created_at: t.created_at || fmt(new Date()),
    }));
    store.save({ nextId: clean.length + 1, tasks: clean });
    render();
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
});

// ------------------------------------------------------------------ app setup
const nb = $("#notifyBtn");
function updateNotifyBtn() {
  nb.hidden = !("Notification" in window) || Notification.permission !== "default";
}
nb.addEventListener("click", async () => {
  await Notification.requestPermission();
  updateNotifyBtn();
  chime(); // also unlocks audio after a user gesture
});
updateNotifyBtn();
document.addEventListener("click", () => { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); });

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("#installBtn").hidden = false;
});
$("#installBtn").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#installBtn").hidden = true;
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* still works online */ });
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "reminder-action") handleAction(e.data.id, e.data.action);
  });
}

// Opened from a notification button while the app was closed.
const params = new URLSearchParams(location.search);
if (params.get("task")) {
  handleAction(params.get("task"), params.get("action"));
  history.replaceState(null, "", location.pathname);
}

window.addEventListener("storage", (e) => { if (e.key === KEY) render(); }); // other tabs
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminders(); });
checkReminders();
setInterval(checkReminders, CHECK_MS);
