"""Tests for the Nudge backend:  python3 -m unittest discover -s tests -v"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402

FMT = "%Y-%m-%dT%H:%M"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.httpd, self.store = server.make_server("127.0.0.1", 0, os.path.join(self.tmp.name, "t.db"),
                                                    desktop=False, scheduler=False)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.store.db.close()
        self.tmp.cleanup()

    def call(self, path, method="GET", body=None):
        req = urllib.request.Request(self.url + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())


class ApiTests(Base):
    def test_create_list_update_delete(self):
        due = (datetime.now() + timedelta(hours=2)).strftime(FMT)
        st, t = self.call("/api/tasks", "POST", {"title": "  Call Ravi ", "due": due, "priority": "high"})
        self.assertEqual(st, 201)
        self.assertEqual(t["title"], "Call Ravi")
        self.assertEqual(t["remind_at"], due)
        st, t = self.call(f"/api/tasks/{t['id']}", "PUT", {"remind_before": 30, "notes": "about RP1"})
        self.assertEqual(st, 200)
        self.assertEqual(t["remind_at"], (datetime.strptime(due, FMT) - timedelta(minutes=30)).strftime(FMT))
        st, data = self.call("/api/tasks")
        self.assertEqual([x["notes"] for x in data["tasks"]], ["about RP1"])
        self.assertIn("now", data)
        self.assertEqual(self.call(f"/api/tasks/{t['id']}", "DELETE")[0], 200)
        self.assertEqual(self.call(f"/api/tasks/{t['id']}", "DELETE")[0], 404)

    def test_validation(self):
        self.assertEqual(self.call("/api/tasks", "POST", {"title": ""})[0], 400)
        self.assertEqual(self.call("/api/tasks", "POST", {"title": "x", "due": "tomorrow"})[0], 400)
        self.assertEqual(self.call("/api/tasks", "POST", {"title": "x", "priority": "urgent"})[0], 400)
        self.assertEqual(self.call("/api/tasks", "POST", {"title": "x", "repeat": "daily"})[0], 400)
        self.assertEqual(self.call("/api/nope")[0], 404)
        self.assertEqual(self.call("/api/tasks/99", "PUT", {"title": "y"})[0], 404)

    def test_done_and_reopen(self):
        _, t = self.call("/api/tasks", "POST", {"title": "Buy milk"})
        _, t = self.call(f"/api/tasks/{t['id']}/done", "POST")
        self.assertTrue(t["done"])
        self.assertIsNone(t["remind_at"])
        _, t = self.call(f"/api/tasks/{t['id']}/undone", "POST")
        self.assertFalse(t["done"])

    def test_repeating_task_moves_to_next_occurrence(self):
        due = (datetime.now() - timedelta(days=2, hours=1)).replace(second=0, microsecond=0)
        _, t = self.call("/api/tasks", "POST", {"title": "Standup", "due": due.strftime(FMT), "repeat": "daily"})
        _, t = self.call(f"/api/tasks/{t['id']}/done", "POST")
        nxt = datetime.strptime(t["due"], FMT)
        self.assertFalse(t["done"])
        self.assertGreater(nxt, datetime.now())
        self.assertLessEqual(nxt - datetime.now(), timedelta(days=1))
        self.assertEqual((nxt.hour, nxt.minute), (due.hour, due.minute))

    def test_static_page(self):
        with urllib.request.urlopen(self.url + "/") as r:
            self.assertIn(b"Nudge", r.read())


class ReminderTests(Base):
    def test_due_reminder_fires_once(self):
        past = (datetime.now() - timedelta(minutes=1)).strftime(FMT)
        future = (datetime.now() + timedelta(hours=1)).strftime(FMT)
        _, a = self.call("/api/tasks", "POST", {"title": "due now", "due": past})
        self.call("/api/tasks", "POST", {"title": "later", "due": future})
        self.call("/api/tasks", "POST", {"title": "no date"})
        fired = self.store.due_now()
        self.assertEqual([t["title"] for t in fired], ["due now"])
        self.assertIsNotNone(fired[0]["reminded_at"])
        self.assertEqual(self.store.due_now(), [])  # not again

    def test_remind_before(self):
        due = (datetime.now() + timedelta(minutes=10)).strftime(FMT)
        self.call("/api/tasks", "POST", {"title": "meeting", "due": due, "remind_before": 15})
        self.assertEqual([t["title"] for t in self.store.due_now()], ["meeting"])

    def test_snooze_rearms_reminder(self):
        past = (datetime.now() - timedelta(minutes=1)).strftime(FMT)
        _, t = self.call("/api/tasks", "POST", {"title": "call", "due": past})
        self.assertEqual(len(self.store.due_now()), 1)
        st, t = self.call(f"/api/tasks/{t['id']}/snooze", "POST", {"minutes": 10})
        self.assertEqual(st, 200)
        self.assertIsNone(t["reminded_at"])
        self.assertEqual(self.store.due_now(), [])  # snoozed into the future
        self.store.db.execute("UPDATE tasks SET snoozed_until = ? WHERE id = ?", (past, t["id"]))
        self.assertEqual(len(self.store.due_now()), 1)  # fires again once the snooze ends

    def test_editing_due_rearms_reminder(self):
        past = (datetime.now() - timedelta(minutes=1)).strftime(FMT)
        _, t = self.call("/api/tasks", "POST", {"title": "x", "due": past})
        self.store.due_now()
        _, t = self.call(f"/api/tasks/{t['id']}", "PUT", {"due": past})
        self.assertIsNone(t["reminded_at"])

    def test_weekdays_and_monthly(self):
        fri = datetime(2026, 11, 6, 9, 0)  # a Friday
        self.assertEqual(server.next_occurrence(fri, "weekdays", fri).weekday(), 0)
        jan31 = datetime(2026, 1, 31, 9, 0)
        self.assertEqual(server.next_occurrence(jan31, "monthly", jan31), datetime(2026, 2, 28, 9, 0))


if __name__ == "__main__":
    unittest.main()
