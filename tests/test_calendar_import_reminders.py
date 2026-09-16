from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import json

import httpx
import pytest

from inkwell import calendar_import, calendar_reminders, microsoft, store
from inkwell.app import Event

ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting-1@example.org\r\nDTSTART:20990102T100000Z\r\nDTEND:20990102T110000Z\r\nSUMMARY:Planning\r\nLOCATION:Room A\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"


def test_ics_preview_import_deduplication_and_delete_cleanup(client):
    response = client.post("/api/calendar/import/preview", json={"content": ICS})
    assert response.status_code == 200
    entries = response.json()["entries"]
    assert entries[0]["event"]["title"] == "Planning"
    assert client.get("/api/events").json() == []
    assert client.post("/api/calendar/import", json={"entries": entries}).json() == {
        "added": 1,
        "skipped": 0,
    }
    assert client.post("/api/calendar/import", json={"entries": entries}).json() == {
        "added": 0,
        "skipped": 1,
    }
    event = client.get("/api/events").json()[0]
    client.delete("/api/events/" + str(event["id"]))
    assert client.post("/api/calendar/import", json={"entries": entries}).json()["added"] == 1


def test_date_timezone_recurrence_and_atomic_validation(client):
    text = (
        ICS.replace("20990102T100000Z", "20260302T100000")
        .replace("20990102T110000Z", "20260302T110000")
        .replace("SUMMARY:", "RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO\r\nSUMMARY:")
    )
    entries = calendar_import.parse(text, "Europe/London", Event)
    assert entries[0]["event"]["timezone"] == "Europe/London"
    assert entries[0]["event"]["recurrence"]["count"] == 3
    bad = [*entries, {"uid": "invalid", "event": {**entries[0]["event"], "title": ""}}]
    assert client.post("/api/calendar/import", json={"entries": bad}).status_code == 422
    assert client.get("/api/events").json() == []
    all_day = ICS.replace("DTSTART:20990102T100000Z", "DTSTART;VALUE=DATE:20990102").replace(
        "DTEND:20990102T110000Z", "DTEND;VALUE=DATE:20990104"
    )
    event = calendar_import.parse(all_day, "Africa/Johannesburg", Event)[0]["event"]
    assert event["all_day"] and event["end"].startswith("2099-01-04T00:00:00")


@pytest.mark.parametrize(
    "extra",
    [
        "EXDATE:20990103T100000Z",
        "RECURRENCE-ID:20990102T100000Z",
        "STATUS:CANCELLED",
        "RRULE:FREQ=MONTHLY;BYDAY=2MO",
    ],
)
def test_unsupported_invitation_features_fail_explicitly(client, extra):
    response = client.post(
        "/api/calendar/import/preview",
        json={"content": ICS.replace("SUMMARY:", extra + "\r\nSUMMARY:")},
    )
    assert response.status_code == 422
    assert client.get("/api/events").json() == []


def test_folded_component_limit_and_unterminated_timezone(client):
    folded = "BEGIN:VCALENDAR\r\n" + "BEG\r\n IN:VEVENT\r\n" * 401 + "END:VCALENDAR\r\n"
    assert client.post("/api/calendar/import/preview", json={"content": folded}).status_code == 422
    malformed = ICS.replace("BEGIN:VEVENT", "BEGIN:VTIMEZONE\r\nTZID:UTC\r\nBEGIN:VEVENT")
    assert (
        client.post("/api/calendar/import/preview", json={"content": malformed}).status_code == 422
    )


def test_unknown_timezone_dst_gap_and_untrusted_timezone_programs(client):
    unknown = ICS.replace("DTSTART:20990102T100000Z", "DTSTART;TZID=Unknown/Zone:20990102T100000")
    assert client.post("/api/calendar/import/preview", json={"content": unknown}).status_code == 422
    gap = ICS.replace(
        "DTSTART:20990102T100000Z", "DTSTART;TZID=America/New_York:20260308T023000"
    ).replace("DTEND:20990102T110000Z", "DTEND;TZID=America/New_York:20260308T040000")
    assert client.post("/api/calendar/import/preview", json={"content": gap}).status_code == 422
    # This untrusted program must not be expanded by the ICS library.
    zone = "BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nBEGIN:STANDARD\r\nDTSTART:16010101T000000\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0500\r\nRRULE:FREQ=SECONDLY;COUNT=999999999\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n"
    entries = calendar_import.parse(
        ICS.replace("BEGIN:VEVENT", zone + "BEGIN:VEVENT"), "UTC", Event
    )
    assert entries[0]["event"]["title"] == "Planning"


def test_windows_timezone_and_dst(client):
    text = (
        ICS.replace(
            "DTSTART:20990102T100000Z", "DTSTART;TZID=Eastern Standard Time:20260302T100000"
        )
        .replace("DTEND:20990102T110000Z", "DTEND;TZID=Eastern Standard Time:20260302T110000")
        .replace("SUMMARY:", "RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO\r\nSUMMARY:")
    )
    entries = calendar_import.parse(text, "UTC", Event)
    assert entries[0]["event"]["timezone"] == "America/New_York"
    client.post("/api/calendar/import", json={"entries": entries})
    occurrences = client.get(
        "/api/events/occurrences",
        params={"start": "2026-03-01T00:00:00Z", "end": "2026-03-20T00:00:00Z"},
    ).json()
    assert [e["start"][11:16] for e in occurrences] == ["15:00", "14:00", "14:00"]


def test_outlook_mime_invitation_retrieval_is_get_only(client, monkeypatch):
    with store.db() as db:
        db.execute(
            "INSERT INTO accounts(id,name,email,provider,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security) VALUES(1,'Work','me@example.org','microsoft','',993,'',587,'me@example.org','','starttls')"
        )
        db.execute(
            "INSERT INTO messages(id,account_id,remote_key,sender,recipient,subject,body,date) VALUES(99,1,'1:graph:a/b','sender@example.org','me@example.org','Meeting','','2099-01-01')"
        )
    mime = EmailMessage()
    mime.set_content("Meeting invitation")
    mime.add_attachment(ICS.encode(), maintype="text", subtype="calendar", filename="invite.ics")
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=mime.as_bytes())

    monkeypatch.setattr(microsoft, "access_token", lambda a: "test-token")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handler))
    )
    response = client.get("/api/messages/99/calendar-invites")
    assert response.status_code == 200 and len(response.json()["entries"]) == 1
    assert len(calls) == 1 and calls[0].method == "GET"
    assert "%2F" in str(calls[0].url) and str(calls[0].url).endswith("/$value")
    assert client.get("/api/events").json() == []


def test_recurring_reminders_follow_occurrence_dates_and_skip_all_day(client):
    now = datetime(2026, 9, 16, 12, tzinfo=timezone.utc)
    start = now - timedelta(days=1) + timedelta(minutes=15)
    client.post(
        "/api/events",
        json={
            "title": "Daily",
            "start": start.isoformat(),
            "end": (start + timedelta(hours=1)).isoformat(),
            "recurrence": {"frequency": "daily", "count": 2},
        },
    )
    client.post(
        "/api/events",
        json={
            "title": "All day",
            "start": "2026-09-16T00:00:00Z",
            "end": "2026-09-17T00:00:00Z",
            "all_day": True,
        },
    )
    first = calendar_reminders.due(now - timedelta(days=1))
    second = calendar_reminders.due(now)
    assert len(first) == len(second) == 1
    assert first[0]["key"] != second[0]["key"]
    assert second[0]["start"].startswith("2026-09-16T12:15")
    assert calendar_reminders.due(now + timedelta(days=1)) == []


def test_reminders_due_early_deduplicated_and_deleted_with_event(client, monkeypatch):
    now = datetime(2026, 9, 16, 12, tzinfo=timezone.utc)
    start = now + timedelta(minutes=15, seconds=20)
    data = {
        "title": "Team meeting",
        "start": start.isoformat(),
        "end": (start + timedelta(hours=1)).isoformat(),
    }
    id = client.post("/api/events", json=data).json()["id"]
    due = calendar_reminders.due(now)
    assert len(due) == 1 and due[0]["event_id"] == id
    assert calendar_reminders.due(now - timedelta(minutes=1)) == []
    assert calendar_reminders.due(start) == []
    original = calendar_reminders.due
    monkeypatch.setattr(calendar_reminders, "due", lambda: original(now))
    assert (
        client.post(
            "/api/calendar/reminders/ack", json={"key": due[0]["key"], "event_id": id}
        ).status_code
        == 200
    )
    assert calendar_reminders.due() == []
    with store.db() as db:
        assert (
            json.loads(
                db.execute(
                    "SELECT value FROM settings WHERE key LIKE 'calendar-reminder:%'"
                ).fetchone()[0]
            )["event_id"]
            == id
        )
    client.delete("/api/events/" + str(id))
    assert client.post("/api/events", json=data).json()["id"] == id
    assert len(calendar_reminders.due()) == 1
