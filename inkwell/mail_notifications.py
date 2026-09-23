"""Local, opt-in arrival sound preferences and bounded sync-batch candidates."""

import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import store
from .message_keys import sender_key
from .not_junk import incoming

router = APIRouter(prefix='/api/mail-notifications')
MAX_SOUND = 2_000_000


def sound_path():
    return store.DATA / 'new-mail-sound'


class NotificationSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool = False
    scope: Literal['all', 'pinned', 'senders'] = 'all'
    senders: list[str] = Field(default_factory=list, max_length=500)

    @field_validator('senders')
    @classmethod
    def valid_senders(cls, values):
        keys = [sender_key(v) for v in values]
        if len(set(keys)) != len(keys) or any(
            not key or '@' not in key or len(key) > 254 or key != v or any(ord(c) < 32 for c in key)
            for key, v in zip(keys, values)
        ):
            raise ValueError('Choose distinct, normalized sender addresses')
        return keys


def settings():
    return NotificationSettings.model_validate(json.loads(store.setting('mail_notifications', '{}')))


@router.get('')
def get_settings():
    result = settings().model_dump()
    result['custom_sound'] = sound_path().exists()
    with store.db() as db:
        result['latest_id'] = db.execute('SELECT coalesce(max(id),0) FROM messages').fetchone()[0]
    return result


@router.put('')
def save_settings(data: NotificationSettings):
    store.set_setting('mail_notifications', data.model_dump_json())
    return data.model_dump()


@router.get('/candidates')
def candidates(after_id: int = 0):
    if after_id < 0 or after_id >= 2**63:
        raise HTTPException(422, 'Invalid message cursor')
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    with store.db() as db:
        db.execute('BEGIN')
        latest = db.execute('SELECT coalesce(max(id),0) FROM messages').fetchone()[0]
        results = []
        for message in db.execute(
            "SELECT * FROM messages WHERE id>? AND id<=? AND remote_key IS NOT NULL ORDER BY id",
            (after_id, latest),
        ):
            if not incoming(db, message):
                continue
            try:
                date = datetime.fromisoformat(message['date'])
                if not date.tzinfo or date < cutoff:
                    continue  # Old history downloaded during a backfill is not a new arrival.
            except ValueError:
                continue
            folder = message['folder']
            folders = [folder] if folder != 'remote' else []
            if folder in ('inbox', 'remote'):
                destination = message['local_destination_id'] if message['local_folder_override'] else message['remote_folder_id']
                if destination:
                    folders.append('remote:' + str(destination))
            results.append({'sender': message['sender_key'], 'folders': folders})
        return {'latest_id': latest, 'messages': results}


@router.put('/sound')
async def upload_sound(request: Request, format: Literal['wav', 'mp3']):
    if request.headers.get('content-length') and int(request.headers['content-length']) > MAX_SOUND:
        raise HTTPException(413, 'Sound must be smaller than 2 MB')
    data = await request.body()
    if not data or len(data) > MAX_SOUND:
        raise HTTPException(413, 'Sound must be smaller than 2 MB')
    if format == 'wav':
        valid = len(data) > 44 and data[:4] == b'RIFF' and data[8:12] == b'WAVE'
    else:
        valid = data.startswith(b'ID3') or bool(re.match(rb'\xff[\xe0-\xff]', data[:2]))
    if not valid:
        raise HTTPException(422, 'Choose a valid WAV or MP3 file')
    sound = sound_path()
    sound.parent.mkdir(parents=True, exist_ok=True)
    temp = sound.with_name(sound.name + '.tmp')
    try:
        with open(temp, 'wb') as output:
            os.chmod(temp, 0o600)
            output.write(format.encode('ascii') + b'\n' + data)
        temp.replace(sound)
    finally:
        temp.unlink(missing_ok=True)
    return {'ok': True}


@router.get('/sound')
def download_sound():
    try:
        format, data = sound_path().read_bytes().split(b'\n', 1)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, 'No custom sound')
    return Response(data, media_type='audio/wav' if format == b'wav' else 'audio/mpeg', headers={'Cache-Control': 'no-store'})


@router.delete('/sound')
def reset_sound():
    sound_path().unlink(missing_ok=True)
    return {'ok': True}
