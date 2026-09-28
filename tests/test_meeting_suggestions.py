"""Untrusted booking mail stays tentative until an explicit local decision."""

from datetime import datetime, timezone

from inkwell import meeting_suggestions, store
from inkwell.app import Event


BOOKING = """Upcoming booking for
Christopher Visser

Christopher Visser - FinGlobal Consultation
Monday, September 28, 2026
7:10 AM - 7:30 AM
(UTC-05:00) Eastern Time (US & Canada)
Powered by Microsoft Bookings
"""
RANGE = {"start": "2026-09-01T00:00:00Z", "end": "2026-10-15T00:00:00Z"}


def insert(body, subject="Reminder: Christopher Visser - FinGlobal Consultation"):
    with store.db() as db:
        return db.execute(
            "INSERT INTO messages(sender,recipient,subject,body,date) VALUES ('unverified@example.org','me@example.org',?,?,?)",
            (subject, body, "2026-09-28T10:25:21Z"),
        ).lastrowid


def test_bookings_reminders_are_visible_without_provider_rsvp(client):
    first = insert(BOOKING)
    second = insert(BOOKING)
    pending = client.get("/api/calendar/pending", params=RANGE)
    assert pending.status_code == 200, pending.text
    items = pending.json()
    assert len(items) == 1
    invitation = items[0]
    assert invitation["status"] == "pending"
    assert invitation["event"]["title"] == "Christopher Visser - FinGlobal Consultation"
    assert datetime.fromisoformat(invitation["event"]["start"]).astimezone(timezone.utc).hour == 11
    assert invitation["message_id"] in (first, second)
    assert client.get("/api/events").json() == []
    response = client.post(
        f"/api/calendar/pending/{invitation['message_id']}",
        json={"uid": invitation["uid"], "action": "accept"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["event_id"]
    assert client.get("/api/calendar/pending", params=RANGE).json() == []
    assert len(client.get("/api/events").json()) == 1
    assert client.post(f"/api/calendar/pending/{first}", json={"uid": invitation["uid"], "action": "accept"}).status_code == 409
    assert client.post(f"/api/calendar/pending/{first}", json={"uid": "forged", "action": "accept"}).status_code == 404


def test_reject_ignore_and_undated_or_cancelled_mail(client):
    ignored = insert(BOOKING.replace("7:10 AM - 7:30 AM", "8:10 AM - 8:30 AM"))
    cancelled = insert(BOOKING.replace("7:10 AM - 7:30 AM", "9:10 AM - 9:30 AM"), "Cancelled booking")
    insert("Meeting scheduled. No unambiguous date and time.")
    assert meeting_suggestions.proposals({"body": BOOKING, "subject": "Cancelled booking", "account_id": None}, Event) == []
    proposals = client.get("/api/calendar/pending", params=RANGE).json()
    assert len(proposals) == 1  # Cancellations and undated mail are excluded.
    one = next(p for p in proposals if p["message_id"] == ignored)
    assert client.post(f"/api/calendar/pending/{cancelled}", json={"uid": one["uid"], "action": "accept"}).status_code == 404
    assert client.post(f"/api/calendar/pending/{ignored}", json={"uid": one["uid"], "action": "reject"}).json()["status"] == "reject"
    assert next(p for p in client.get("/api/calendar/pending", params=RANGE).json() if p["uid"] == one["uid"])["status"] == "rejected"
    assert client.post(f"/api/calendar/pending/{ignored}", json={"uid": one["uid"], "action": "ignore"}).json()["status"] == "ignore"
    assert all(p["uid"] != one["uid"] for p in client.get("/api/calendar/pending", params=RANGE).json())
    assert client.get("/api/events").json() == []
