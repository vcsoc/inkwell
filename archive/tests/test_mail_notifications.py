from datetime import datetime, timedelta, timezone

from inkwell import store


def insert(db, sender, date, folder='inbox', remote_key='new-1'):
    return db.execute(
        "INSERT INTO messages(sender,recipient,subject,body,date,folder,remote_key) VALUES (?,?,?,?,?,?,?)",
        (sender, 'recipient@example.org', 'Hello', '', date, folder, remote_key),
    ).lastrowid


def test_sound_settings_validate_and_candidates_exclude_old_and_outgoing(client):
    url = '/api/mail-notifications'
    assert client.get(url).json()['enabled'] is False
    payload = {'enabled': True, 'scope': 'senders', 'senders': ['friend@example.org']}
    assert client.put(url, json=payload).json() == payload
    assert client.get(url).json()['scope'] == 'senders'
    for bad in [
        {**payload, 'scope': 'invalid'},
        {**payload, 'senders': ['friend@example.org', 'friend@example.org']},
        {**payload, 'senders': ['not-an-address']},
        {**payload, 'senders': ['friend@example.org'], 'script': '<script>'},
    ]:
        assert client.put(url, json=bad).status_code == 422
    with store.db() as db:
        baseline = db.execute('SELECT coalesce(max(id),0) FROM messages').fetchone()[0]
        new = insert(db, 'Friend <friend@example.org>', datetime.now(timezone.utc).isoformat())
        insert(db, 'old@example.org', (datetime.now(timezone.utc) - timedelta(days=4)).isoformat(), remote_key='old')
        insert(db, 'draft@example.org', datetime.now(timezone.utc).isoformat(), folder='drafts', remote_key='draft')
    result = client.get(url + '/candidates', params={'after_id': baseline}).json()
    assert result['latest_id'] >= new
    assert result['messages'] == [{'sender': 'friend@example.org', 'folders': ['inbox']}]
    assert client.get(url + '/candidates', params={'after_id': result['latest_id']}).json()['messages'] == []
    assert client.get(url + '/candidates', params={'after_id': 2**63}).status_code == 422


def test_uploaded_sound_is_private_and_can_be_reset(client):
    url = '/api/mail-notifications/sound'
    wave = b'RIFF' + b'\x00' * 4 + b'WAVE' + b'\x00' * 40
    assert client.put(url + '?format=wav', content=wave).status_code == 200
    assert client.get(url).content == wave
    assert client.get('/api/mail-notifications').json()['custom_sound'] is True
    assert client.put(url + '?format=wav', content=b'<script>bad</script>').status_code == 422
    assert client.put(url + '?format=mp3', content=b'ID3' + b'\x00' * 40).status_code == 200
    assert client.get(url).headers['content-type'].startswith('audio/mpeg')
    assert client.delete(url).status_code == 200
    assert client.get(url).status_code == 404
    assert client.get('/api/mail-notifications').json()['custom_sound'] is False


def test_sound_library_preserves_choices_and_previews_default(client):
    url = '/api/mail-notifications/sounds'
    wave = b'RIFF' + b'\x00' * 4 + b'WAVE' + b'\x00' * 40
    assert client.get(url).status_code == 200
    assert client.get(url + '/default/preview').content.startswith(b'RIFF')
    first = client.post(url + '?format=wav&name=First.wav', content=wave).json()['id']
    second = client.post(url + '?format=mp3&name=Second.mp3', content=b'ID3' + b'\x00' * 40).json()['id']
    assert client.get(url).json()[-1]['active'] is True
    assert client.get(url + '/' + first + '/preview').content == wave
    assert client.put(url + '/' + first + '/activate').status_code == 200
    assert client.get('/api/mail-notifications/sound').content == wave
    assert client.put(url + '/default/activate').status_code == 200
    assert client.get('/api/mail-notifications').json()['custom_sound'] is False
    assert len(client.get(url).json()) == 3
    assert client.delete(url + '/' + second).status_code == 200
    assert client.get(url + '/' + second + '/preview').status_code == 404
    assert client.put(url + '/not-valid/activate').status_code == 404
    assert client.post(url + '?format=wav&name=invalid', content=b'bad').status_code == 422
