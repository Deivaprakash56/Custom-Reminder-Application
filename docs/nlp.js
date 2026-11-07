"use strict";
// Natural-language command parser for Reminders (voice + typed commands).
// Pure functions, no DOM: runs in the browser (window.NLP) and in Node (module.exports) for tests.
//
//   NLP.parse("remind me to call mom tomorrow at 5 pm", new Date())
//   -> { intent: "reminder", title: "Call mom", due: "2026-11-08T17:00", hasTime: true, ... }

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NLP = api;
})(typeof self !== "undefined" ? self : this, function () {
  // ---------------------------------------------------------------- helpers
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  function addMonths(d, n) {
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
    r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
    return r;
  }

  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const WD = "(sunday|monday|tuesday|wednesday|thursday|friday|saturday)";
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MON = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\\.?";
  const QTY = "(\\d+(?:\\.\\d+)?|an?|one|half\\s+an?|a\\s+couple\\s+of|couple\\s+of|a\\s+few|few)";

  const SMALL = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
    eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
  const UNITS = "one|two|three|four|five|six|seven|eight|nine";

  // "twenty five" -> "25", "the third of may" -> "the 3rd of may" (keeps "one" in "someone" etc.)
  function wordsToNumbers(s) {
    const ord = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
    s = s.replace(new RegExp(`\\b(twenty|thirty)[\\s-](${Object.keys(ORD).slice(0, 9).join("|")})\\b`, "gi"),
      (m, t, o) => ord(TENS[t.toLowerCase()] + ORD[o.toLowerCase()]));
    s = s.replace(new RegExp(`\\b(the\\s+)(${Object.keys(ORD).join("|")})\\b|\\b(${Object.keys(ORD).join("|")})(\\s+of\\b)`, "gi"),
      (m, the, o1, o2, of) => (the || "") + ord(ORD[(o1 || o2).toLowerCase()]) + (of || ""));
    s = s.replace(new RegExp(`\\b(${Object.keys(TENS).join("|")})(?:[\\s-](${UNITS}))?\\b`, "gi"),
      (m, t, u) => String(TENS[t.toLowerCase()] + (u ? SMALL[u.toLowerCase()] : 0)));
    s = s.replace(new RegExp(`\\b(${Object.keys(SMALL).filter((w) => w !== "one").join("|")})\\b`, "gi"),
      (m) => String(SMALL[m.toLowerCase()]));
    // "one" only where it is clearly a number
    s = s.replace(/\b(at|by|around|in|past|to|after)\s+one\b/gi, "$1 1").replace(/\bone(?=\s*(?:am|pm|o'?clock|oclock|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b)/gi, "1");
    return s;
  }

  function qty(q) {
    q = q.toLowerCase().replace(/\s+/g, " ").trim();
    if (q.startsWith("half")) return 0.5;
    if (q.includes("couple")) return 2;
    if (q.includes("few")) return 3;
    if (q === "a" || q === "an" || q === "one") return 1;
    return parseFloat(q);
  }

  function normalize(text) {
    let s = ` ${String(text || "")} `;
    s = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    s = s.replace(/\b([ap])\.\s?m\.?/gi, (m, x) => `${x.toLowerCase()}m`);
    s = s.replace(/(\d)\s*([ap])\s?m\b/gi, (m, d, x) => `${d} ${x.toLowerCase()}m`);
    s = s.replace(/\bo['’ ]?clock\b/gi, "oclock");
    s = s.replace(/\bto[\s-]do(?:'?s)?\s+list\b/gi, "todo list").replace(/\bto-do\b/gi, "todo");
    s = s.replace(/\bnote\s*pad\b/gi, "notepad");
    s = wordsToNumbers(s);
    return s.replace(/\s+/g, " ");
  }

  // Remove courtesy words and wake phrases around the actual command.
  function stripCourtesy(s) {
    let prev;
    do {
      prev = s;
      s = s.replace(/^\s*(?:hey|hi|ok|okay|hello)\s+(?:siri|reminders?|assistant|app)\b[,.!]?\s*/i, " ")
        .replace(/^\s*(?:please|kindly|so|um+|uh+|hmm+|okay|ok|alright|hey)\b[,.]?\s+/i, " ")
        .replace(/^\s*(?:can|could|would|will)\s+you(?:\s+please)?\s+/i, " ")
        .replace(/^\s*(?:i\s+(?:need|want)\s+you\s+to|i'?d\s+like\s+you\s+to|i\s+want\s+to|i\s+need\s+to\s+be\s+reminded\s+to)\s+/i, " ")
        .replace(/[\s,.!?]*(?:please|thanks|thank\s+you|for\s+me)?[\s,.!?]*$/i, " ")
        .trim();
    } while (s !== prev);
    return s;
  }

  // Clean what is left after times/folders were cut out, so it reads as a title.
  function tidyTitle(s) {
    let prev;
    s = s.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1");
    const edge = "(?:at|on|by|in|for|to|the|and|around|about|from|after|before|this|next|of|that|it|with|starting|until|till|then|also|reminder|a)";
    do {
      prev = s;
      s = s.trim()
        .replace(/^[,.;:!?\-\s]+|[,.;:!?\-\s]+$/g, "")
        .replace(new RegExp(`\\s+${edge}$`, "i"), "")
        .replace(/^(?:to|that|about|of|for|on|me\s+to|me\s+that|me\s+about|me|and|then)\s+/i, "");
    } while (s !== prev);
    return s ? s[0].toUpperCase() + s.slice(1) : "";
  }

  // ---------------------------------------------------------------- folder / priority / repeat / when
  // folders: [{id, name}] - recognised as "#work", "in my work folder", "to the work list", "work reminder"
  function extractDetails(input, now, opts = {}) {
    let s = ` ${input} `;
    const out = { repeat: "none", priority: null, folder: null, remind_before: null, repeatDay: null };
    const take = (re, fn) => {
      const m = s.match(re);
      if (!m) return false;
      if (fn(...m) === false) return false;
      s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length);
      return true;
    };

    // ---- folder
    const folders = (opts.folders || []).filter((f) => f && f.name);
    const alias = { office: "work", job: "work", home: "personal", personal: "personal", secret: "private", private: "private" };
    const findFolder = (name) => {
      name = name.toLowerCase().trim();
      const byName = folders.find((f) => f.name.toLowerCase() === name);
      if (byName) return byName.id;
      const a = alias[name];
      return a && folders.find((f) => f.id === a) ? a : null;
    };
    const names = [...new Set([...folders.map((f) => f.name.toLowerCase()), ...Object.keys(alias)])]
      .sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (names.length) {
      const N = `(${names.join("|")})`;
      take(new RegExp(`#${N}\\b`, "i"), (m, n) => { out.folder = findFolder(n); return Boolean(out.folder); }) ||
      take(new RegExp(`\\b(?:in|into|to|under|on|for)\\s+(?:my\\s+|the\\s+)?${N}\\s+(?:folder|list|category|section|reminders)\\b`, "i"),
        (m, n) => { out.folder = findFolder(n); return Boolean(out.folder); }) ||
      take(new RegExp(`\\b(?:in|under)\\s+(?:my\\s+|the\\s+)?${N}\\s*$`, "i"), (m, n) => { out.folder = findFolder(n); return Boolean(out.folder); }) ||
      take(new RegExp(`^\\s*(?:a\\s+|an\\s+)?${N}\\s+(?:reminder|task)\\b`, "i"), (m, n) => { out.folder = findFolder(n); return Boolean(out.folder); });
    }

    // ---- priority
    take(/\b(?:it'?s\s+|this\s+is\s+|mark\s+(?:it\s+)?(?:as\s+)?|make\s+it\s+|with\s+)?(?:high|top|highest)\s+priority\b|\b(?:it'?s\s+)?(?:very\s+)?urgent(?:ly)?\b|\basap\b|\bas\s+soon\s+as\s+possible\b|\b(?:mark\s+(?:it\s+)?(?:as\s+)?)?critical\b|\bmark\s+(?:it\s+)?(?:as\s+)?important\b|!high\b|!!+/i,
      () => { out.priority = "high"; });
    if (!out.priority && /\b(?:very\s+)?important\b/i.test(s)) out.priority = "high"; // keep the word in the title
    take(/\b(?:with\s+|it'?s\s+)?low\s+priority\b|\bnot\s+urgent\b|\bno\s+rush\b|!low\b/i, () => { out.priority = "low"; });

    // ---- remind N before
    take(new RegExp(`\\b(?:and\\s+)?(?:remind|alert|notify|warn|ping)?\\s*(?:me\\s+)?${QTY}\\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\\s+(?:before(?:hand)?|early|earlier|in\\s+advance|ahead(?:\\s+of\\s+time)?|prior)\\b`, "i"),
      (m, q, u) => { const n = qty(q); out.remind_before = Math.round(/^h/i.test(u) ? n * 60 : /^d/i.test(u) ? n * 1440 : /^w/i.test(u) ? n * 10080 : n); });

    // ---- repeat
    let part = null;
    take(/\bevery\s+(morning|afternoon|evening|night)\b/i, (m, p) => { out.repeat = "daily"; part = p.toLowerCase(); });
    if (out.repeat === "none") {
      take(/\b(?:every\s*day|daily|each\s+day|every\s+single\s+day|once\s+a\s+day)\b/i, () => { out.repeat = "daily"; }) ||
      take(/\b(?:every\s+(?:week|work(?:ing)?\s*)days?|on\s+weekdays|weekdays|monday\s+(?:to|through|thru)\s+friday)\b/i, () => { out.repeat = "weekdays"; }) ||
      take(new RegExp(`\\b(?:every|each)\\s+${WD}\\b|\\bon\\s+${WD}s\\b|\\b${WD}s\\b`, "i"),
        (m, a, b, c) => { out.repeat = "weekly"; out.repeatDay = WEEKDAYS.indexOf((a || b || c).toLowerCase()); }) ||
      take(/\b(?:every\s+week|weekly|once\s+a\s+week|each\s+week)\b/i, () => { out.repeat = "weekly"; }) ||
      take(/\b(?:every\s+month|monthly|once\s+a\s+month|each\s+month)\b/i, () => { out.repeat = "monthly"; }) ||
      take(/\b(?:every\s+year|yearly|annually|once\s+a\s+year|each\s+year)\b/i, () => { out.repeat = "yearly"; });
    }

    // ---- when
    let date = null;     // Date (midnight) of the chosen day
    let exact = null;    // exact Date (relative "in 10 minutes")
    let time = null;     // { h, m, mer }
    let weekdayPicked = false;
    let explicitNext = false;
    const today = startOfDay(now);
    const setTime = (h, m, mer) => {
      h = Number(h); m = Number(m || 0);
      if (h > 23 || m > 59) return false;
      time = { h, m, mer: mer ? mer.toLowerCase() : null };
      return true;
    };
    const setDate = (y, mo, d) => {
      const month = typeof mo === "number" ? mo : MONTHS[String(mo).toLowerCase().slice(0, 3)];
      d = Number(d);
      let year = y ? Number(y) : now.getFullYear();
      if (year < 100) year += 2000;
      if (month == null || d < 1 || d > 31) return false;
      let r = new Date(year, month, d);
      if (r.getMonth() !== month) return false;
      if (!y && r < today) r = new Date(year + 1, month, d);
      date = r;
      return true;
    };

    // relative exact time
    take(new RegExp(`\\b(?:in|within|after)\\s+(?:about\\s+|around\\s+|another\\s+)?${QTY}\\s*(seconds?|secs?|minutes?|mins?|min|hours?|hrs?|hr)(\\s+and\\s+(?:a\\s+)?half)?(?:\\s+and\\s+(\\d+)\\s*(?:minutes?|mins?))?\\b`, "i"),
      (m, q, u, half, extra) => {
        let n = qty(q); if (half) n += 0.5;
        let mins = /^h/i.test(u) ? n * 60 : /^s/i.test(u) ? n / 60 : n;
        if (extra) mins += Number(extra);
        exact = new Date(now.getTime() + Math.round(mins * 60) * 1000);
      }) ||
    take(new RegExp(`\\b${QTY}\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\s+(?:from\\s+now|later)\\b`, "i"), (m, q, u) => {
      const n = qty(q);
      exact = new Date(now.getTime() + Math.round((/^h/i.test(u) ? n * 60 : /^s/i.test(u) ? n / 60 : n) * 60) * 1000);
    });

    if (!exact) {
      // relative days
      take(new RegExp(`\\b(?:in|after)\\s+${QTY}\\s*(days?|weeks?|months?|years?)\\b|\\b${QTY}\\s*(days?|weeks?|months?|years?)\\s+from\\s+(?:now|today)\\b`, "i"),
        (m, q1, u1, q2, u2) => {
          const n = Math.round(qty(q1 || q2)); const u = (u1 || u2).toLowerCase();
          date = u.startsWith("d") ? addDays(today, n) : u.startsWith("w") ? addDays(today, 7 * n)
            : u.startsWith("m") ? addMonths(today, n) : addMonths(today, 12 * n);
        }) ||
      take(/\b(?:the\s+)?day\s+after\s+tomorrow\b/i, () => { date = addDays(today, 2); }) ||
      take(/\b(?:tomorrow|tmrw|tmr|tomorow|tommorow|tommorrow)\b/i, () => { date = addDays(today, 1); }) ||
      take(/\btonight\b/i, () => { date = today; part = part || "night"; }) ||
      take(/\btoday\b/i, () => { date = today; }) ||
      take(/\bthis\s+(morning|afternoon|evening)\b/i, (m, p) => { date = today; part = p.toLowerCase(); }) ||
      take(/\b(?:(this|next|coming)\s+)?weekend\b/i, (m, w) => {
        let n = (6 - now.getDay() + 7) % 7; if (n === 0 && now.getHours() >= 18) n = 7;
        if (w && w.toLowerCase() === "next" && n < 7) n += 7;
        date = addDays(today, n);
      }) ||
      take(/\bnext\s+week\b/i, () => { const n = (1 - now.getDay() + 7) % 7 || 7; date = addDays(today, n); }) ||
      take(/\bnext\s+month\b/i, () => { date = addMonths(today, 1); }) ||
      take(/\bnext\s+year\b/i, () => { date = addMonths(today, 12); }) ||
      take(/\b(?:at\s+the\s+)?end\s+of\s+(?:the\s+)?(?:this\s+)?month\b/i, () => { date = new Date(now.getFullYear(), now.getMonth() + 1, 0); });

      // explicit calendar dates
      if (!date) {
        take(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON}(?:,?\\s+(\\d{4}))?\\b`, "i"), (m, d, mo, y) => setDate(y, mo, d)) ||
        take(new RegExp(`\\b(?:on\\s+)?${MON}\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i"), (m, mo, d, y) => setDate(y, mo, d)) ||
        take(/\b(?:on\s+)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/, (m, a, b, y) => {
          const [d, mo] = opts.dateOrder === "mdy" ? [b, a] : [a, b];
          return setDate(y, Number(mo) - 1, d);
        }) ||
        take(/\b(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b/, (m, y, mo, d) => setDate(y, Number(mo) - 1, d)) ||
        take(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (m, d) => {
          d = Number(d); if (d < 1 || d > 31) return false;
          let r = new Date(now.getFullYear(), now.getMonth(), d);
          if (r < today || r.getDate() !== d) r = new Date(now.getFullYear(), now.getMonth() + 1, d);
          date = r; return true;
        });
      }
      // weekday ("on friday", "next monday", "this sunday")
      if (!date) {
        take(new RegExp(`\\b(?:(on|this|next|coming|upcoming)\\s+)?${WD}\\b`, "i"), (m, q, wd) => {
          let n = (WEEKDAYS.indexOf(wd.toLowerCase()) - now.getDay() + 7) % 7;
          if (q && q.toLowerCase() === "next" && n === 0) n = 7;
          explicitNext = Boolean(q && q.toLowerCase() === "next");
          date = addDays(today, n); weekdayPicked = true;
        });
      }
      if (!date && out.repeatDay != null) {
        date = addDays(today, (out.repeatDay - now.getDay() + 7) % 7); weekdayPicked = true;
      }

      // clock time
      take(/(?:\b(?:at|by|around|about|before|until|from)\s+|@\s*)?\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i, (m, h, mi, mer) => setTime(h, mi, mer)) ||
      take(/\b(?:at|by|around|about)?\s*(\d{1,2})\s+(\d{2})\s*(am|pm)\b/i, (m, h, mi, mer) => setTime(h, mi, mer)) ||
      take(/\b(?:at|by|around|about)\s+(\d{1,2})\s+(\d{2})\b(?!\s*(?:minutes?|mins?|hours?|days?))/i, (m, h, mi) => setTime(h, mi, null)) ||
      take(/(?:\b(?:at|by|around|about|before|until)\s+|@\s*)?\b(\d{1,2})\s*(am|pm)\b/i, (m, h, mer) => Number(h) <= 12 && setTime(h, 0, mer)) ||
      take(/(?:\b(?:at|by|around|about)\s+)?\b(\d{1,2})\s*oclock\b/i, (m, h) => setTime(h, 0, null)) ||
      take(/\b(?:at\s+)?half\s+past\s+(\d{1,2})\b/i, (m, h) => setTime(h, 30, null)) ||
      take(/\b(?:at\s+)?(?:a\s+)?quarter\s+past\s+(\d{1,2})\b/i, (m, h) => setTime(h, 15, null)) ||
      take(/\b(?:at\s+)?(?:a\s+)?quarter\s+(?:to|of)\s+(\d{1,2})\b/i, (m, h) => setTime((Number(h) + 11) % 12 || 12, 45, null)) ||
      take(/\b(?:at|by|around)\s+(?:about\s+)?(\d{1,2})\b(?!\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|st|nd|rd|th|%|[/-]))/i, (m, h) => setTime(h, 0, null)) ||
      take(/\b(?:at\s+|by\s+)?(?:noon|midday|12\s+noon)\b/i, () => setTime(12, 0, "pm")) ||
      take(/\b(?:at\s+|by\s+)?midnight\b/i, () => setTime(0, 0, "am"));
      if (time && time.h === 0 && time.mer === "am" && !date) date = addDays(today, 1);

      // part of day
      take(/\b(?:at|for|around|by)\s+(lunch|lunchtime|lunch\s+time|dinner|dinnertime|dinner\s+time|breakfast|bedtime|bed\s+time)\b|\b(?:before|at)\s+(bed)\b|\bafter\s+(work|lunch|dinner)\b|\b(?:by\s+|at\s+)?(?:the\s+)?(end\s+of\s+(?:the\s+)?day|eod)\b/i,
        (m, a, b, c, d) => {
          const k = (a || b || c || d).toLowerCase().replace(/\s+/g, "");
          const map = { lunch: [13, 0], lunchtime: [13, 0], dinner: [19, 30], dinnertime: [19, 30], breakfast: [8, 0], bedtime: [22, 0], bed: [22, 0],
            work: [18, 0], endofday: [17, 0], endoftheday: [17, 0], eod: [17, 0] };
          if (c && c.toLowerCase() === "lunch") return time ? false : setTime(14, 0, null);
          if (c && c.toLowerCase() === "dinner") return time ? false : setTime(21, 0, null);
          const v = map[k]; if (!v || time) return false;
          return setTime(v[0], v[1], null);
        });
      take(/\b(?:in\s+the\s+|this\s+|at\s+|early\s+(?:in\s+the\s+)?|late\s+(?:in\s+the\s+)?)?(morning|afternoon|evening|night)\b/i, (m, p) => {
        if (/^this/i.test(m) && !date) date = today;
        part = p.toLowerCase();
      });
    }

    // ---- resolve to a datetime
    let due = null; let hasTime = false;
    if (exact) {
      due = exact; hasTime = true;
    } else if (time || part || date) {
      const base = date || today;
      let h; let m = 0;
      if (time) {
        hasTime = true;
        h = time.h; m = time.m;
        const mer = time.mer || (part === "morning" ? "am" : part ? "pm" : null);
        if (mer === "pm" && h < 12) h += 12;
        if (mer === "am" && h === 12) h = 0;
        if (!mer && h >= 1 && h <= 12) {
          if (date && !sameDay(date, now)) {
            if (h <= 6) h += 12;            // "tomorrow at 5" -> 5 PM
          } else {
            // today: the next upcoming of h AM / h PM
            const am = h === 12 ? 12 : h; const pm = h === 12 ? 24 : h + 12;
            const at = (hh) => new Date(base.getFullYear(), base.getMonth(), base.getDate(), hh, m);
            if (at(am) > now) h = am;
            else if (pm < 24 && at(pm) > now) h = pm;
            else if (!date) { h = h <= 6 ? pm % 24 : am; date = addDays(today, 1); }
            else h = pm % 24;
          }
        }
      } else if (part) {
        hasTime = true;
        h = { morning: 9, afternoon: 14, evening: 18, night: 20 }[part];
      } else {
        h = 9;
      }
      const b = date || today;
      due = new Date(b.getFullYear(), b.getMonth(), b.getDate(), h, m);
      if (!date && due <= now) due = addDays(due, 1);
      if (weekdayPicked && !explicitNext && due <= now) due = addDays(due, 7);
      if (!time && part && date && sameDay(due, now) && due <= now) {
        due = new Date(now.getTime() + 3600000); due.setMinutes(0, 0, 0); // "tonight" said late: next full hour
      }
      if (!hasTime && sameDay(due, now) && due <= now) {
        due = new Date(now.getTime() + 3600000); due.setMinutes(0, 0, 0); // "today": next full hour
      }
    } else if (out.repeat !== "none") {
      due = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0);
      if (due <= now) due = addDays(due, 1);
    }
    if (out.repeat === "weekdays" && due && (due.getDay() === 0 || due.getDay() === 6)) due = addDays(due, due.getDay() === 6 ? 2 : 1);
    if (out.repeat === "weekly" && out.repeatDay != null && due && due.getDay() !== out.repeatDay) {
      due = addDays(due, (out.repeatDay - due.getDay() + 7) % 7);
    }
    return { rest: s, due: due ? fmt(due) : null, hasTime, hasDate: Boolean(due), ...out };
  }

  // ---------------------------------------------------------------- intents
  const NAV = [
    [/^(?:my\s+)?(?:notes?|notepad|note\s+book|notebook)$/, "notes"],
    [/^(?:my\s+)?(?:todos?|todo\s+list|todo's|checklist|check\s+list|tasks?\s+list)$/, "todo"],
    [/^(?:my\s+)?(?:things\s+to\s+do|board|task\s+board|kanban|projects?)$/, "board"],
    [/^(?:my\s+)?(?:history|completed|done|activity|log)$/, "history"],
    [/^(?:my\s+)?(?:overdue|late|missed)(?:\s+reminders|\s+tasks)?$/, "overdue"],
    [/^(?:my\s+)?(?:today|today's(?:\s+reminders)?|today\s+reminders)$/, "today"],
    [/^(?:my\s+)?(?:scheduled|upcoming|calendar|schedule|agenda)$/, "scheduled"],
    [/^(?:my\s+)?(?:all\s+)?(?:reminders|all)$/, "all"],
    [/^(?:my\s+)?(?:flagged|important|priority|high\s+priority)$/, "flagged"],
    [/^(?:the\s+)?settings|preferences$/, "settings"],
  ];

  function rangeOf(s) {
    if (/\boverdue|late|missed\b/.test(s)) return "overdue";
    if (/\btomorrow\b/.test(s)) return "tomorrow";
    if (/\b(?:this|the)\s+week\b|\bweek\b/.test(s)) return "week";
    if (/\btoday|tonight|now\b/.test(s)) return "today";
    if (/\bupcoming|next|coming|scheduled\b/.test(s)) return "upcoming";
    return "today";
  }

  function parse(text, now = new Date(), opts = {}) {
    const raw = String(text || "");
    let s = stripCourtesy(normalize(raw));
    const low = s.toLowerCase();
    const base = { raw, intent: "unknown" };
    if (!low) return { ...base, intent: "empty" };

    // ---- small talk & questions
    if (/^(?:what(?:'s|\s+is)\s+the\s+time|what\s+time\s+is\s+it|(?:tell\s+me\s+)?the\s+time|time(?:\s+now)?|current\s+time)(?:\s+now|\s+right\s+now)?\??$/.test(low)) return { ...base, intent: "time" };
    if (/^(?:what(?:'s|\s+is)\s+(?:the\s+|today'?s\s+)?(?:date|day)(?:\s+today)?|what\s+day\s+is\s+(?:it|today)|today'?s\s+date)\??$/.test(low)) return { ...base, intent: "date" };
    if (/^(?:help|what\s+can\s+you\s+do|how\s+(?:does\s+this|do\s+i\s+use\s+(?:this|you))\s*(?:work)?)\??$/.test(low)) return { ...base, intent: "help" };
    if (/^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))(?:\s+there)?\W*$/.test(low)) return { ...base, intent: "greet" };
    if (/^(?:thanks?|thank\s+you|cheers|great|perfect|awesome|cool)\W*$/.test(low)) return { ...base, intent: "thanks" };
    if (/^(?:undo|undo\s+that|cancel\s+that|never\s*mind|nevermind|forget\s+(?:it|that)|delete\s+(?:that|the\s+last\s+one)|scratch\s+that)\W*$/.test(low)) return { ...base, intent: "undo" };
    if (/^(?:stop|cancel|exit|close|quit|bye|goodbye|that'?s\s+all)\W*$/.test(low)) return { ...base, intent: "stop" };
    if (/^(?:lock|lock\s+(?:my\s+)?(?:the\s+)?private(?:\s+folder)?|lock\s+(?:the\s+)?vault)\W*$/.test(low)) return { ...base, intent: "lock" };
    if (/^(?:clear|delete|remove)\s+(?:all\s+)?(?:the\s+)?completed(?:\s+(?:todos?|tasks?|items?|reminders?))?\W*$/.test(low)) return { ...base, intent: "clearCompleted" };

    // ---- queries about the schedule
    if (/^(?:what(?:'s|\s+is|\s+are|\s+do\s+i\s+have)?|show(?:\s+me)?|list|read(?:\s+out)?|tell\s+me|any|do\s+i\s+have|how\s+many|check|give\s+me)\b.*\b(?:reminders?|schedule|agenda|tasks?|plans?|planned|due|overdue|anything|events?|on\s+(?:for|today|tomorrow))\b/.test(low) &&
        !/^(?:remind|set|add|create)\b/.test(low)) {
      return { ...base, intent: "query", range: rangeOf(low) };
    }

    // ---- snooze
    let m = low.match(/^snooze(?:\s+(?:it|that|this|the\s+(?:last\s+)?(?:reminder|alarm|alert)))?(?:\s+for)?(?:\s+(?:another\s+)?(\d+(?:\.\d+)?|an?|half\s+an?)\s*(minutes?|mins?|hours?|hrs?))?\W*$/);
    if (m) {
      const n = m[1] ? qty(m[1]) : 10;
      return { ...base, intent: "snooze", minutes: Math.round(m[2] && /^h/.test(m[2]) ? n * 60 : n) };
    }

    // ---- navigation
    m = low.match(/^(?:open|show|go\s+to|switch\s+to|view|take\s+me\s+to|display|launch|bring\s+up)\s+(?:me\s+)?(?:my\s+|the\s+)?(.+?)(?:\s+(?:folder|list|page|section|view|tab|screen))?\W*$/);
    if (m) {
      const target = m[1].trim();
      for (const [re, id] of NAV) if (re.test(target)) return { ...base, intent: "navigate", target: id };
      const f = (opts.folders || []).find((x) => x.name.toLowerCase() === target || x.id === target ||
        (target === "office" && x.id === "work") || (target === "home" && x.id === "personal"));
      if (f) return { ...base, intent: "navigate", target: `folder:${f.id}` };
    }

    // ---- complete / delete existing items
    m = s.match(/^(?:mark|tick(?:\s+off)?|check\s+off|cross\s+off|complete|finish|close)\s+(?:the\s+)?(?:reminder|task|todo|item)?\s*(?:to\s+|about\s+|called\s+)?(.+?)(?:\s+(?:as\s+)?(?:done|complete(?:d)?|finished))?\W*$/i) ||
        s.match(/^i\s+(?:have\s+|'ve\s+|just\s+)?(?:finished|completed|done|did)\s+(?:the\s+)?(?:reminder\s+|task\s+)?(?:to\s+)?(.+?)\W*$/i);
    if (m && !/^(?:remind|set)/i.test(s)) return { ...base, intent: "complete", query: tidyTitle(m[1]) };
    m = s.match(/^(?:delete|remove|cancel|clear|drop|erase)\s+(?:the\s+|my\s+)?(?:reminder|task|todo|item|note|alarm)?\s*(?:to\s+|about\s+|for\s+|called\s+|named\s+)?(.+?)\W*$/i);
    if (m && m[1].trim()) {
      const kind = /\bnote\b/i.test(s.split(/\s+/).slice(0, 3).join(" ")) ? "note" : null;
      return { ...base, intent: "delete", query: tidyTitle(m[1]), kind };
    }

    // ---- notes
    m = s.match(/^(?:(?:take|make|create|add|write|start|new)\s+(?:a\s+|me\s+a\s+|the\s+|new\s+|quick\s+)*note(?:\s+to\s+self)?|note\s+to\s+self|note|write\s+down|jot\s+(?:down|this)|save\s+(?:a\s+)?note)(?:\s*(?:that|saying|says|to\s+say|which\s+says|about|:|,|-))?\s*(.*)$/i);
    if (m) {
      const d = extractDetails(m[1] || "", now, opts);
      const body = (m[1] || "").trim();
      const title = tidyTitle(d.rest).split(/\s+/).slice(0, 8).join(" ");
      return { ...base, intent: "note", title: title || "New note", body: body ? body[0].toUpperCase() + body.slice(1) : "", folder: d.folder };
    }

    // ---- todo list / things to do board
    const listTarget = "(?:my\\s+|the\\s+)?(?:shopping\\s+|grocery\\s+|groceries\\s+)?";
    m = s.match(new RegExp(`^(?:add|put|include|insert|place|write)\\s+(.+?)\\s+(?:to|on|in|into)\\s+${listTarget}(todo|todo\\s+list|todos|checklist|list|things\\s+to\\s+do(?:\\s+list)?|board|task\\s+board|kanban|in\\s+progress|doing)\\W*$`, "i")) ||
        s.match(/^(?:add\s+(?:a\s+)?(?:new\s+)?)?(todo|todo\s+item|thing\s+to\s+do|things\s+to\s+do)\s*[:,-]?\s+(.+)$/i);
    if (m) {
      let item; let where;
      if (/^(?:todo|thing)/i.test(m[1]) && m[2] && !/^(?:todo|todos|checklist|list|board)$/i.test(m[2])) { where = m[1]; item = m[2]; } else { item = m[1]; where = m[2]; }
      where = where.toLowerCase();
      const board = /things|board|kanban|progress|doing/.test(where);
      const d = extractDetails(item, now, opts);
      return { ...base, intent: board ? "board" : "todo", title: tidyTitle(board ? d.rest : item) || tidyTitle(item),
        status: /progress|doing/.test(where) ? "doing" : "todo", priority: d.priority, due: board ? d.due : null };
    }
    m = s.match(/^(?:i\s+(?:need|have|got)\s+to\s+buy|buy|get|pick\s+up)\s+(.+?)\s+(?:from|at)\s+(?:the\s+)?(?:store|shop|market|supermarket)\W*$/i);
    if (m) return { ...base, intent: "todo", title: tidyTitle(`Buy ${m[1]}`) };

    // ---- reminders (default)
    let explicit = false;
    let folderHint = null;
    m = s.match(/^\s*(?:set|create|add|make|new)\s+(?:a\s+|an\s+|me\s+a\s+)?([\w-]+)\s+(reminder|alarm)\b/i);
    if (m) {
      const f = (opts.folders || []).find((x) => x.name.toLowerCase() === m[1].toLowerCase() || x.id === m[1].toLowerCase() ||
        (m[1].toLowerCase() === "office" && x.id === "work") || (m[1].toLowerCase() === "home" && x.id === "personal"));
      if (f) { folderHint = f.id; s = s.replace(m[0], ` set a ${m[2]}`); }
    }
    const prefixes = [
      /^(?:please\s+)?remind\s+me\s+(?:to|about|that|of|for)\s+/i,
      /^(?:please\s+)?remind\s+me\b\s*/i,
      /^(?:set|create|add|make|schedule|put|new)\s+(?:up\s+)?(?:a\s+|an\s+|me\s+a\s+|the\s+|new\s+)*(?:reminder|alarm|alert|notification)s?\s*(?:for\s+me\s+)?(?:to|for|about|that|of|saying|called|:)?\s*/i,
      /^(?:reminder|alarm|alert)\s*(?:to|for|about|:|-)?\s*/i,
      /^(?:remember|don'?t\s+(?:let\s+me\s+)?forget|do\s+not\s+(?:let\s+me\s+)?forget)\s+(?:to\s+|about\s+|that\s+)?/i,
      /^(?:i\s+(?:need|have|must|should|gotta|got)\s+to)\s+/i,
    ];
    for (const re of prefixes) {
      if (re.test(s)) { s = s.replace(re, " "); explicit = true; break; }
    }
    if (/^\s*wake\s+me\s+(?:up\s+)?/i.test(s)) { s = s.replace(/^\s*wake\s+me\s+(?:up\s+)?/i, " Wake up "); explicit = true; }
    const d = extractDetails(s, now, opts);
    let rest = d.rest.replace(/\s+/g, " ").trim();
    if (!explicit) {
      // "in 10 minutes remind me to leave": the command words came after the time
      for (const re of prefixes) {
        if (re.test(rest)) { rest = rest.replace(re, " "); explicit = true; break; }
      }
    }
    let title = tidyTitle(rest);
    if (/^wake\s+up$/i.test(title)) title = "Wake up";
    return {
      ...base, intent: "reminder", explicit, title, due: d.due, hasTime: d.hasTime, hasDate: d.hasDate,
      remind_before: d.remind_before, priority: d.priority, repeat: d.repeat, folder: d.folder || folderHint,
    };
  }

  // Parse just a time phrase ("tomorrow at 6", "in 20 minutes") - used for follow-up questions.
  function parseWhen(text, now = new Date(), opts = {}) {
    const s = normalize(text);
    if (/^\s*(?:no|none|nope|no\s+time|without\s+(?:a\s+)?(?:time|date)|never|skip|anytime|any\s+time|doesn'?t\s+matter)\b/i.test(s)) return { none: true };
    const d = extractDetails(s, now, opts);
    return { due: d.due, hasTime: d.hasTime, repeat: d.repeat };
  }

  // ---------------------------------------------------------------- speech helpers
  function whenPhrase(due, now = new Date()) {
    if (!due) return "";
    const d = typeof due === "string" ? new Date(due.length === 16 ? `${due}:00` : due) : due;
    const mins = Math.round((d - now) / 60000);
    const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (mins >= 0 && mins < 60 && sameDay(d, now)) return mins <= 1 ? "in a minute" : `in ${mins} minutes`;
    const days = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
    if (days === 0) return `today at ${t}`;
    if (days === 1) return `tomorrow at ${t}`;
    if (days > 1 && days < 7) return `on ${WEEKDAYS[d.getDay()][0].toUpperCase()}${WEEKDAYS[d.getDay()].slice(1)} at ${t}`;
    return `on ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} at ${t}`;
  }

  // "call my mom" -> "call your mom" (for spoken confirmations)
  function toSecondPerson(s) {
    const map = { my: "your", me: "you", i: "you", "i'm": "you're", "i've": "you've", "i'll": "you'll", mine: "yours", myself: "yourself", am: "are", our: "your", we: "you", us: "you" };
    return String(s).replace(/\b(i'm|i've|i'll|my|me|i|mine|myself|our|we|us)\b/gi, (w) => map[w.toLowerCase()] || w);
  }

  return { parse, parseWhen, whenPhrase, toSecondPerson, normalize, fmt };
});
