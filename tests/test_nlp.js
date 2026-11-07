// Run: node --test tests/test_nlp.js   (Node 18+)
// Natural-language parser tests. "Now" is fixed at Saturday 7 Nov 2026, 9:00 PM local time.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const NLP = require("../docs/nlp.js");

const NOW = new Date(2026, 10, 7, 21, 0, 0);
const FOLDERS = [{ id: "personal", name: "Personal" }, { id: "work", name: "Work" }, { id: "private", name: "Private" }, { id: "f9", name: "Gym" }];
const p = (s, now = NOW) => NLP.parse(s, now, { folders: FOLDERS });

const R = (text, title, due, extra = {}) => test(`reminder: ${text}`, () => {
  const r = p(text);
  assert.equal(r.intent, "reminder", JSON.stringify(r));
  assert.equal(r.title, title, JSON.stringify(r));
  assert.equal(r.due, due, JSON.stringify(r));
  for (const [k, v] of Object.entries(extra)) assert.deepEqual(r[k], v, `${k}: ${JSON.stringify(r)}`);
});

// --- reminders with dates and times
R("Remind me to call mom tomorrow at 5 pm", "Call mom", "2026-11-08T17:00");
R("remind me to call mom tomorrow at 5 p.m.", "Call mom", "2026-11-08T17:00");
R("remind me to call mom tomorrow at 5", "Call mom", "2026-11-08T17:00");
R("Hey Siri remind me to take my pills in 10 minutes", "Take my pills", "2026-11-07T21:10");
R("remind me in half an hour to check the oven", "Check the oven", "2026-11-07T21:30");
R("remind me to stretch in an hour and a half", "Stretch", "2026-11-07T22:30");
R("in twenty five minutes remind me to leave", "Leave", "2026-11-07T21:25");
R("set a reminder to pay rent on the 1st", "Pay rent", "2026-12-01T09:00", { hasTime: false });
R("set a reminder for the dentist on December 12th at 3:30 pm", "The dentist", "2026-12-12T15:30");
R("remind me about the meeting on 15 jan at 10am", "The meeting", "2027-01-15T10:00");
R("submit report by friday 6pm", "Submit report", "2026-11-13T18:00");
R("remind me to water the plants every day at 8 am", "Water the plants", "2026-11-08T08:00", { repeat: "daily" });
R("remind me to go to the gym every monday at 7", "Go to the gym", "2026-11-09T07:00", { repeat: "weekly" });
R("remind me to take out the trash every weekday at 7:30 am", "Take out the trash", "2026-11-09T07:30", { repeat: "weekdays" });
R("remind me to call dad tonight", "Call dad", "2026-11-07T22:00");
R("remind me to call dad at 11", "Call dad", "2026-11-07T23:00");
R("remind me to call dad at 9:30", "Call dad", "2026-11-07T21:30");
R("remind me to call dad at 8", "Call dad", "2026-11-08T08:00");
R("remind me to buy milk tomorrow morning", "Buy milk", "2026-11-08T09:00");
R("remind me to read tomorrow evening", "Read", "2026-11-08T18:00");
R("remind me at noon tomorrow to eat", "Eat", "2026-11-08T12:00");
R("wake me up at 6 am", "Wake up", "2026-11-08T06:00");
R("remind me to submit the work report next monday at 9 am #work", "Submit the work report", "2026-11-09T09:00", { folder: "work" });
R("remind me to pay bills in my private folder tomorrow at 10", "Pay bills", "2026-11-08T10:00", { folder: "private" });
R("set a work reminder to email John at 4 pm tomorrow", "Email John", "2026-11-08T16:00", { folder: "work" });
R("remind me to renew my passport urgently on 20/11", "Renew my passport", "2026-11-20T09:00", { priority: "high" });
R("remind me to call the bank at half past ten tomorrow", "Call the bank", "2026-11-08T10:30");
R("remind me to call the bank at quarter to five tomorrow", "Call the bank", "2026-11-08T16:45");
R("remind me to start the laundry in two hours", "Start the laundry", "2026-11-07T23:00");
R("remind me in 3 days to follow up with Priya", "Follow up with Priya", "2026-11-10T09:00");
R("remind me to pack bags day after tomorrow at 7 pm", "Pack bags", "2026-11-09T19:00");
R("remind me to meet Ravi at 6 o'clock tomorrow and remind me 30 minutes before", "Meet Ravi", "2026-11-08T18:00", { remind_before: 30 });
R("don't let me forget to feed the cat at 7 am", "Feed the cat", "2026-11-08T07:00");
R("remind me about mom's birthday on 3rd of march every year", "Mom's birthday", "2027-03-03T09:00", { repeat: "yearly" });
R("remind me to go to the gym this weekend", "Go to the gym", "2026-11-14T09:00");
R("remind me to call the plumber next week", "Call the plumber", "2026-11-09T09:00");
R("remind me to call Sam on Sunday at five thirty pm", "Call Sam", "2026-11-08T17:30");
R("Buy groceries", "Buy groceries", null);
R("dinner with Anu at 8:15 pm on friday", "Dinner with Anu", "2026-11-13T20:15");
R("remind me to lock the door at midnight", "Lock the door", "2026-11-08T00:00");
R("remind me to call the office at the end of the day", "Call the office", "2026-11-08T17:00");
R("remind me to leave for work at 8 tomorrow", "Leave for work", "2026-11-08T08:00");
R("remind me to log my workout #gym tomorrow at 6 am", "Log my workout", "2026-11-08T06:00", { folder: "f9" });

test("morning time today picks the right half of the day", () => {
  const am = new Date(2026, 10, 7, 7, 0);
  assert.equal(p("remind me to call at 9", am).due, "2026-11-07T09:00");
  assert.equal(p("remind me to call at 3", am).due, "2026-11-07T15:00");
});

// --- other intents
test("todo", () => {
  const r = p("add eggs to my shopping list");
  assert.equal(r.intent, "todo"); assert.equal(r.title, "Eggs");
  assert.equal(p("add call the electrician to my to-do list").title, "Call the electrician");
  assert.equal(p("todo: clean the garage").title, "Clean the garage");
});
test("board", () => {
  const r = p("add redesign the website to things to do");
  assert.equal(r.intent, "board"); assert.equal(r.title, "Redesign the website"); assert.equal(r.status, "todo");
  assert.equal(p("put write tests on the board").intent, "board");
});
test("note", () => {
  const r = p("take a note that the wifi password is sunflower 42");
  assert.equal(r.intent, "note"); assert.match(r.body, /^The wifi password is sunflower 42$/);
  assert.equal(p("note to self buy a new charger").intent, "note");
  assert.equal(p("write down parking spot level 3 b12").intent, "note");
});
test("queries", () => {
  assert.deepEqual([p("what are my reminders today").intent, p("what are my reminders today").range], ["query", "today"]);
  assert.equal(p("what's on my schedule tomorrow").range, "tomorrow");
  assert.equal(p("do I have anything overdue").range, "overdue");
  assert.equal(p("what time is it").intent, "time");
  assert.equal(p("what's the date today").intent, "date");
});
test("commands", () => {
  assert.deepEqual(p("snooze for 15 minutes"), { raw: "snooze for 15 minutes", intent: "snooze", minutes: 15 });
  assert.equal(p("snooze").minutes, 10);
  assert.equal(p("open notepad").target, "notes");
  assert.equal(p("show my work folder").target, "folder:work");
  assert.equal(p("go to things to do").target, "board");
  assert.equal(p("open history").target, "history");
  assert.deepEqual([p("mark call mom as done").intent, p("mark call mom as done").query], ["complete", "Call mom"]);
  assert.deepEqual([p("delete the reminder about the dentist").intent, p("delete the reminder about the dentist").query], ["delete", "The dentist"]);
  assert.equal(p("undo").intent, "undo");
  assert.equal(p("never mind").intent, "undo");
  assert.equal(p("lock private folder").intent, "lock");
});
test("follow-up time answers", () => {
  assert.equal(NLP.parseWhen("tomorrow at 6", NOW).due, "2026-11-08T18:00");
  assert.equal(NLP.parseWhen("in 20 minutes", NOW).due, "2026-11-07T21:20");
  assert.equal(NLP.parseWhen("no time", NOW).none, true);
});
test("spoken phrasing", () => {
  assert.equal(NLP.whenPhrase("2026-11-08T17:00", NOW), "tomorrow at 5:00 PM");
  assert.equal(NLP.whenPhrase("2026-11-07T21:10", NOW), "in 10 minutes");
  assert.equal(NLP.toSecondPerson("call my mom and tell me"), "call your mom and tell you");
});

// --- v3 additions: nagging, location, conversation memory, focus, habits, briefing, Tamil
const P3 = (s) => NLP.parse(s, NOW, { folders: FOLDERS, places: [{ id: "p1", name: "Gym" }] });
test("nag + location", () => {
  assert.equal(P3("remind me to take pills at 9 and keep reminding me until I do it").nag, true);
  assert.deepEqual(P3("remind me to buy milk when I leave work").geo, { place: "work", when: "leave" });
  assert.deepEqual(P3("remind me to call mom when I get home").geo, { place: "home", when: "arrive" });
  const g = P3("remind me when I get to the gym to stretch");
  assert.equal(g.title, "Stretch"); assert.deepEqual(g.geo, { place: "gym", when: "arrive" });
});
test("conversation memory", () => {
  const a = P3("move it to 6"); assert.equal(a.intent, "modify"); assert.equal(a.timeOnly, true); assert.equal(a.changes.due, "2026-11-08T18:00");
  assert.deepEqual(P3("make it every week").changes, { repeat: "weekly" });
  assert.equal(P3("actually tomorrow at 8").changes.due, "2026-11-08T08:00");
  assert.equal(P3("6 pm instead").timeOnly, true);
  assert.deepEqual(P3("put it in my work folder").changes, { folder: "work" });
  assert.equal(P3("rename it to call dad").rename, "Call dad");
  assert.equal(P3("make it urgent").changes.priority, "high");
  assert.equal(P3("delete it").del, true);
  assert.equal(P3("add it to my calendar").calendar, true);
});
test("snooze until, focus, habits, briefing, navigation", () => {
  assert.deepEqual(P3("snooze until tomorrow morning"), { raw: "snooze until tomorrow morning", intent: "snoozeUntil", due: "2026-11-08T09:00" });
  const f = P3("start a 25 minute focus on write proposal"); assert.equal(f.minutes, 25); assert.equal(f.title, "Write proposal");
  assert.equal(P3("stop the timer").intent, "focusStop");
  const h = P3("add a habit drink water every day"); assert.equal(h.intent, "habitAdd"); assert.equal(h.title, "Drink water"); assert.equal(h.repeat, "daily");
  assert.equal(P3("check in drink water").query, "Drink water");
  assert.equal(P3("brief me").intent, "briefing");
  assert.equal(P3("what's my day like").intent, "briefing");
  assert.equal(P3("how was my week").intent, "summary");
  for (const [t, v] of [["open calendar", "calendar"], ["show my habits", "habits"], ["open focus timer", "focus"], ["open insights", "insights"]]) assert.equal(P3(t).target, v, t);
});
test("Tamil", () => {
  const a = P3("நாளை மாலை 5 மணிக்கு அம்மாவை அழைக்க நினைவூட்டு");
  assert.equal(a.intent, "reminder"); assert.equal(a.title, "அம்மாவை அழைக்க"); assert.equal(a.due, "2026-11-08T17:00");
  assert.equal(P3("10 நிமிடத்தில் மருந்து சாப்பிட நினைவூட்டு").due, "2026-11-07T21:10");
  const d = P3("தினமும் காலை 7 மணிக்கு நடைப்பயிற்சி நினைவூட்டு"); assert.equal(d.repeat, "daily"); assert.equal(d.due, "2026-11-08T07:00");
  const t = P3("பால் வாங்க பட்டியலில் சேர்"); assert.equal(t.intent, "todo"); assert.equal(t.title, "பால் வாங்க");
  assert.equal(P3("நேரம் என்ன").intent, "time");
  assert.equal(P3("இன்று என்ன இருக்கு").intent, "query");
});
