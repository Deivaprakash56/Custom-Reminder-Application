// Drives the real app in Chromium and records high-resolution frames plus a log of
// cursor, camera and caption cues. The editor (edit.py) turns that into the final film.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const seed = require("./seed.js");

const OUT = path.join(__dirname, "cap");
const NOW = new Date(2026, 10, 12, 10, 30, 0).getTime();
const URL = "http://localhost:8765/";
const VW = 1440, VH = 810, DSF = 2, CH = 40; // layout viewport (css px), render scale, window-chrome bar height (css px)
// Chromium's screencast ignores deviceScaleFactor, so we render a Zx larger viewport with CSS zoom
// and rewrite viewport units / breakpoints so the layout is identical to a VW x VH window.
async function hiRes(page, Z) {
  await page.route(/style\.css$/, async (route) => {
    const res = await route.fetch(); let css = await res.text();
    css = css.replace(/(\d+(?:\.\d+)?)(d?v[hw])\b/g, (m, n, u) => `calc(${n}${u} / ${Z})`);
    css = css.replace(/@media \(max-width: (\d+)px\)/g, (m, n) => `@media (max-width: ${n * Z}px)`);
    css += `\nhtml{zoom:${Z}}`;
    await route.fulfill({ response: res, body: css, headers: { ...res.headers(), "content-type": "text/css" } });
  });
  await page.addInitScript((Z) => {
    const o = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { const r = o.call(this); return new DOMRect(r.x / Z, r.y / Z, r.width / Z, r.height / Z); };
    const iw = Object.getOwnPropertyDescriptor(window, "innerWidth"), ih = Object.getOwnPropertyDescriptor(window, "innerHeight");
    Object.defineProperty(window, "innerWidth", { get: () => iw.get.call(window) / Z });
    Object.defineProperty(window, "innerHeight", { get: () => ih.get.call(window) / Z });
    window.__Z = Z;
  }, Z);
}
const only = process.argv[2]; // optional: record just one scene

const events = [];
const T = () => Date.now() / 1000;
const ev = (type, o = {}) => events.push({ t: T(), type, ...o });
const S = 2.5; // slow-motion factor: the page runs S times slower while recording; the editor speeds it back up
const sleepReal = (s) => new Promise((r) => setTimeout(r, s * 1000));
const sleep = (s) => sleepReal(s * S);
// Runs page time (JS clock + CSS/Web animations) at 1/S speed.
async function slowMotion(ctx, page) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Animation.enable");
  await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 / S });
  const fakeNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(fakeNow + 50);
  let on = true; let last = Date.now(); let carry = 0;
  const loop = (async () => {
    while (on) {
      await sleepReal(0.012);
      const n = Date.now(); carry += (n - last) / S; last = n;
      const step = Math.floor(carry);
      if (step >= 1) { carry -= step; await page.clock.runFor(step).catch(() => {}); }
    }
  })();
  return async () => { on = false; await loop; await cdp.send("Animation.setPlaybackRate", { playbackRate: 1 }).catch(() => {}); };
}

// camera presets in window coordinates (css px; window = chrome bar + viewport)
const OV = { x: 720, y: 272, w: 1800 };
const cam = (c, dur = 0.9) => ev("cam", { x: c.x, y: c.y, w: c.w, dur: dur * S });
const Zd = DSF;
const css = (b) => b && ({ x: b.x / Zd, y: b.y / Zd, width: b.width / Zd, height: b.height / Zd });
function fit(box, pad = 1.35, minW = 520) {
  let w = Math.max(box.width * pad, (box.height * pad * 16) / 9, minW);
  return { x: box.x + box.width / 2, y: box.y + CH + box.height / 2, w };
}
const cap = (title, sub) => ev("cap", { title, sub });
const capOff = () => ev("capoff");

async function startStream(ctx, page, name) {
  const dir = path.join(OUT, name); fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = []; let n = 0; const writes = [];
  cdp.on("Page.screencastFrame", (f) => {
    const file = `${String(n++).padStart(6, "0")}.jpg`;
    frames.push({ t: f.metadata.timestamp, file });
    writes.push(fs.promises.writeFile(path.join(dir, file), Buffer.from(f.data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const vp = page.viewportSize();
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
  return { async stop() { await cdp.send("Page.stopScreencast"); await Promise.all(writes); fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify(frames)); } };
}

// ---------------------------------------------------------------- cursor (real mouse + logged track)
function makeCursor(page, stream) {
  let pos = { x: VW + 60, y: VH + 60 };
  const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  async function glideTo(x, y, dur = 0.8, opts = {}) {
    const a = { ...pos }; const t0 = T(); dur *= S;
    // slight arc so moves feel hand-made
    const mx = (a.x + x) / 2 + (y - a.y) * 0.08, my = (a.y + y) / 2 - (x - a.x) * 0.08;
    for (;;) {
      const u = Math.min(1, (T() - t0) / dur); const e = ease(u);
      const px = (1 - e) * (1 - e) * a.x + 2 * (1 - e) * e * mx + e * e * x;
      const py = (1 - e) * (1 - e) * a.y + 2 * (1 - e) * e * my + e * e * y;
      await page.mouse.move(px * Zd, py * Zd, opts);
      ev("cur", { s: stream, x: px, y: py + CH });
      if (u >= 1) break;
      await sleepReal(1 / 120);
    }
    pos = { x, y };
  }
  async function to(target, dur = 0.8, dx = 0, dy = 0) {
    const box = css(typeof target === "string" ? await page.locator(target).first().boundingBox() : await target.boundingBox());
    if (!box) throw new Error(`no box for ${target}`);
    await glideTo(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, dur);
    return box;
  }
  async function click() { ev("click", { s: stream, x: pos.x, y: pos.y + CH }); await page.mouse.down(); await sleep(0.05); await page.mouse.up(); }
  async function drag(target, dur = 1.2) {
    await page.mouse.down(); ev("press", { s: stream });
    await sleep(0.15);
    const box = css(typeof target === "string" ? await page.locator(target).first().boundingBox() : await target.boundingBox());
    await glideTo(box.x + box.width / 2, box.y + box.height / 2, dur);
    await sleep(0.15);
    await page.mouse.up(); ev("release", { s: stream });
  }
  const hide = () => ev("curhide", { s: stream });
  const show = (x, y) => { pos = { x, y }; ev("cur", { s: stream, x, y: y + CH }); ev("curshow", { s: stream }); };
  return { glideTo, to, click, drag, hide, show, get pos() { return pos; } };
}

const DRAG_GHOST = () => {
  document.addEventListener("dragstart", (e) => {
    const el = e.target.closest && e.target.closest("[draggable]"); if (!el) return;
    const r = el.getBoundingClientRect(); const g = el.cloneNode(true);
    g.classList.remove("dragging");
    g.style.cssText += `;position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;pointer-events:none;z-index:9999;transform:rotate(2.5deg) scale(1.04);box-shadow:0 22px 48px rgba(15,23,42,.28);opacity:.97;transition:transform .15s`;
    const Z = window.__Z || 1; g.__dx = e.clientX / Z - r.left; g.__dy = e.clientY / Z - r.top; document.body.append(g); window.__ghost = g;
  }, true);
  document.addEventListener("dragover", (e) => { const g = window.__ghost; const Z = window.__Z || 1; if (g) { g.style.left = `${e.clientX / Z - g.__dx}px`; g.style.top = `${e.clientY / Z - g.__dy}px`; } }, true);
  const end = () => setTimeout(() => { if (window.__ghost) { window.__ghost.remove(); window.__ghost = null; } }, 0);
  document.addEventListener("dragend", end, true); document.addEventListener("drop", end, true);
};

async function desktop(browser) {
  if (only === "devices") return;
  const ctx = await browser.newContext({ viewport: { width: VW * DSF, height: VH * DSF }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await hiRes(page, DSF);
  await page.clock.install({ time: NOW });
  await page.addInitScript((db) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("reminders-pro.v2", JSON.stringify(db)); sessionStorage.setItem("seeded", "1"); } }, seed(NOW));
  await page.addInitScript(DRAG_GHOST);
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(URL); await page.waitForTimeout(800);
  // private folder with a couple of encrypted items, then lock it
  await page.evaluate(async () => {
    await createVault("sunflower-42");
    addReminder({ title: "Anniversary gift for Meera", due: fmt(new Date(Date.now() + 5 * 864e5)), folder: "private", priority: "high", notes: "", repeat: "none", remind_before: 0 });
    addReminder({ title: "Doctor: blood test results", due: fmt(new Date(Date.now() + 2 * 864e5)), folder: "private", notes: "", repeat: "none", remind_before: 0, priority: "normal" });
    addReminder({ title: "Renew health insurance", due: fmt(new Date(Date.now() + 9 * 864e5)), folder: "private", notes: "", repeat: "none", remind_before: 0, priority: "normal" });
    lockVault(true); db.history = db.history.filter((e) => !/private|Private/.test(e.text)); save(); setView("today");
  });
  await page.waitForTimeout(400);
  const stopSlow = await slowMotion(ctx, page);
  const stream = await startStream(ctx, page, "desktop");
  const c = makeCursor(page, "desktop");
  const clip = async (name, fn) => {
    if (only && only !== name) return;
    ev("clip", { s: "desktop", name }); await fn(); ev("clipend", { s: "desktop", name }); await sleep(0.2);
  };
  const view = async (v) => { await page.evaluate((v) => { closeMenus?.(); setView(v); window.scrollTo(0, 0); $("#view").scrollTop = 0; }, v); await sleep(0.35); };
  const box = async (sel) => css(await page.locator(sel).first().boundingBox());

  await sleep(0.5);
  // ------------------------------------------------------------ 1. Today
  await clip("today", async () => {
    cam(OV, 0); c.hide();
    await sleep(0.3); cap("Your whole day.", "Everything that matters, in one calm view.");
    await sleep(1.9); capOff();
    const clock = await box(".clock-card"); const tiles = await box("#nav");
    cam(fit({ x: clock.x, y: clock.y, width: clock.width, height: tiles.y - clock.y + 240 }, 1.25), 1.1);
    await sleep(1.5);
    const list = await box("#view");
    cam(fit({ x: list.x + 60, y: list.y, width: list.width - 120, height: 470 }, 1.08), 1.2);
    c.show(VW - 120, VH - 60);
    await sleep(0.3);
    await c.to(page.locator(".rem").filter({ hasText: "Send the Q4 budget" }).first(), 1.0);
    await sleep(0.9);
    cam(OV, 1.0); await sleep(1.0);
  });

  // ------------------------------------------------------------ 2. Assistant
  await clip("assistant", async () => {
    cam(OV, 0); cap("Just say it.", "Speak or type naturally. Nudge understands.");
    await c.to("#micBtn", 1.1); await sleep(0.25); await c.click();
    await sleep(0.6); capOff();
    const panel = await box(".as-panel");
    cam(fit(panel, 1.18), 1.0);
    await c.to("#asInput", 0.8); await c.click(); await sleep(0.2);
    await page.keyboard.type("Remind me to call mom tomorrow at 6 pm", { delay: 42 * S });
    await sleep(0.35); await page.keyboard.press("Enter");
    await sleep(0.5);
    const p2 = await box(".as-panel");
    cam(fit({ x: p2.x, y: p2.y + 40, width: p2.width, height: p2.height * 0.55 }, 1.12), 0.9);
    await sleep(2.0);
    await c.to(page.locator(".chip-btn", { hasText: "What's on today?" }), 0.8); await c.click();
    await sleep(0.5);
    cam(fit(p2, 1.15), 0.9);
    await sleep(2.2);
    await c.to("#asClose", 0.6); await c.click();
    cam(OV, 1.0); await sleep(1.1);
  });

  // ------------------------------------------------------------ 3. Alerts + smart snooze
  await clip("alert", async () => {
    cam(OV, 0); cap("Never miss a thing.", "Timely alerts with one-tap smart snooze.");
    await c.glideTo(900, 520, 0.8);
    await page.evaluate(() => {
      const n = new Date();
      db.reminders.push({ id: uid(), title: "Leave for the airport", notes: "", due: fmt(n), remind_before: 0, priority: "high", repeat: "none", folder: "personal",
        snoozed_until: null, reminded_at: null, done: false, completed_at: null, created_at: fmt(n) });
      save(); render(); checkReminders();
    });
    await sleep(1.2); capOff();
    const al = await box("#alerts");
    cam(fit({ x: al.x - 40, y: al.y, width: al.width + 40, height: 360 }, 1.15), 1.0);
    await sleep(0.4);
    await c.to(page.locator("#alerts button", { hasText: "Later" }).first(), 0.9); await c.click();
    await sleep(0.6);
    await c.to(page.locator(".menu button", { hasText: "After lunch" }).first(), 1.0);
    await sleep(0.3); await c.click();
    await sleep(0.8);
    cam(OV, 1.0); await sleep(1.6);
  });

  // ------------------------------------------------------------ 4. Calendar
  await view("calendar");
  await clip("calendar", async () => {
    cam(OV, 0); cap("Plan at a glance.", "Drag and drop to reschedule anything.");
    await sleep(1.6); capOff();
    const src = page.locator(".cal-chip", { hasText: "Dentist" }).first();
    const sb = css(await src.boundingBox());
    const grid = await box(".cal-grid");
    cam(fit({ x: grid.x, y: sb.y - 60, width: grid.width, height: 330 }, 1.08), 1.1);
    await c.to(src, 1.0, -10, 0); await sleep(0.2);
    const dst = page.locator(".cal-cell:not(.out)").filter({ has: page.locator(".cal-day", { hasText: /^17$/ }) }).first();
    await c.drag(dst, 1.3);
    await sleep(1.0);
    cam(OV, 1.0); await sleep(1.4);
  });

  // ------------------------------------------------------------ 5. Board
  await view("board");
  await clip("board", async () => {
    cam(OV, 0); cap("Move work forward.", "A simple board for everything in progress.");
    await sleep(1.5); capOff();
    const b = await box(".board");
    cam(fit({ x: b.x, y: b.y, width: b.width, height: 330 }, 1.1), 1.0);
    const card = page.locator(".bcard", { hasText: "Mobile app redesign" }).first();
    await c.to(card, 1.0); await sleep(0.2);
    await c.drag('.col[data-status="done"]', 1.2);
    await sleep(0.6);
    await c.to('.col[data-status="todo"] .col-add input', 0.9); await c.click();
    await page.keyboard.type("Ship version 2", { delay: 50 * S }); await sleep(0.2); await page.keyboard.press("Enter");
    await sleep(0.9);
    cam(OV, 1.0); await sleep(1.2);
  });

  // ------------------------------------------------------------ 6. Habits
  await view("habits");
  await clip("habits", async () => {
    cam(OV, 0); cap("Build habits that stick.", "Daily check-ins and streaks that keep you going.");
    await sleep(1.3); capOff();
    const g = await box(".habit-grid");
    cam(fit({ x: g.x, y: g.y, width: g.width, height: 200 }, 1.06), 1.0);
    const btns = page.locator("button", { hasText: "Check in for today" });
    await c.to(btns.nth(0), 0.9); await c.click(); await sleep(0.7);
    await c.to(page.locator("button", { hasText: "Check in for today" }).nth(0), 0.7); await c.click(); await sleep(1.1);
    cam(OV, 0.9); await sleep(1.0);
  });

  // ------------------------------------------------------------ 7. Focus
  await view("focus");
  await clip("focus", async () => {
    cam(OV, 0); cap("Stay in the zone.", "A focus timer linked to your tasks.");
    await sleep(1.2); capOff();
    const card = await box(".focus-card");
    cam(fit({ x: card.x, y: card.y, width: card.width, height: 300 }, 1.15), 1.0);
    const sel = page.locator("#view select").first();
    await c.to(sel, 0.8); await c.click(); await page.keyboard.press("Escape");
    const opt = await sel.evaluate((s) => { const o = [...s.options].find((o) => /Mobile app redesign/.test(o.textContent)); return o ? o.value : null; });
    if (opt) await sel.selectOption(opt);
    await sleep(0.3);
    await c.to(page.locator("button", { hasText: "Start focus" }).first(), 0.7); await c.click();
    await sleep(2.2);
    cam(OV, 0.9); await sleep(0.9);
  });
  await page.evaluate(() => { try { focusStop(); focusRender(); } catch (e) { console.log(e); } document.querySelector("#focusWidget").hidden = true; });

  // ------------------------------------------------------------ 8. Insights
  await view("insights");
  await clip("insights", async () => {
    await page.evaluate(() => renderView());
    cam(OV, 0); cap("See your progress.", "A weekly summary of what you got done.");
    await sleep(1.3); capOff();
    const row = await box(".stat-row");
    cam(fit({ x: row.x, y: row.y - 80, width: row.width, height: 200 }, 1.05), 1.0);
    await c.glideTo(row.x + row.width * 0.3, row.y + 40, 1.0);
    await sleep(0.6);
    const ch = await box(".chart-card");
    cam(fit(ch, 1.08), 1.0); await c.glideTo(ch.x + ch.width * 0.3, ch.y + ch.height * 0.45, 1.0);
    await sleep(0.6);
    cam(OV, 0.9); await sleep(0.9);
  });

  // ------------------------------------------------------------ 9. Private vault
  await view("today");
  await page.evaluate(() => { const r = [...document.querySelectorAll(".nav-row")].find((x) => /Private/.test(x.textContent)); r.scrollIntoView({ block: "center" }); });
  await sleep(0.3);
  await clip("vault", async () => {
    cam(OV, 0); cap("Private stays private.", "Password-locked and encrypted on your device.");
    const pv = page.locator(".nav-row", { hasText: "Private" }).first();
    await c.to(pv, 1.1); await sleep(0.2); await c.click();
    await sleep(0.5);
    const lk = await box(".empty.locked");
    cam(fit(lk, 1.6), 0.9);
    await c.to(".empty.locked .btn.primary", 0.8); await sleep(0.1); await c.click();
    await sleep(0.5); capOff();
    const d = await box("#vaultDialog");
    cam(fit(d, 1.5), 1.0);
    await c.to('#vaultDialog input[name="pw"]:visible, #vaultDialog input[name="current"]:visible', 0.7); await c.click();
    await page.keyboard.type("sunflower-42", { delay: 55 * S });
    await sleep(0.3);
    await c.to("#vaultOk", 0.6); await c.click();
    await sleep(0.8);
    const v = await box("#view");
    cam(fit({ x: v.x, y: v.y, width: v.width, height: 330 }, 1.0), 1.0);
    await sleep(1.6);
    cam(OV, 1.0); await sleep(1.0);
  });
  await stream.stop(); await stopSlow();
  await ctx.close();
}

async function mobile(browser) {
  if (only && only !== "devices") return;
  const MZ = 3;
  const ctx = await browser.newContext({ viewport: { width: 393 * MZ, height: 852 * MZ }, deviceScaleFactor: 1, hasTouch: true, isMobile: false, userAgent: devices["iPhone 14 Pro"].userAgent });
  const page = await ctx.newPage();
  await hiRes(page, MZ);
  await page.clock.install({ time: NOW });
  await page.addInitScript((db) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("reminders-pro.v2", JSON.stringify(db)); sessionStorage.setItem("seeded", "1"); } }, seed(NOW, { theme: "dark" }));
  await page.goto(URL); await page.waitForTimeout(900);
  const stopSlow = await slowMotion(ctx, page);
  const stream = await startStream(ctx, page, "mobile");
  ev("clip", { s: "mobile", name: "devices" });
  await sleep(1.6);
  const row = page.locator(".rem").filter({ hasText: "Pick up dry cleaning" }).first();
  const circle = row.locator(".ring").first();
  const b = await circle.boundingBox();
  ev("tap", { s: "mobile", x: (b.x + b.width / 2) / MZ, y: (b.y + b.height / 2) / MZ });
  await circle.tap();
  await sleep(1.4);
  // eased scroll driven by the (slowed) page clock
  const smooth = (frac, ms) => page.evaluate(([frac, ms]) => {
    const el = [document.scrollingElement, document.querySelector(".main"), document.querySelector("#view")].find((e) => e && e.scrollHeight > e.clientHeight + 5) || document.scrollingElement;
    const y0 = el.scrollTop, y1 = (el.scrollHeight - el.clientHeight) * frac, t0 = Date.now();
    const f = () => { const u = Math.min(1, (Date.now() - t0) / ms); const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; el.scrollTop = y0 + (y1 - y0) * e; if (u < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }, [frac, ms]);
  await smooth(0.6, 1000); await sleep(1.5);
  await smooth(0, 800); await sleep(1.0);
  const mb = await page.locator("#menuBtn").boundingBox();
  ev("tap", { s: "mobile", x: (mb.x + mb.width / 2) / MZ, y: (mb.y + mb.height / 2) / MZ });
  await page.tap("#menuBtn");
  await sleep(2.6);
  ev("clipend", { s: "mobile", name: "devices" });
  await stream.stop(); await stopSlow();
  await ctx.close();
}

(async () => {
  if (!only) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try { await desktop(browser); await mobile(browser); }
  finally {
    fs.writeFileSync(path.join(OUT, only ? `events-${only}.json` : "events.json"), JSON.stringify({ VW, VH, DSF, CH, events }, null, 0));
    await browser.close();
  }
  console.log("events", events.length);
})();
