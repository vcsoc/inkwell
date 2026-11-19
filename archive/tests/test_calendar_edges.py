def test_monthly_missing_dates_and_optional_stop(client):
    event = {
        "title": "Month end",
        "start": "2026-01-31T00:00:00Z",
        "end": "2026-02-01T00:00:00Z",
        "all_day": True,
        "recurrence": {"frequency": "monthly", "count": 3},
    }
    id = client.post("/api/events", json=event).json()["id"]
    window = {"start": "2026-01-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"}
    assert [
        e["start"][:10] for e in client.get("/api/events/occurrences", params=window).json()
    ] == ["2026-01-31", "2026-03-31"]
    event["recurrence"]["until"] = "2026-02-28"
    assert client.put("/api/events/" + str(id), json=event).status_code == 200
    assert len(client.get("/api/events/occurrences", params=window).json()) == 1
    assert "RRULE:FREQ=MONTHLY;INTERVAL=1;COUNT=1" in client.get("/api/calendar.ics").text


def test_stop_date_uses_event_timezone_and_future_dst_gaps_are_skipped(client):
    event = {
        "title": "Late evening",
        "start": "2026-03-03T07:30:00Z",
        "end": "2026-03-03T08:00:00Z",
        "timezone": "America/Los_Angeles",
        "recurrence": {"frequency": "daily", "count": 3, "until": "2026-03-02"},
    }
    assert client.post("/api/events", json=event).status_code == 200
    window = {"start": "2026-03-01T00:00:00Z", "end": "2026-04-01T00:00:00Z"}
    assert len(client.get("/api/events/occurrences", params=window).json()) == 1
    event = {
        "title": "DST gap",
        "start": "2026-03-01T07:30:00Z",
        "end": "2026-03-01T08:00:00Z",
        "timezone": "America/New_York",
        "recurrence": {"frequency": "weekly", "count": 3},
    }
    assert client.post("/api/events", json=event).status_code == 200
    dates = [
        e["start"][:10]
        for e in client.get("/api/events/occurrences", params=window).json()
        if e["title"] == "DST gap"
    ]
    assert dates == ["2026-03-01", "2026-03-15"]
