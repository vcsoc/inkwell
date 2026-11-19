"""Calendar discovery, inbound reconciliation and correctly scoped provider writes."""
import json
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs

import httpx
import pytest

from inkwell import app as application, microsoft, outlook_calendars as calendars, provider_sync, store

START = datetime(2027, 3, 1, tzinfo=timezone.utc)
END = START + timedelta(days=31)


def event_body(title='Meeting', **extra):
    return {'title': title, 'start': '2027-03-01T10:00:00Z', 'end': '2027-03-01T11:00:00Z', 'timezone': 'UTC', **extra}


@pytest.fixture
def connected(client, monkeypatch):
    application.PROVIDER_SYNC.stop()
    with store.db() as db:
        local = db.execute("INSERT INTO events(title,start,end) VALUES ('Historical local','2027-03-01T09:00:00Z','2027-03-01T10:00:00Z')").lastrowid
        secret = store.seal(json.dumps({'access_token': 'mock', 'expires_at': time.time() + 3600, 'scope': microsoft.WRITE_SCOPES}))
        account = db.execute("""INSERT INTO accounts(name,email,imap_host,imap_port,smtp_host,smtp_port,username,secret,smtp_security,provider,client_id)
            VALUES('Outlook','me@example.com','',993,'',587,'me@example.com',?,'starttls','microsoft','client')""", (secret,)).lastrowid
        provider_sync.connected(db, account)
    state = {'fail': None, 'deleted': set(), 'title': 'Remote meeting', 'malformed': False}
    calls = []
    def metadata(i):
        return {'id': f'cal{i}', 'name': f'Calendar {i}', 'canEdit': i < 2, 'isDefaultCalendar': i == 0}
    def handle(request):
        calls.append((request.method, request.url.path))
        assert request.headers['Authorization'] == 'Bearer mock'
        assert 'IdType="ImmutableId"' in request.headers['Prefer']
        path = request.url.path
        if path.endswith('/calendarGroups'):
            return httpx.Response(200, json={'value': [{'id': 'one'}, {'id': 'two'}, {'id': 'three'}]})
        if path.endswith('/calendarGroups/one/calendars'):
            return httpx.Response(200, json={'value': [metadata(0), metadata(1)]})
        if path.endswith('/calendarGroups/two/calendars'):
            return httpx.Response(200, json={'value': [metadata(2), metadata(3)]})
        if path.endswith('/calendarGroups/three/calendars'):
            return httpx.Response(200, json={'value': [metadata(4)]})
        if path == '/v1.0/me/calendars':
            if parse_qs(request.url.query.decode()).get('page'):
                return httpx.Response(200, json={'value': [metadata(1)]})
            return httpx.Response(200, json={'value': [metadata(0)], '@odata.nextLink': microsoft.GRAPH + '/me/calendars?page=2'})
        if path.endswith('/calendarView'):
            remote = path.split('/')[-2]
            if state['fail'] == remote:
                return httpx.Response(503)
            if state['malformed']:
                return httpx.Response(200, json={'value': [{'id': 'invalid'}]})
            values = [] if remote in state['deleted'] else [{'id': 'event-' + remote, 'subject': state['title'], 'start': {'dateTime': '2027-03-01T10:00:00.0000000', 'timeZone': 'UTC'}, 'end': {'dateTime': '2027-03-01T11:00:00.0000000', 'timeZone': 'UTC'}, 'body': {'contentType': 'text', 'content': 'Full event notes'}, 'isAllDay': False}]
            if state.get('master') and remote == 'cal0':
                for value in values:
                    value['seriesMasterId'] = state['master']
            return httpx.Response(200, json={'value': values})
        raise AssertionError(path)
    monkeypatch.setattr(microsoft, 'client', lambda: httpx.Client(transport=httpx.MockTransport(handle)))
    worker = calendars.CalendarWorker()
    return client, account, local, state, calls, worker


def pull(connected):
    worker = connected[-1]
    worker.run_once(START, END)
    return worker.status()


def test_discovers_five_across_groups_and_pages_without_uploading_local_entries(connected):
    client, account, local, state, calls, worker = connected
    assert pull(connected)['errors'] == []
    listing = client.get('/api/calendars').json()
    assert len(listing['calendars']) == 5
    assert sum(c['can_edit'] for c in listing['calendars']) == 2
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6
        assert db.execute('SELECT COUNT(*) FROM provider_jobs').fetchone()[0] == 0
        assert db.execute('SELECT provider_account_id FROM events WHERE id=?', (local,)).fetchone()[0] is None
        assert not db.execute('SELECT 1 FROM settings WHERE key=?', (calendars.GUARD,)).fetchone()
    assert all(method == 'GET' for method, _ in calls)
    pull(connected)
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6
        assert db.execute('SELECT COUNT(*) FROM provider_jobs').fetchone()[0] == 0


def test_visibility_filters_occurrences_without_deleting_events(connected):
    client = connected[0]
    pull(connected)
    source = client.get('/api/calendars').json()['calendars'][0]
    assert client.patch(f"/api/calendars/{source['id']}", json={'selected': False}).status_code == 200
    values = client.get('/api/events/occurrences', params={'start': START.isoformat(), 'end': END.isoformat()}).json()
    assert len(values) == 5
    assert all(e['provider_calendar_id'] != source['id'] for e in values)
    from inkwell import calendar_reminders
    assert len(calendar_reminders.due(START + timedelta(hours=9, minutes=50))) == 4
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6


def test_server_updates_and_deletes_do_not_echo_provider_jobs(connected):
    pull(connected)
    connected[3].update(title='Updated remotely', deleted={'cal1'})
    pull(connected)
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events WHERE provider_calendar_id IS NOT NULL').fetchone()[0] == 4
        assert db.execute("SELECT COUNT(*) FROM events WHERE title='Updated remotely'").fetchone()[0] == 4
        assert db.execute('SELECT COUNT(*) FROM provider_jobs').fetchone()[0] == 0


def test_pending_edit_and_delete_are_not_overwritten_or_resurrected(connected):
    client = connected[0]
    pull(connected)
    with store.db() as db:
        rows = [dict(r) for r in db.execute('SELECT * FROM events WHERE provider_calendar_id IS NOT NULL ORDER BY id LIMIT 2')]
    assert client.put(f"/api/events/{rows[0]['id']}", json=event_body('Local pending edit')).status_code == 200
    assert client.delete(f"/api/events/{rows[1]['id']}").status_code == 200
    pull(connected)
    with store.db() as db:
        assert db.execute('SELECT title FROM events WHERE id=?', (rows[0]['id'],)).fetchone()[0] == 'Local pending edit'
        assert not db.execute('SELECT id FROM events WHERE provider_event_id=?', (rows[1]['provider_event_id'],)).fetchone()
        assert db.execute('SELECT COUNT(*) FROM provider_jobs').fetchone()[0] == 2


def test_read_only_calendar_refuses_edit_delete_and_create_atomically(connected):
    client = connected[0]
    pull(connected)
    with store.db() as db:
        event = dict(db.execute('SELECT e.* FROM events e JOIN outlook_calendars c ON c.id=e.provider_calendar_id WHERE c.can_edit=0 LIMIT 1').fetchone())
    assert client.put(f"/api/events/{event['id']}", json=event_body('Wrong')).status_code == 409
    assert client.delete(f"/api/events/{event['id']}").status_code == 409
    assert client.post('/api/events', json=event_body(calendar_id=event['provider_calendar_id'])).status_code == 409
    with store.db() as db:
        assert db.execute('SELECT title FROM events WHERE id=?', (event['id'],)).fetchone()[0] == event['title']
        assert db.execute('SELECT COUNT(*) FROM provider_jobs').fetchone()[0] == 0


def test_create_queues_to_selected_calendar_and_unchanged_notes_are_not_rewritten(connected, monkeypatch):
    client = connected[0]
    pull(connected)
    with store.db() as db:
        source = dict(db.execute("SELECT * FROM outlook_calendars WHERE remote_id='cal1'").fetchone())
        remote = dict(db.execute('SELECT * FROM events WHERE provider_calendar_id=?', (source['id'],)).fetchone())
    created = client.post('/api/events', json=event_body(calendar_id=source['id'])).json()['id']
    assert client.put(f"/api/events/{remote['id']}", json=event_body('Rename only', notes=remote['notes'])).status_code == 200
    calls = []
    def graph(account, method, path, *, payload=None, **kwargs):
        calls.append((method, path, payload))
        return {'id': 'new-event'}
    monkeypatch.setattr(provider_sync, 'graph', graph)
    with store.db() as db:
        jobs = [dict(r) for r in db.execute('SELECT * FROM provider_jobs ORDER BY id')]
    assert jobs[0]['resource_id'] == created
    provider_sync.perform(jobs[0])
    provider_sync.perform(jobs[1])
    assert calls[0][1] == 'calendars/cal1/events'
    assert calls[1][1] == 'calendars/cal1/events/event-cal1'
    assert 'body' not in calls[1][2]


def test_download_failure_retains_previous_events_and_marks_calendar(connected):
    pull(connected)
    connected[3]['fail'] = 'cal4'
    assert pull(connected)['errors']
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6
        assert db.execute("SELECT error FROM outlook_calendars WHERE remote_id='cal4'").fetchone()[0]
    connected[3]['fail'] = None
    pull(connected)
    with store.db() as db:
        assert db.execute("SELECT error FROM outlook_calendars WHERE remote_id='cal4'").fetchone()[0] == ''


def test_malformed_response_does_not_prune_saved_events(connected):
    pull(connected)
    connected[3]['malformed'] = True
    assert pull(connected)['errors']
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6
        assert db.execute('SELECT COUNT(*) FROM provider_jobs').fetchone()[0] == 0


def test_missing_consent_is_explicit_and_makes_no_graph_requests(connected):
    with store.db() as db:
        db.execute('UPDATE accounts SET secret=?', (store.seal(json.dumps({'scope': 'Mail.Read'})),))
    result = pull(connected)
    assert 'Calendar access required' in result['errors'][0]['error']
    assert not connected[4]


def test_untrusted_pagination_never_receives_bearer_token(connected):
    account_id = connected[1]
    with store.db() as db:
        account = dict(db.execute('SELECT * FROM accounts WHERE id=?', (account_id,)).fetchone())
    calls = []
    def handle(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={'value': [], '@odata.nextLink': 'https://evil.invalid/steal'})
    with httpx.Client(transport=httpx.MockTransport(handle)) as http:
        with pytest.raises(ValueError, match='Unsafe'):
            calendars.pages(http, account, 'calendars')
    assert len(calls) == 1


def test_sync_range_validation_and_idempotent_schema_migration(connected):
    client = connected[0]
    assert client.post('/api/calendars/sync', json={'start': '2027-03-01T00:00:00', 'end': '2027-04-01T00:00:00'}).status_code == 422
    assert client.post('/api/calendars/sync', json={'start': START.isoformat(), 'end': (START + timedelta(days=400)).isoformat()}).status_code == 422
    assert client.post('/api/calendars/sync', json={'start': START.isoformat(), 'end': END.isoformat()}).status_code == 200
    pull(connected)
    store.init()
    store.init()
    with store.db() as db:
        assert db.execute('PRAGMA user_version').fetchone()[0] == 22
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6


def test_all_day_events_preserve_original_date_east_of_utc(connected, monkeypatch):
    pull(connected)
    with store.db() as db:
        account = dict(db.execute('SELECT * FROM accounts').fetchone())
        source = dict(db.execute("SELECT * FROM outlook_calendars WHERE remote_id='cal0'").fetchone())
    monkeypatch.setattr(calendars, 'pages', lambda *args, **kwargs: [{'id': 'all-day', 'subject': 'Holiday', 'isAllDay': True,
        'originalStartTimeZone': 'Line Islands Standard Time',
        'start': {'dateTime': '2027-02-28T10:00:00.0000000'}, 'end': {'dateTime': '2027-03-01T10:00:00.0000000'}}])
    calendars.cache(None, account, source, START - timedelta(days=1), END)
    with store.db() as db:
        row = db.execute("SELECT start,end FROM events WHERE provider_event_id='all-day'").fetchone()
    assert row['start'].startswith('2027-03-01T00:00:00')
    assert row['end'].startswith('2027-03-02T00:00:00')


def test_calendar_response_cannot_cross_a_reused_account_identity(connected, monkeypatch):
    pull(connected)
    with store.db() as db:
        account = dict(db.execute('SELECT * FROM accounts').fetchone())
        source = dict(db.execute("SELECT * FROM outlook_calendars WHERE remote_id='cal0'").fetchone())
        db.execute("UPDATE accounts SET email='different@example.com'")
    monkeypatch.setattr(calendars, 'pages', lambda *args, **kwargs: [])
    calendars.cache(None, account, source, START, END)
    assert calendars.discover(None, account) == []
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6
        assert db.execute('SELECT COUNT(*) FROM outlook_calendars WHERE removed=0').fetchone()[0] == 5


def test_cancelled_calendar_download_cannot_prune_events(connected, monkeypatch):
    import threading
    pull(connected)
    cancel = threading.Event()
    with store.db() as db:
        account = dict(db.execute('SELECT * FROM accounts').fetchone())
        source = dict(db.execute("SELECT * FROM outlook_calendars WHERE remote_id='cal0'").fetchone())
    def stop_after_response(*args, **kwargs):
        cancel.set()
        return []
    monkeypatch.setattr(calendars, 'pages', stop_after_response)
    calendars.cache(None, account, source, START, END, cancel=cancel)
    with store.db() as db:
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6


def test_local_series_master_does_not_duplicate_downloaded_occurrences(connected):
    client, account, local, state, calls, worker = connected
    with store.db() as db:
        account_row = dict(db.execute('SELECT * FROM accounts').fetchone())
    with microsoft.client() as http:
        calendars.discover(http, account_row)
    with store.db() as db:
        source = db.execute("SELECT id FROM outlook_calendars WHERE remote_id='cal0'").fetchone()[0]
    master = client.post('/api/events', json=event_body('Local series', calendar_id=source, recurrence={'frequency': 'weekly', 'count': 3})).json()['id']
    with store.db() as db:
        db.execute("UPDATE events SET provider_event_id='master' WHERE id=?", (master,))
        db.execute("INSERT INTO settings(key,value) VALUES ('calendar-import:series',?)", (json.dumps({'event_id': master}),))
    state['master'] = 'master'
    pull(connected)
    with store.db() as db:
        assert db.execute('SELECT id FROM events WHERE id=?', (master,)).fetchone()
        assert not db.execute("SELECT id FROM events WHERE provider_event_id='event-cal0'").fetchone()
        db.execute("UPDATE provider_jobs SET state='done'")
    pull(connected)
    with store.db() as db:
        assert not db.execute('SELECT id FROM events WHERE id=?', (master,)).fetchone()
        assert db.execute("SELECT id FROM events WHERE provider_event_id='event-cal0'").fetchone()
        assert db.execute('SELECT COUNT(*) FROM events').fetchone()[0] == 6
        assert db.execute('SELECT COUNT(*) FROM provider_jobs').fetchone()[0] == 1
        assert db.execute("SELECT 1 FROM settings WHERE key='calendar-import:series'").fetchone()

