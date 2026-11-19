"""Discover Outlook calendars and cache expanded events without echoing writes."""
import json
import threading
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import microsoft, store

router = APIRouter(prefix='/api/calendars')
GUARD = 'provider_calendar_pull'


def migrate(db):
    db.execute('''CREATE TABLE IF NOT EXISTS outlook_calendars(
        id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, remote_id TEXT NOT NULL,
        name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '', can_edit INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0, selected INTEGER NOT NULL DEFAULT 1,
        removed INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', synced TEXT,
        UNIQUE(account_id,remote_id))''')
    if 'provider_calendar_id' not in {r['name'] for r in db.execute('PRAGMA table_info(events)')}:
        db.execute('ALTER TABLE events ADD COLUMN provider_calendar_id INTEGER')
    db.execute('CREATE INDEX IF NOT EXISTS event_provider_link ON events(provider_account_id,provider_event_id)')
    for name in ('insert', 'update', 'adopt', 'delete'):
        db.execute('DROP TRIGGER IF EXISTS provider_event_' + name)
    guard = f"NOT EXISTS(SELECT 1 FROM settings WHERE key='{GUARD}')"
    account = "coalesce(NEW.provider_account_id,CAST((SELECT value FROM settings WHERE key='provider_sync_account') AS INTEGER))"
    payload = "json_object('calendar_id',NEW.provider_calendar_id,'title',NEW.title,'start',NEW.start,'end',NEW.end,'location',NEW.location,'notes',NEW.notes,'all_day',NEW.all_day,'timezone',NEW.timezone,'recurrence',NEW.recurrence)"
    enabled = "(SELECT value FROM settings WHERE key='provider_sync_local_only')='false'"
    for name, action, condition, kind in (
        ('insert', 'INSERT', f'{account} IS NOT NULL', "'create'"),
        ('update', 'UPDATE OF title,start,end,location,notes,all_day,timezone,recurrence', 'NEW.provider_account_id IS NOT NULL', "CASE WHEN OLD.provider_account_id IS NULL AND NEW.provider_event_id IS NULL THEN 'create' ELSE 'update' END"),
        ('adopt', 'UPDATE OF title,start,end,location,notes,all_day,timezone,recurrence', f'NEW.provider_account_id IS NULL AND {account} IS NOT NULL', "'create'"),
    ):
        job_payload = payload if name != 'update' else payload[:-1] + ",'notes_changed',OLD.notes IS NOT NEW.notes)"
        db.execute(f'''CREATE TRIGGER provider_event_{name} AFTER {action} ON events
            WHEN {guard} AND {enabled} AND {condition}
            BEGIN
              UPDATE events SET provider_account_id={account} WHERE id=NEW.id;
              INSERT INTO provider_jobs(account_id,resource_type,resource_id,kind,payload)
              VALUES({account},'event',NEW.id,{kind},{job_payload});
            END''')
    db.execute(f'''CREATE TRIGGER provider_event_delete AFTER DELETE ON events
        WHEN {guard} AND {enabled} AND OLD.provider_account_id IS NOT NULL
        BEGIN INSERT INTO provider_jobs(account_id,resource_type,resource_id,kind,payload)
          VALUES(OLD.provider_account_id,'event',OLD.id,'delete',json_object('remote_id',OLD.provider_event_id,'calendar_id',OLD.provider_calendar_id)); END''')


def pages(http, account, path, *, cancel=None):
    url = microsoft.GRAPH + '/me/' + path
    headers = {'Authorization': 'Bearer ' + microsoft.access_token(account),
               'Prefer': 'IdType="ImmutableId", outlook.timezone="UTC", outlook.body-content-type="text"'}
    seen, values = set(), []
    for _ in range(200):
        if cancel is not None and cancel.is_set():
            raise InterruptedError('Calendar sync stopped')
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.netloc != 'graph.microsoft.com' or not parsed.path.startswith('/v1.0/') or parsed.fragment or url in seen:
            raise ValueError('Unsafe or repeated calendar pagination')
        seen.add(url)
        response = http.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data.get('value'), list):
            raise ValueError('Missing calendar page')
        values.extend(data['value'])
        url = data.get('@odata.nextLink')
        if not url:
            return values
    raise ValueError('Calendar pagination exceeded safety limit')


def discover(http, account, *, cancel=None):
    # /calendars is not sufficient for every non-default calendar group.
    items = pages(http, account, 'calendars?$top=100', cancel=cancel)
    groups = pages(http, account, 'calendarGroups?$select=id&$top=100', cancel=cancel)
    for group in groups:
        items.extend(pages(http, account, 'calendarGroups/' + quote(group['id'], safe='') + '/calendars?$top=100', cancel=cancel))
    found = {}
    for item in items:
        if not item.get('id') or not isinstance(item.get('name'), str):
            raise ValueError('Invalid Outlook calendar')
        found[item['id']] = item
    with store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        if (cancel is not None and cancel.is_set()) or not db.execute("SELECT 1 FROM accounts WHERE id=? AND email=? AND provider='microsoft'", (account['id'], account['email'])).fetchone():
            return []
        db.execute('UPDATE outlook_calendars SET removed=1 WHERE account_id=?', (account['id'],))
        for item in found.values():
            db.execute('''INSERT INTO outlook_calendars(account_id,remote_id,name,color,can_edit,is_default)
                VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,remote_id) DO UPDATE SET
                name=excluded.name,color=excluded.color,can_edit=excluded.can_edit,
                is_default=excluded.is_default,removed=0''',
                (account['id'], item['id'], item['name'], item.get('hexColor') or '',
                 bool(item.get('canEdit')), bool(item.get('isDefaultCalendar'))))
        return [dict(r) for r in db.execute('SELECT * FROM outlook_calendars WHERE account_id=? AND removed=0', (account['id'],))]


def stamp(value):
    # Graph returns seven fractional digits and, with our Prefer header, UTC wall times.
    value = value['dateTime']
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return (result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result).astimezone(timezone.utc).isoformat()


def cache(http, account, calendar, start, end, *, cancel=None):
    from urllib.parse import urlencode
    # Pad UTC queries so all-day events in distant timezones cover boundary dates.
    query = urlencode({'startDateTime': (start - timedelta(days=2)).isoformat(), 'endDateTime': (end + timedelta(days=2)).isoformat(), '$top': 100})
    items = pages(http, account, 'calendars/' + quote(calendar['remote_id'], safe='') + '/calendarView?' + query, cancel=cancel)
    records = []
    for item in items:
        if item.get('isCancelled'):
            continue
        first, last = stamp(item['start']), stamp(item['end'])
        if item.get('isAllDay'):
            from zoneinfo import ZoneInfo
            from icalendar.timezone.windows_to_olson import WINDOWS_TO_OLSON
            zone = item.get('originalStartTimeZone') or 'UTC'
            zone = ZoneInfo(WINDOWS_TO_OLSON.get(zone, zone))
            first, last = (datetime.fromisoformat(value).astimezone(zone).date().isoformat() + 'T00:00:00+00:00' for value in (first, last))
        records.append((item['id'], item.get('subject') or '(Untitled event)', first, last,
                        (item.get('location') or {}).get('displayName') or '', (item.get('body') or {}).get('content') or '', bool(item.get('isAllDay')), item.get('seriesMasterId')))
    with store.db() as db:
        db.execute('BEGIN IMMEDIATE')
        if (cancel is not None and cancel.is_set()) or not db.execute('SELECT 1 FROM outlook_calendars c JOIN accounts a ON a.id=c.account_id WHERE c.id=? AND c.account_id=? AND c.remote_id=? AND a.email=? AND c.removed=0', (calendar['id'], account['id'], calendar['remote_id'], account['email'])).fetchone():
            return
        db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', (GUARD, '1'))
        pending = {r[0] for r in db.execute("SELECT resource_id FROM provider_jobs WHERE account_id=? AND resource_type='event' AND state IN ('pending','running','failed')", (account['id'],))}
        from . import provider_sync
        deleting = {json.loads(job['payload']).get('remote_id') or provider_sync.event_remote(db, job)
                    for job in db.execute("SELECT * FROM provider_jobs WHERE account_id=? AND resource_type='event' AND kind='delete' AND state IN ('pending','running','failed')", (account['id'],))}
        seen = set()
        for remote_id, title, first, last, location, notes, all_day, master_id in records:
            seen.add(remote_id)
            if remote_id in deleting or master_id in deleting:
                continue
            if master_id:
                master = db.execute('SELECT id FROM events WHERE provider_account_id=? AND provider_event_id=?', (account['id'], master_id)).fetchone()
                if master:
                    if master[0] in pending:
                        continue
                    # Replace a confirmed locally-created master with Graph's expanded
                    # occurrences. Keep import UID markers so an ICS reimport stays idempotent.
                    db.execute('DELETE FROM events WHERE id=?', (master[0],))
                    db.execute("DELETE FROM settings WHERE key LIKE 'calendar-reminder:%' AND json_extract(value,'$.event_id')=?", (master[0],))
            existing = db.execute('SELECT id FROM events WHERE provider_account_id=? AND provider_event_id=?', (account['id'], remote_id)).fetchone()
            if existing and existing[0] in pending:
                continue
            values = (title, first, last, location, notes, all_day, 'UTC', '{}', account['id'], remote_id, calendar['id'])
            if existing:
                db.execute('UPDATE events SET title=?,start=?,end=?,location=?,notes=?,all_day=?,timezone=?,recurrence=?,provider_account_id=?,provider_event_id=?,provider_calendar_id=? WHERE id=?', (*values, existing[0]))
            else:
                db.execute('INSERT INTO events(title,start,end,location,notes,all_day,timezone,recurrence,provider_account_id,provider_event_id,provider_calendar_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', values)
        for row in db.execute('SELECT id,provider_event_id FROM events WHERE provider_calendar_id=? AND inkwell_timestamp(start)<? AND inkwell_timestamp(end)>?', (calendar['id'], end.timestamp() * 1_000_000, start.timestamp() * 1_000_000)).fetchall():
            if row['provider_event_id'] not in seen and row['id'] not in pending:
                db.execute('DELETE FROM events WHERE id=?', (row['id'],))
                db.execute("DELETE FROM settings WHERE (key LIKE 'calendar-import:%' OR key LIKE 'calendar-reminder:%') AND json_extract(value,'$.event_id')=?", (row['id'],))
        db.execute("UPDATE outlook_calendars SET synced=CURRENT_TIMESTAMP,error='' WHERE id=?", (calendar['id'],))
        db.execute('DELETE FROM settings WHERE key=?', (GUARD,))


def write_target(db, calendar_id):
    row = db.execute('SELECT c.*,a.secret,a.provider FROM outlook_calendars c JOIN accounts a ON a.id=c.account_id WHERE c.id=? AND c.removed=0', (calendar_id,)).fetchone()
    if not row:
        raise HTTPException(409, 'This Outlook calendar is unavailable. Refresh calendars first.')
    if not row['can_edit'] or not microsoft.has_calendar_write_permissions(row):
        raise HTTPException(409, 'This calendar is read-only or needs Microsoft calendar write consent. No change was made.')
    return row


class SyncRange(BaseModel):
    start: datetime
    end: datetime


class CalendarWorker:
    def __init__(self):
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.requested = None
        self.state = {'active': False, 'revision': 0, 'errors': []}

    def status(self):
        with self.lock:
            return {**self.state, 'errors': [dict(e) for e in self.state['errors']]}

    def request(self, start, end):
        if not start.tzinfo or not end.tzinfo or end <= start or end - start > timedelta(days=370):
            raise HTTPException(422, 'Choose a timezone-aware calendar range of at most 370 days.')
        with self.lock:
            self.requested = (start, end)
        self.wake.set()
        return self.status()

    def run_once(self, start, end):
        with self.lock:
            self.state.update(active=True, errors=[])
        errors = []
        try:
            with store.db() as db:
                accounts = [dict(r) for r in db.execute("SELECT * FROM accounts WHERE provider='microsoft'")]
            with microsoft.client() as http:
                for account in accounts:
                    if self.stop_event.is_set():
                        return
                    if not microsoft.has_calendar_read_permissions(account):
                        errors.append({'account_id': account['id'], 'error': 'Calendar access required. Grant server access in Settings → Mail accounts.'})
                        continue
                    try:
                        calendars = discover(http, account, cancel=self.stop_event)
                    except Exception as error:
                        errors.append({'account_id': account['id'], 'error': error_text(error, 'Calendar discovery')})
                        continue
                    for calendar in calendars:
                        if self.stop_event.is_set():
                            return
                        try:
                            cache(http, account, calendar, start, end, cancel=self.stop_event)
                        except Exception as error:
                            text = error_text(error, 'Calendar download')
                            errors.append({'account_id': account['id'], 'calendar_id': calendar['id'], 'error': text})
                            with store.db() as db:
                                db.execute('UPDATE outlook_calendars SET error=? WHERE id=?', (text, calendar['id']))
        finally:
            with self.lock:
                self.state.update(active=False, errors=errors, revision=self.state['revision'] + 1)

    def run(self):
        last_range = None
        while not self.stop_event.is_set():
            with self.lock:
                requested, self.requested = self.requested, None
            now = datetime.now(timezone.utc)
            try:
                last_range = requested or last_range or (now - timedelta(days=35), now + timedelta(days=335))
                self.run_once(*last_range)
            except Exception:
                with self.lock:
                    self.state.update(active=False, errors=[{'error': 'Calendar synchronization failed; cached events are preserved.'}], revision=self.state['revision'] + 1)
            self.wake.wait(300)
            self.wake.clear()

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        self.stop_event.clear()
        self.thread = threading.Thread(target=self.run, name='inkwell-calendar-sync', daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=2)


def error_text(error, operation):
    if isinstance(error, httpx.HTTPStatusError) and error.response.status_code in (401, 403):
        return operation + ' needs Microsoft calendar permission. Grant server access in Mail accounts; shared calendars may require additional consent.'
    return operation + ' failed. Cached calendars and events are retained; retry Sync calendars.'


WORKER = CalendarWorker()


@router.get('')
def listing():
    with store.db() as db:
        calendars = [dict(r) for r in db.execute('SELECT c.*,a.email AS account_email FROM outlook_calendars c JOIN accounts a ON a.id=c.account_id WHERE removed=0 ORDER BY a.id,c.is_default DESC,c.name')]
        accounts = [{'id': r['id'], 'email': r['email'], 'calendar_access': microsoft.has_calendar_read_permissions(r)} for r in db.execute("SELECT * FROM accounts WHERE provider='microsoft'")]
    return {'calendars': calendars, 'accounts': accounts, 'sync': WORKER.status()}


@router.post('/sync')
def sync(data: SyncRange):
    return WORKER.request(data.start, data.end)


class Visibility(BaseModel):
    selected: bool


@router.patch('/{calendar_id}')
def visibility(calendar_id: int, data: Visibility):
    with store.db() as db:
        if not db.execute('UPDATE outlook_calendars SET selected=? WHERE id=? AND removed=0', (data.selected, calendar_id)).rowcount:
            raise HTTPException(404, 'Calendar not found')
    return {'ok': True}
