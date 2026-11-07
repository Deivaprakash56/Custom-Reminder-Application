#!/usr/bin/env python3
"""Task Reminder - a small local web app (Python standard library only).

    python3 server.py                 # http://127.0.0.1:8765
    python3 server.py --port 9000
    python3 server.py --lan           # also reachable from your phone on the same Wi-Fi
    python3 server.py --no-desktop    # no notify-send pop-ups / sound

Tasks live in data/tasks.db (SQLite). A scheduler thread checks every few seconds and,
when a task's reminder time arrives, shows a desktop notification (notify-send + alarm
sound) and records it, so every open browser tab also pops a notification.

Times are local wall-clock times stored as "YYYY-MM-DDTHH:MM" strings.
"""
import argparse
import calendar
import json
import os
import re
import shutil
import sqlite3
import subprocess
import threading
import time
from datetime import datetime, timedelta
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
FMT = "%Y-%m-%dT%H:%M"
PRIORITIES = ("low", "normal", "high")
REPEATS = ("none", "daily", "weekdays", "weekly", "monthly")
SOUND = "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga"


# --------------------------------------------------------------------------- time helpers
def now_local() -> datetime:
    return datetime.now()


def parse_dt(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValueError("date/time must be a string like 2026-11-07T17:30")
    value = value.strip()[:16]
    return datetime.strptime(value, FMT)


def fmt_dt(dt):
    return dt.strftime(FMT) if dt else None


def add_months(dt: datetime, n: int) -> datetime:
    m = dt.month - 1 + n
    y, m = dt.year + m // 12, m % 12 + 1
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))


def next_occurrence(due: datetime, repeat: str, after: datetime) -> datetime:
    """Next due time strictly after `after` (skips missed occurrences)."""
    step = {
        "daily": lambda d: d + timedelta(days=1),
        "weekly": lambda d: d + timedelta(weeks=1),
        "monthly": lambda d: add_months(d, 1),
        "weekdays": lambda d: d + timedelta(days={4: 3, 5: 2}.get(d.weekday(), 1)),
    }[repeat]
    nxt = step(due)
    while nxt <= after:
        nxt = step(nxt)
    return nxt


# --------------------------------------------------------------------------- storage
SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    notes         TEXT    NOT NULL DEFAULT '',
    due           TEXT,                       -- local "YYYY-MM-DDTHH:MM" or NULL
    remind_before INTEGER NOT NULL DEFAULT 0, -- minutes before due
    priority      TEXT    NOT NULL DEFAULT 'normal',
    repeat        TEXT    NOT NULL DEFAULT 'none',
    snoozed_until TEXT,                       -- overrides the reminder time when set
    reminded_at   TEXT,                       -- when the current reminder fired
    done          INTEGER NOT NULL DEFAULT 0,
    completed_at  TEXT,
    created_at    TEXT    NOT NULL
);
"""


class Store:
    def __init__(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)
        self.lock = threading.Lock()

    # -- helpers
    @staticmethod
    def remind_time(row):
        """When this task's reminder should fire, or None."""
        if row["done"]:
            return None
        if row["snoozed_until"]:
            return parse_dt(row["snoozed_until"])
        due = parse_dt(row["due"])
        return due - timedelta(minutes=row["remind_before"]) if due else None

    def to_dict(self, row):
        d = dict(row)
        d["done"] = bool(d["done"])
        d["remind_at"] = fmt_dt(self.remind_time(row))
        return d

    def get(self, task_id):
        row = self.db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return self.to_dict(row) if row else None

    # -- validation
    @staticmethod
    def clean(data, partial=False):
        out = {}
        if "title" in data or not partial:
            title = str(data.get("title", "")).strip()
            if not title:
                raise ValueError("title is required")
            out["title"] = title[:200]
        if "notes" in data:
            out["notes"] = str(data["notes"] or "")[:2000]
        if "due" in data:
            out["due"] = fmt_dt(parse_dt(data["due"]))
        if "remind_before" in data:
            mins = int(data["remind_before"] or 0)
            if not 0 <= mins <= 60 * 24 * 7:
                raise ValueError("remind_before must be 0..10080 minutes")
            out["remind_before"] = mins
        if "priority" in data:
            if data["priority"] not in PRIORITIES:
                raise ValueError(f"priority must be one of {PRIORITIES}")
            out["priority"] = data["priority"]
        if "repeat" in data:
            if data["repeat"] not in REPEATS:
                raise ValueError(f"repeat must be one of {REPEATS}")
            out["repeat"] = data["repeat"]
        if out.get("repeat", "none") != "none" and "due" in out and not out["due"]:
            raise ValueError("a repeating task needs a due date/time")
        return out

    # -- operations
    def list(self):
        with self.lock:
            rows = self.db.execute("SELECT * FROM tasks ORDER BY done, due IS NULL, due, id").fetchall()
            return [self.to_dict(r) for r in rows]

    def create(self, data):
        f = self.clean(data)
        f.setdefault("created_at", fmt_dt(now_local()))
        if f.get("repeat", "none") != "none" and not f.get("due"):
            raise ValueError("a repeating task needs a due date/time")
        cols = ", ".join(f)
        with self.lock:
            cur = self.db.execute(f"INSERT INTO tasks ({cols}) VALUES ({', '.join('?' * len(f))})",
                                  tuple(f.values()))
            self.db.commit()
            return self.get(cur.lastrowid)

    def update(self, task_id, data):
        f = self.clean(data, partial=True)
        with self.lock:
            row = self.db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not row:
                return None
            merged = {**dict(row), **f}
            if merged["repeat"] != "none" and not merged["due"]:
                raise ValueError("a repeating task needs a due date/time")
            if {"due", "remind_before"} & f.keys():  # new time -> remind again
                f["reminded_at"] = None
                f["snoozed_until"] = None
            if f:
                sets = ", ".join(f"{k} = ?" for k in f)
                self.db.execute(f"UPDATE tasks SET {sets} WHERE id = ?", (*f.values(), task_id))
                self.db.commit()
            return self.get(task_id)

    def delete(self, task_id):
        with self.lock:
            cur = self.db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            self.db.commit()
            return cur.rowcount > 0

    def set_done(self, task_id, done=True):
        """Complete a task. A repeating task instead moves on to its next occurrence."""
        with self.lock:
            row = self.db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not row:
                return None
            now = now_local()
            if done and row["repeat"] != "none" and row["due"]:
                nxt = next_occurrence(parse_dt(row["due"]), row["repeat"], now)
                self.db.execute("UPDATE tasks SET due = ?, reminded_at = NULL, snoozed_until = NULL, "
                                "completed_at = ? WHERE id = ?", (fmt_dt(nxt), fmt_dt(now), task_id))
            elif done:
                self.db.execute("UPDATE tasks SET done = 1, completed_at = ?, snoozed_until = NULL "
                                "WHERE id = ?", (fmt_dt(now), task_id))
            else:
                self.db.execute("UPDATE tasks SET done = 0, completed_at = NULL, reminded_at = NULL "
                                "WHERE id = ?", (task_id,))
            self.db.commit()
            return self.get(task_id)

    def snooze(self, task_id, minutes):
        minutes = int(minutes)
        if not 1 <= minutes <= 60 * 24 * 7:
            raise ValueError("snooze minutes must be 1..10080")
        with self.lock:
            until = now_local() + timedelta(minutes=minutes)
            cur = self.db.execute("UPDATE tasks SET snoozed_until = ?, reminded_at = NULL "
                                  "WHERE id = ? AND done = 0", (fmt_dt(until), task_id))
            self.db.commit()
            return self.get(task_id) if cur.rowcount else None

    def due_now(self):
        """Open tasks whose reminder time has arrived and hasn't fired yet; marks them fired."""
        fired = []
        with self.lock:
            now = now_local()
            for row in self.db.execute("SELECT * FROM tasks WHERE done = 0 AND reminded_at IS NULL"):
                at = self.remind_time(row)
                if at and at <= now:
                    fired.append(row["id"])
            stamp = now.strftime("%Y-%m-%dT%H:%M:%S")
            for tid in fired:
                self.db.execute("UPDATE tasks SET reminded_at = ? WHERE id = ?", (stamp, tid))
            self.db.commit()
            return [self.get(t) for t in fired]


# --------------------------------------------------------------------------- reminders
class Scheduler(threading.Thread):
    def __init__(self, store, desktop=True, period=5.0):
        super().__init__(daemon=True)
        self.store, self.period = store, period
        self.desktop = desktop and shutil.which("notify-send") is not None
        self.sound = shutil.which("paplay") if os.path.exists(SOUND) else None

    def run(self):
        while True:
            try:
                for task in self.store.due_now():
                    self.notify(task)
            except Exception as exc:  # keep the reminder loop alive
                print(f"[scheduler] {exc}", flush=True)
            time.sleep(self.period)

    def notify(self, t):
        due = t["due"].replace("T", " ") if t["due"] else "no due time"
        print(f"[reminder] #{t['id']} {t['title']} (due {due})", flush=True)
        if not self.desktop:
            return
        body = f"Due {due}" + (f"\n{t['notes']}" if t["notes"] else "")
        urgency = {"high": "critical", "low": "low"}.get(t["priority"], "normal")
        subprocess.Popen(["notify-send", "-a", "Task Reminder", "-u", urgency, "-i",
                          "appointment-soon", f"⏰ {t['title']}", body],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if self.sound:
            subprocess.Popen([self.sound, SOUND], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# --------------------------------------------------------------------------- HTTP API
ROUTE = re.compile(r"^/api/tasks(?:/(\d+))?(?:/(done|undone|snooze))?/?$")


class Handler(SimpleHTTPRequestHandler):
    store: Store = None

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=STATIC, **kw)

    def log_message(self, fmt, *args):  # quiet: only log errors
        if args and str(args[1])[:1] in "45":
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, status=HTTPStatus.OK):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 100_000:
            raise ValueError("request too large")
        data = json.loads(self.rfile.read(n) or b"{}") if n else {}
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        return data

    def api(self, method):
        m = ROUTE.match(self.path.split("?")[0])
        if not m:
            return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
        tid, action = (int(m.group(1)) if m.group(1) else None), m.group(2)
        s = self.store
        try:
            if tid is None and action is None:
                if method == "GET":
                    return self.send_json({"now": now_local().strftime("%Y-%m-%dT%H:%M:%S"),
                                           "tasks": s.list()})
                if method == "POST":
                    return self.send_json(s.create(self.read_json()), HTTPStatus.CREATED)
            elif tid is not None and action is None:
                if method == "GET":
                    res = s.get(tid)
                elif method in ("PUT", "PATCH"):
                    res = s.update(tid, self.read_json())
                elif method == "DELETE":
                    return (self.send_json({"deleted": tid}) if s.delete(tid)
                            else self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND))
                else:
                    res = False
                if res is None:
                    return self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND)
                if res is not False:
                    return self.send_json(res)
            elif method == "POST":
                if action == "snooze":
                    res = s.snooze(tid, self.read_json().get("minutes", 10))
                else:
                    res = s.set_done(tid, action == "done")
                return (self.send_json(res) if res
                        else self.send_json({"error": "not found"}, HTTPStatus.NOT_FOUND))
            self.send_json({"error": "method not allowed"}, HTTPStatus.METHOD_NOT_ALLOWED)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.api("GET")
        return super().do_GET()

    def do_POST(self):
        self.api("POST")

    def do_PUT(self):
        self.api("PUT")

    def do_PATCH(self):
        self.api("PATCH")

    def do_DELETE(self):
        self.api("DELETE")


def make_server(host, port, db_path, desktop=True, scheduler=True):
    store = Store(db_path)
    handler = type("BoundHandler", (Handler,), {"store": store})
    httpd = ThreadingHTTPServer((host, port), handler)
    if scheduler:
        Scheduler(store, desktop=desktop).start()
    return httpd, store


def main():
    ap = argparse.ArgumentParser(description="Task Reminder web app")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--lan", action="store_true",
                    help="listen on all interfaces (no login - only use on a trusted network)")
    ap.add_argument("--db", default=os.path.join(ROOT, "data", "tasks.db"))
    ap.add_argument("--no-desktop", action="store_true", help="no notify-send pop-ups or sound")
    args = ap.parse_args()
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    httpd, _ = make_server(host, args.port, args.db, desktop=not args.no_desktop)
    print(f"Task Reminder running at http://127.0.0.1:{args.port}"
          + ("  (also on your LAN IP - no password, trusted networks only)" if args.lan else ""),
          flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
