# Task Reminder

Tasks with due times and reminders, in two editions:

| Edition | Where | Tasks stored | Reminders |
|---|---|---|---|
| **Phone app** (`docs/`) | GitHub Pages: open the link on any phone or PC and "Install" | on that device (browser storage) | while the app is open or recently used |
| **PC server** (`server.py`, `static/`) | your Ubuntu PC, `./run.sh` | `data/tasks.db` on the PC | desktop pop-up and sound, even with no browser open |

Both use the same interface and need nothing installed (plain JavaScript; the PC edition uses only the
Python standard library and SQLite).

## Phone app (GitHub Pages)

`docs/` is a static, installable web app (PWA) with an offline cache and a home-screen icon.
GitHub Pages serves it at `https://deivaprakash56.github.io/Custom-Reminder-Application/`
(Settings → Pages → Branch `main`, folder `/docs`). If Pages is set to the root folder instead,
the root `index.html` redirects to `docs/`, so the link still opens the app.

### What's inside

- **Sidebar** with a live 12-hour clock (and a countdown to your next reminder), search across
  everything, and smart lists: **Today, Scheduled, All, Overdue, Flagged, History**.
- **Folders:** Personal, Work, **Private** (password-protected) and your own folders (pick a colour;
  edit or delete from the ⋯ button).
- **Private folder:** private reminders and notes are encrypted with AES-256-GCM using a key derived
  from your password (PBKDF2-SHA-256, 310,000 rounds). It locks after 5 minutes. Private reminders
  still go off while locked, shown as "Private reminder". There is no password recovery: "Forgot
  password?" wipes the private items.
- **Workspace:** a **To-Do List** (drag to reorder, double-click to edit, progress bar), **Things to
  Do** (a To Do / In Progress / Done board with drag and drop), and a **Notepad** (autosave, pin,
  search, word count).
- **Voice assistant** (mic button or Ctrl+K): talk or type in plain English. Examples:
  - "Remind me to call mom tomorrow at 5 pm", "in 20 minutes remind me to check the oven"
  - "Remind me to take out the trash every weekday at 7:30 am", "… every Monday at 7"
  - "Remind me to pay rent on the 1st at 10 #work", "set a work reminder to email John at 4"
  - "… it's urgent", "… and remind me 30 minutes before"
  - "Add eggs to my shopping list", "Add redesign the logo to things to do"
  - "Take a note that the wifi password is …"
  - "What's on tomorrow?", "What's overdue?", "What time is it?"
  - "Mark call mom as done", "Delete the reminder about the dentist", "Snooze for 15 minutes", "Undo"
  - "Open my work folder", "Open notepad", "Lock private folder"

  If you leave out the time, it asks "When should I remind you?" and keeps listening. It answers out
  loud (turn this off in Settings), and you can turn on hands-free "Hey Reminders" in Settings.
  Voice input needs Chrome, Edge or Safari; typed commands work in every browser.
- The add bar on every list understands the same language and shows a live preview of what it
  understood.
- Reminders show an in-page alert with Done / Snooze, play a chime, can read the reminder aloud, and
  send a system notification if you allow it.
- Undo for every change, an activity log, light and dark themes, a phone layout, and export/import
  backups (Settings → Backup).

Tasks from the first version of the app are moved into the Personal folder automatically.
Data stays on that device. Reminders fire while the app is open or recently used; a static site has
no server, so it can't wake a closed app. If you need alerts with the app fully closed, use the PC
edition.

## PC server edition

### Run

```bash
cd ~/Desktop/Claude/task_reminder
./run.sh                 # starts the server and opens http://127.0.0.1:8765
./run.sh --lan           # also reachable from your phone on the same Wi-Fi
python3 server.py --no-desktop   # no desktop pop-ups or sound
```

Keep the terminal open; Ctrl-C stops it. Your tasks are saved in `data/tasks.db`.

### Features

- Add tasks with a due date and time, a reminder offset (at due time, 5/10/15/30 min,
  1 hour or 1 day before), priority, repeat and notes.
- Quick due-time buttons: in 10 min, in 1 hour, tonight 8 PM, tomorrow 9 AM.
- Tasks are grouped as Overdue, Today, Tomorrow, This week, Later, No date and Completed.
  You can filter (Active, Today, Overdue, Upcoming, Completed, All) and search.
- Repeat every day, on weekdays, every week or every month. Ticking a repeating task
  moves it to its next occurrence.
- Snooze (+10 min or +1 hour), edit, delete, and reopen completed tasks.
- Light and dark themes (follows your system), and the layout works on a phone.

### How reminders work

The server checks every 5 s. When a task's reminder time arrives:

1. A **desktop notification** appears through `notify-send`, with the alarm sound
   (`paplay`). High-priority tasks use critical urgency, which stays on screen.
   This works even with no browser open.
2. Every open browser tab shows a **pop-up with Done / Snooze buttons** and plays a
   chime. If you clicked "Enable browser notifications", it also shows a system
   notification.

Each reminder fires once. Snoozing or changing the due time arms it again.
Browsers only allow notifications on `localhost` or HTTPS, so a phone opening the
`--lan` address gets the in-page pop-up and chime but not system notifications.

### Start automatically at login (optional)

```bash
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/task-reminder.desktop <<EOD
[Desktop Entry]
Type=Application
Name=Task Reminder
Exec=/usr/bin/python3 $HOME/Desktop/Claude/task_reminder/server.py
X-GNOME-Autostart-enabled=true
EOD
```

### API (JSON)

| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/tasks` | `{now, tasks: [...]}` |
| POST | `/api/tasks` | `{title, due?, remind_before?, priority?, repeat?, notes?}` |
| GET / PUT / DELETE | `/api/tasks/<id>` | PUT takes any subset of the fields |
| POST | `/api/tasks/<id>/done` | repeating tasks move to their next occurrence |
| POST | `/api/tasks/<id>/undone` | reopen |
| POST | `/api/tasks/<id>/snooze` | `{minutes}` |

Times are local and look like `2026-11-07T17:30`.

### Tests

```bash
python3 -m unittest discover -s tests -v     # PC server
node --test tests/test_nlp.js                # voice / natural-language parser (Node 18+)
```

## Files

```
docs/              phone app for GitHub Pages: index.html, app.js (UI, storage, vault,
                   reminders, assistant), nlp.js (natural-language parser), style.css,
                   sw.js (offline + notification buttons), manifest, icons
server.py          HTTP server, JSON API, SQLite store, reminder scheduler
static/index.html  page
static/app.js      UI logic, polling, in-page and browser notifications
static/style.css   styles (light/dark, mobile)
tests/test_app.py  API and reminder tests (PC server)
tests/test_nlp.js  natural-language parser tests
run.sh             start and open the browser
data/tasks.db      your tasks (created on first run)
```

> **Security:** there is no login. Keep the default (localhost only), and use `--lan`
> only on a network you trust.
