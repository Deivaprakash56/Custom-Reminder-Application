// Builds a realistic demo database for the app. NOW is Thursday 12 Nov 2026, 10:30.
module.exports = function seed(nowMs, opts = {}) {
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtSec = (d) => `${fmt(d)}:${pad(d.getSeconds())}`;
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date(nowMs);
  const at = (dayOff, h, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOff, h, m);
  let id = 1000;
  const R = (title, due, extra = {}) => ({
    id: id++, title, notes: "", due: due ? fmt(due) : null, remind_before: 0, priority: "normal", repeat: "none",
    folder: "personal", snoozed_until: null, reminded_at: null, done: false, completed_at: null, created_at: fmt(at(-3, 9)), ...extra,
  });
  const reminders = [
    R("Team stand-up", at(0, 11, 0), { folder: "work", repeat: "weekdays" }),
    R("Send the Q4 budget to Priya", at(0, 13, 30), { folder: "work", priority: "high", notes: "Use the updated forecast sheet",
      subtasks: [{ text: "Update forecast", done: true }, { text: "Add marketing costs", done: true }, { text: "Review with finance", done: false }] }),
    R("Pick up dry cleaning", at(0, 17, 30)),
    R("Gym: leg day", at(0, 19, 0), { repeat: "weekly" }),
    R("Pay the electricity bill", at(-1, 18, 0), { priority: "high", reminded_at: fmtSec(at(-1, 18, 0)) }),
    R("Dentist appointment", at(1, 9, 30), { remind_before: 60 }),
    R("Book flights to Chennai", at(1, 20, 0), { priority: "high" }),
    R("Design review with the product team", at(2, 15, 0), { folder: "work" }),
    R("Mom's birthday dinner", at(3, 19, 30), { repeat: "yearly", priority: "high" }),
    R("Renew car insurance", at(5, 10, 0)),
    R("Water the plants", at(4, 8, 0), { repeat: "weekly" }),
    R("Prepare client presentation", at(6, 11, 0), { folder: "work" }),
    R("Quarterly planning", at(8, 10, 0), { folder: "work" }),
    R("Call the bank", at(11, 12, 0)),
    R("Car service", at(14, 9, 0)),
    R("Read 30 pages", null),
  ];
  // completed items through the week (for History and Insights)
  const history = [];
  const doneTitles = [["Mon", -3, ["Reply to client emails", "Grocery shopping", "Submit timesheet"]], ["Tue", -2, ["Fix login bug", "Call the plumber", "Pay rent", "Book team lunch", "Morning run"]],
    ["Wed", -1, ["Write blog post", "Update portfolio"]], ["Thu", 0, ["Morning run"]],
    ["prev", -8, ["Plan sprint", "Doctor visit"]], ["prev2", -9, ["Laundry"]], ["prev3", -7, ["Car wash"]]];
  for (const [, off, list] of doneTitles) list.forEach((t, i) => {
    const d = at(off, 9 + i * 2, 15);
    reminders.push(R(t, d, { done: true, completed_at: fmt(d) }));
    history.push({ at: fmtSec(d), type: "completed", text: `Completed “${t}”` });
  });
  for (let i = 0; i < 9; i++) history.push({ at: fmtSec(at(-3 + (i % 4), 8, 10 + i)), type: "created", text: "Added a reminder" });
  history.sort((a, b) => (a.at < b.at ? 1 : -1));
  const todos = ["Buy milk and eggs", "Renew passport", "Return library books", "Order a birthday gift", "Clean the garage"].map((t, i) =>
    ({ id: id++, text: t, done: i === 2, created_at: fmt(at(-2, 9)), completed_at: i === 2 ? fmt(at(-1, 10)) : null }));
  const card = (title, status, extra = {}) => ({ id: id++, title, status, priority: "normal", due: null, created_at: fmt(at(-4, 9)), completed_at: status === "done" ? fmt(at(-1, 16)) : null, ...extra });
  const board = [
    card("Launch landing page", "todo", { priority: "high" }), card("Write onboarding emails", "todo"), card("User interviews", "todo"),
    card("Mobile app redesign", "doing", { priority: "high" }), card("Pricing page copy", "doing"),
    card("Set up analytics", "done"), card("Brand guidelines", "done"),
  ];
  const notes = [
    { id: id++, title: "Weekend ideas", body: "• Farmers market on Saturday\n• Try the new South Indian place\n• Movie night: pick something light\n• Long walk at the beach", folder: "personal", pinned: true, created_at: fmt(at(-2, 20)), updated_at: fmt(at(-1, 21)) },
    { id: id++, title: "Product launch checklist", body: "1. Final QA pass\n2. Press kit\n3. Social posts scheduled\n4. Support FAQ updated", folder: "work", pinned: false, created_at: fmt(at(-3, 11)), updated_at: fmt(at(0, 9)) },
    { id: id++, title: "Book list", body: "Atomic Habits\nDeep Work\nThe Psychology of Money", folder: "personal", pinned: false, created_at: fmt(at(-6, 22)), updated_at: fmt(at(-5, 22)) },
  ];
  const habit = (name, color, keptDaysAgo, created = -40) => {
    const log = {};
    for (const d of keptDaysAgo) log[ymd(at(-d, 12))] = true;
    return { id: id++, name, days: [0, 1, 2, 3, 4, 5, 6], color, log, created: fmt(at(created, 8)) };
  };
  const range = (a, b, skip = []) => { const r = []; for (let i = a; i <= b; i++) if (!skip.includes(i)) r.push(i); return r; };
  const habits = [
    habit("Morning run", "#10b981", range(0, 22)),
    habit("Drink 8 glasses of water", "#3b82f6", range(1, 30, [9])),
    habit("Meditate 10 minutes", "#8b5cf6", range(1, 12, [5])),
    habit("Read before bed", "#f97316", range(1, 6, [3])),
  ];
  const focusLog = [[-3, 50, "Mobile app redesign"], [-2, 25, "Pricing page copy"], [-2, 50, "Mobile app redesign"], [-1, 25, "Write blog post"], [-1, 50, "Mobile app redesign"], [0, 25, "Pricing page copy"]]
    .map(([d, mins, title]) => ({ at: fmt(at(d, 15)), mins, title, kind: "card", id: 0 }));
  return {
    version: 2, nextId: id + 10,
    folders: [
      { id: "personal", name: "Personal", color: "#3b82f6", icon: "user", builtin: true },
      { id: "work", name: "Work", color: "#f97316", icon: "briefcase", builtin: true },
      { id: "private", name: "Private", color: "#8b5cf6", icon: "lock", builtin: true },
      { id: "f-home", name: "Home", color: "#10b981", icon: "home" },
      { id: "f-shop", name: "Shopping", color: "#ec4899", icon: "cart" },
    ],
    reminders, todos, board, notes, history, habits, places: [], focusLog, vault: null,
    settings: { theme: opts.theme || "light", voiceLang: "en-US", speak: false, announce: false, handsFree: false, seconds: true, lastView: opts.view || "today",
      accent: "indigo", sound: "chime", volume: 0, briefing: false, briefingTime: "08:00", lastBriefing: ymd(now), ai: false, aiKey: "",
      server: "", push: false, pushTitles: true, sync: false, geo: false, focusMin: 25, breakMin: 5 },
  };
};
