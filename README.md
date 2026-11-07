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
GitHub Pages serves it at `https://<user>.github.io/task-reminder/`
(Settings → Pages → Branch `main`, folder `/docs`).

- Open the link, then tap **Install app** (Chrome) or **Add to Home screen**, then
  **Enable notifications**.
- Tasks are saved only on that device. To move them, use **Export backup** on one device
  and **Import backup** on the other.
- Reminders are checked every 15 s while the app is open, and immediately when you switch
  back to it, so missed reminders appear then. A static site has no server, so it can't
  wake a closed app; if you need alerts with the app fully closed, use the PC edition.

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
python3 -m unittest discover -s tests -v
```

## Files

```
docs/              phone app for GitHub Pages: index.html, app.js (on-device storage +
                   reminders), sw.js (offline + notification buttons), manifest, icons
server.py          HTTP server, JSON API, SQLite store, reminder scheduler
static/index.html  page
static/app.js      UI logic, polling, in-page and browser notifications
static/style.css   styles (light/dark, mobile)
tests/test_app.py  API and reminder tests
run.sh             start and open the browser
data/tasks.db      your tasks (created on first run)
```

> **Security:** there is no login. Keep the default (localhost only), and use `--lan`
> only on a network you trust.
