import json
from datetime import datetime, timezone

import httpx
import pytest

from inkwell import microsoft, rules, store


def test_rule_filters_order_and_local_override(client):
    folder = client.post("/api/local-folders", json={"name": "Newsletters"}).json()["id"]
    rule = {
        "name": "Older read newsletters",
        "match": "domain",
        "value": "EXAMPLE.COM",
        "folder": "local-" + str(folder),
        "exclude_unread": True,
        "older_than_days": 7,
    }
    assert client.post("/api/rules", json=rule).status_code == 200
    assert (
        client.post(
            "/api/rules", json={**rule, "name": "Second match", "folder": "archive"}
        ).status_code
        == 200
    )
    now = datetime(2026, 9, 14, tzinfo=timezone.utc)
    with store.db() as db:
        for date, unread, sender, override in [
            ("2026-09-01T00:00:00Z", 0, "Sender <sender@example.com>", 0),
            ("2026-09-01T00:00:00Z", 1, "sender@example.com", 0),
            ("2026-09-10T00:00:00Z", 0, "sender@example.com", 0),
            ("2026-09-01T00:00:00Z", 0, "sender@other.example.com", 0),
            ("2026-09-01T00:00:00Z", 0, "sender@example.com", 1),
        ]:
            id = db.execute(
                "INSERT INTO messages(sender,recipient,subject,body,date,unread,local_folder_override) VALUES (?,'me@example.com','Test','Body',?,?,?)",
                (sender, date, unread, override),
            ).lastrowid
            changed = rules.apply(db, id, now)
            assert changed == (id == 1)
    assert len(client.get("/api/messages", params={"folder": "local-" + str(folder)}).json()) == 1
    assert client.delete("/api/local-folders/" + str(folder)).status_code == 409
    assert client.post("/api/rules", json={**rule, "folder": "local-999"}).status_code == 422


def test_graph_applies_rules_during_import_and_never_overrides_later_moves(client, monkeypatch):
    client.post(
        "/api/rules",
        json={
            "name": "Sender",
            "match": "sender",
            "value": "FRIEND@example.com",
            "folder": "archive",
        },
    )
    calls = []

    def handle(request):
        calls.append(request.method)
        return httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": "one",
                        "from": {"emailAddress": {"address": "friend@example.com"}},
                        "body": {"contentType": "text", "content": "Hello"},
                        "receivedDateTime": "2026-09-01T00:00:00Z",
                        "isRead": False,
                    }
                ]
            },
        )

    monkeypatch.setattr(microsoft, "access_token", lambda account: "token")
    monkeypatch.setattr(
        microsoft, "client", lambda: httpx.Client(transport=httpx.MockTransport(handle))
    )
    with store.db() as db:
        db.execute(
            "INSERT INTO accounts(id,name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security) VALUES (1,'Me','me@example.com','',993,'',465,'me@example.com','','tls')"
        )
    account = {"id": 1, "email": "me@example.com"}
    assert microsoft.sync_account(account) == 1
    m = client.get("/api/messages?folder=archive").json()[0]
    client.patch("/api/messages/" + str(m["id"]), json={"folder": "inbox"})
    assert microsoft.sync_account(account) == 0
    assert len(client.get("/api/messages").json()) == 1
    assert calls == ["GET", "GET"]


def test_rules_enable_edit_apply_and_delete(client):
    client.post("/api/demo")
    with store.db() as db:
        id = db.execute("SELECT id FROM messages LIMIT 1").fetchone()[0]
        db.execute(
            "UPDATE messages SET sender='friend@example.org',remote_key='sample' WHERE id=?", (id,)
        )
    rule = {"name": "Friends", "value": "friend@example.org", "folder": "archive", "enabled": False}
    rid = client.post("/api/rules", json=rule).json()["id"]
    assert client.post("/api/rules/apply").json()["moved"] == 0
    assert client.put("/api/rules/" + str(rid), json={**rule, "enabled": True}).status_code == 200
    assert client.post("/api/rules/apply").json()["moved"] == 1
    assert client.post("/api/rules/apply").json()["moved"] == 0
    assert client.delete("/api/rules/" + str(rid)).status_code == 200
    assert client.get("/api/rules").json() == []


def test_all_day_span_and_recurrence_export(client):
    value = {
        "title": "Three days",
        "start": "2026-09-14T00:00:00Z",
        "end": "2026-09-17T00:00:00Z",
        "all_day": True,
        "recurrence": {"frequency": "weekly", "interval": 2, "count": 3},
    }
    assert client.post("/api/events", json=value).status_code == 200
    result = client.get(
        "/api/events/occurrences",
        params={"start": "2026-09-01T00:00:00Z", "end": "2026-11-01T00:00:00Z"},
    ).json()
    assert [r["start"][:10] for r in result] == ["2026-09-14", "2026-09-28", "2026-10-12"]
    text = client.get("/api/calendar.ics").text
    assert "DTSTART;VALUE=DATE:20260914" in text
    assert "DTEND;VALUE=DATE:20260917" in text
    assert "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3" in text


def test_repeats_keep_wall_clock_across_dst_and_edit_whole_series(client):
    value = {
        "title": "Weekly meeting",
        "start": "2026-03-02T14:00:00Z",
        "end": "2026-03-02T15:00:00Z",
        "timezone": "America/New_York",
        "recurrence": {"frequency": "weekly", "weekdays": ["MO"], "count": 3},
    }
    id = client.post("/api/events", json=value).json()["id"]
    rows = client.get(
        "/api/events/occurrences",
        params={"start": "2026-03-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"},
    ).json()
    assert [r["start"][11:16] for r in rows] == ["14:00", "13:00", "13:00"]
    assert all(
        r["id"] == id and r["series_start"] == value["start"].replace("Z", "+00:00") for r in rows
    )
    value["recurrence"]["count"] = 2
    assert client.put("/api/events/" + str(id), json=value).status_code == 200
    assert json.loads(client.get("/api/events").json()[0]["recurrence"])["count"] == 2
    client.delete("/api/events/" + str(id))
    assert client.get("/api/events").json() == []


@pytest.mark.parametrize(
    "patch",
    [
        {"timezone": "No/SuchZone"},
        {"recurrence": {"frequency": "daily", "count": 1001}},
        {"all_day": True},
        {"recurrence": {"until": "2020-01-01"}},
    ],
)
def test_invalid_calendar_configuration(client, patch):
    assert (
        client.post(
            "/api/events",
            json={
                "title": "Test",
                "start": "2026-09-14T09:00:00Z",
                "end": "2026-09-14T10:00:00Z",
                **patch,
            },
        ).status_code
        == 422
    )
