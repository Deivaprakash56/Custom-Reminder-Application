"use strict";
// Nudge front end: talks to server.py's JSON API, polls for reminders.

const POLL_MS = 10000;
const $ = (s, el = document) => el.querySelector(s);
const state = { tasks: [], filter: "active", search: "", lastSeen: null, serverNow: null };

// ------------------------------------------------------------------ API
async function api(path, method = "GET", body) {
  const res = await fetch(`/api/tasks${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ------------------------------------------------------------------ time helpers
const pad = (n) => String(n).padStart(2, "0");
const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const parse = (s) => (s ? new Date(s) : null); // "YYYY-MM-DDTHH:MM" parses as local time
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);

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
    ? [el("button", { onclick: () => act(t.id, "/undone") }, "Reopen")]
    : [
        el("button", { title: "Snooze 10 minutes", onclick: () => snooze(t.id, 10) }, "+10m"),
        el("button", { title: "Snooze 1 hour", onclick: () => snooze(t.id, 60) }, "+1h"),
        el("button", { onclick: () => openEdit(t) }, "Edit"),
      ];
  tools.push(el("button", { title: "Delete", "aria-label": `Delete ${t.title}`, onclick: () => remove(t) }, "🗑"));

  return el("article", {
      class: `task p-${t.priority}${overdue ? " is-overdue" : ""}${t.done ? " is-done" : ""}`,
    },
    el("button", {
      class: "check",
      title: t.done ? "Mark as not done" : t.repeat !== "none" ? "Done - move to next occurrence" : "Mark done",
      "aria-label": t.done ? `Reopen ${t.title}` : `Complete ${t.title}`,
      onclick: () => act(t.id, t.done ? "/undone" : "/done"),
    }, t.done ? "✓" : ""),
    el("div", { class: "body" },
      el("div", { class: "title" }, t.title),
      meta.length ? el("div", { class: "meta" }, meta) : null,
      t.notes ? el("div", { class: "notes" }, t.notes) : null),
    el("div", { class: "tools" }, tools));
}

function render() {
  const now = new Date();
  const list = $("#list");
  const shown = state.tasks.filter((t) => visible(t, now));
  const order = ["Overdue", "Today", "Tomorrow", "This week", "Later", "No date", "Completed"];
  const groups = new Map(order.map((g) => [g, []]));
  for (const t of shown) groups.get(groupOf(t, now)).push(t);

  list.replaceChildren();
  if (!shown.length) {
    list.append(el("p", { class: "empty" },
      state.tasks.length ? "Nothing here. 🎉" : "No tasks yet - add your first one above."));
  }
  for (const [name, items] of groups) {
    if (!items.length) continue;
    list.append(el("section", { class: `group ${name.toLowerCase().replace(/\s/g, "-")}` },
      el("h3", {}, `${name} · ${items.length}`), items.map((t) => taskCard(t, now))));
  }

  const open = state.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && parse(t.due) < now).length;
  const today = open.filter((t) => t.due && dayDiff(parse(t.due), now) === 0).length;
  $("#summary").textContent =
    `${open.length} open · ${today} due today` + (overdue ? ` · ${overdue} overdue` : "");
  document.title = overdue ? `(${overdue}) Nudge` : "Nudge";
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

function remind(t) {
  const due = parse(t.due);
  const text = due ? `Due ${whenText(due, new Date())}` : "Reminder";
  chime();
  if ("Notification" in window && Notification.permission === "granted") {
    const n = new Notification(`⏰ ${t.title}`, { body: t.notes ? `${text}\n${t.notes}` : text, tag: `task-${t.id}` });
    n.onclick = () => { window.focus(); n.close(); };
  }
  const box = el("div", { class: `alert p-${t.priority}`, role: "alertdialog", "aria-label": `Reminder: ${t.title}` },
    el("strong", {}, `⏰ ${t.title}`),
    el("span", { class: "muted" }, text),
    el("div", { class: "tools" },
      el("button", { class: "primary", onclick: () => { box.remove(); act(t.id, "/done"); } }, "Done"),
      el("button", { onclick: () => { box.remove(); snooze(t.id, 10); } }, "Snooze 10m"),
      el("button", { onclick: () => { box.remove(); snooze(t.id, 60); } }, "1h"),
      el("button", { class: "ghost", onclick: () => box.remove() }, "Dismiss")));
  $("#alerts").append(box);
}

function checkReminders() {
  // The server stamps reminded_at when a reminder fires; show the ones newer than our last look.
  if (state.lastSeen !== null) {
    for (const t of state.tasks) {
      if (t.reminded_at && t.reminded_at > state.lastSeen && !t.done) remind(t);
    }
  }
  state.lastSeen = state.serverNow;
}

async function refresh() {
  try {
    const data = await api("");
    state.tasks = data.tasks;
    state.serverNow = data.now;
    checkReminders();
    render();
  } catch (e) {
    $("#summary").textContent = `Can't reach the server (${e.message}) - is server.py running?`;
  }
}

// ------------------------------------------------------------------ actions
async function act(id, action) {
  try { await api(`/${id}${action}`, "POST"); } catch (e) { alert(e.message); }
  refresh();
}
async function snooze(id, minutes) {
  try { await api(`/${id}/snooze`, "POST", { minutes }); } catch (e) { alert(e.message); }
  refresh();
}
async function remove(t) {
  if (!confirm(`Delete "${t.title}"?`)) return;
  try { await api(`/${t.id}`, "DELETE"); } catch (e) { alert(e.message); }
  refresh();
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

$("#addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api("", "POST", formData(form));
    form.reset();
    $("#formError").textContent = "";
    $("#title").focus();
    refresh();
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
  $("#addForm").due.value = q === "clear" ? "" : toLocalInput(d);
});

// edit dialog
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
$("#editForm").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value === "cancel") return;
  e.preventDefault();
  try {
    await api(`/${editing.id}`, "PUT", formData(e.target));
    $("#editDialog").close();
    refresh();
  } catch (err) {
    $("#editError").textContent = err.message;
  }
});

// filters + search
$(".filters").addEventListener("click", (e) => {
  const f = e.target.dataset.filter;
  if (!f) return;
  state.filter = f;
  for (const b of document.querySelectorAll(".filters button")) b.classList.toggle("on", b.dataset.filter === f);
  render();
});
$("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });

// browser notifications (only offered where the browser allows them: localhost / https)
const nb = $("#notifyBtn");
if ("Notification" in window && Notification.permission === "default") {
  nb.hidden = false;
  nb.addEventListener("click", async () => {
    await Notification.requestPermission();
    nb.hidden = true;
    chime(); // also unlocks audio playback after a user gesture
  });
}
document.addEventListener("click", () => { if (audioCtx && audioCtx.state === "suspended") audioCtx.resume(); });

refresh();
setInterval(refresh, POLL_MS);
setInterval(render, 30000); // keep "in 5 min" texts fresh between polls
