import json

import httpx
import pytest

from inkwell import provider_folders, provider_sync, rules, store
from inkwell.app import MessagePatch, patch_message
from test_provider_sync import ready, jobs, outlook_message  # noqa: F401


def drain():
    while job := provider_sync.claim():
        provider_sync.run_job(job)


def test_selected_rule_provisions_nested_mailbox_destination_and_reuses_it_after_timeout(ready, monkeypatch):
    with store.db() as db:
        parent = db.execute("INSERT INTO local_folders(name,parent) VALUES ('Inbox child','inbox')").lastrowid
        child = db.execute("INSERT INTO local_folders(name,parent) VALUES ('Reader''s mail',?)", (f'local-{parent}',)).lastrowid
    message = outlook_message(ready, 'immutable')
    selected = rules.create(rules.Rule(name='Move matched mail', conditions=[rules.Condition(field='subject', operator='is', value='Hello')], actions=[rules.Action(type='move', value=f'local-{child}')]))['id']
    result = rules.run_rules(rules.RunRules(rule_id=selected))
    assert result['matched'] == 1
    created = []
    folders = {}
    message_parent = ['inbox-id']
    lost = [True]

    def graph(account, method, path, *, payload=None, missing_ok=False):
        assert account['id'] == ready
        if path == 'mailFolders/inbox?$select=id':
            return {'id': 'inbox-id'}
        if path.startswith('mailFolders/'):
            id = path.split('/')[1].split('?')[0]
            if '/childFolders' in path:
                if method == 'GET':
                    return {'value': []}
                created.append(payload['displayName'])
                new_id = f'folder-{len(created)}'
                folders[new_id] = {'id': new_id, 'displayName': payload['displayName'], 'parentFolderId': id}
                return folders[new_id]
            return folders.get(id)
        if method == 'GET':
            return {'id': 'immutable', 'parentFolderId': message_parent[0]}
        assert path == 'messages/immutable/move'
        message_parent[0] = payload['destinationId']
        if lost[0]:
            lost[0] = False
            raise httpx.ReadTimeout('Move response lost')
        return {'id': 'immutable'}

    monkeypatch.setattr(provider_sync, 'graph', graph)
    provider_sync.run_job(provider_sync.claim())
    assert jobs()[0]['state'] == 'pending'
    with store.db() as db:
        db.execute('UPDATE provider_jobs SET next_run=0')
    drain()
    assert jobs()[0]['state'] == 'done'
    assert created == ['Inbox child', "Reader's mail"]
    assert message_parent[0] == 'folder-2'
    with store.db() as db:
        assert db.execute('SELECT value FROM settings WHERE key=?', (provider_folders.mapping_key(ready, child),)).fetchone()[0] == 'folder-2'


def test_tag_changes_preserve_unrelated_outlook_categories_and_are_queued_atomically(ready, monkeypatch):
    message = outlook_message(ready)
    result = patch_message(message, MessagePatch(tags=['Work']))
    assert result['provider_queued'] == 1
    sent = []
    def graph(account, method, path, *, payload=None, missing_ok=False):
        if method == 'GET':
            return {'id': 'mail-id', 'categories': ['Existing Outlook category']}
        sent.append(payload)
    monkeypatch.setattr(provider_sync, 'graph', graph)
    drain()
    assert sent == [{'categories': ['Existing Outlook category', 'Work']}]
    assert jobs()[0]['state'] == 'done'


def test_failed_folder_creation_retries_without_moving_message_to_wrong_server_folder(ready, monkeypatch):
    with store.db() as db:
        folder = db.execute("INSERT INTO local_folders(name) VALUES ('Mail destination')").lastrowid
    message = outlook_message(ready)
    patch_message(message, MessagePatch(folder=f'local-{folder}'))
    def offline(*args, **kwargs):
        raise httpx.ConnectError('offline')
    monkeypatch.setattr(provider_sync, 'graph', offline)
    drain()
    assert jobs()[0]['state'] == 'pending'
    assert jobs()[0]['attempts'] == 1
    assert json.loads(jobs()[0]['payload'])['folder_path']['segments'][0]['name'] == 'Mail destination'


def test_old_opt_out_is_retired_on_startup_without_replaying_history(ready):
    with store.db() as db:
        db.execute("UPDATE settings SET value='true' WHERE key='provider_sync_local_only'")
    store.init()
    assert not provider_sync.status()['local_changes_only']
    assert not jobs()
    with store.db() as db:
        assert db.execute("SELECT value FROM settings WHERE key='provider_sync_local_only'").fetchone()[0] == 'false'
    with pytest.raises(Exception, match='always enabled'):
        provider_sync.set_mode(provider_sync.Mode(local_changes_only=True))


def test_folder_move_updates_mapping_when_graph_changes_the_folder_id(ready, monkeypatch):
    with store.db() as db:
        folder = db.execute("INSERT INTO local_folders(name,parent) VALUES ('Renamed','archive')").lastrowid
        db.execute('INSERT INTO settings(key,value) VALUES (?,?)', (provider_folders.mapping_key(ready, folder), 'old-folder'))
        tree = provider_folders.plan(db, ready, folder)
        account = dict(db.execute('SELECT * FROM accounts WHERE id=?', (ready,)).fetchone())
    calls = []
    def graph(account, method, path, *, payload=None, missing_ok=False):
        calls.append((method, path, payload))
        if path == 'mailFolders/archive?$select=id':
            return {'id': 'archive-id'}
        if method == 'GET':
            return {'id': 'old-folder', 'displayName': 'Old name', 'parentFolderId': 'inbox-id'}
        if path.endswith('/move'):
            return {'id': 'moved-folder'}
    assert provider_folders.resolve(account, tree, graph) == 'moved-folder'
    assert ('PATCH', 'mailFolders/moved-folder', {'displayName': 'Renamed'}) in calls
    with store.db() as db:
        assert db.execute('SELECT value FROM settings WHERE key=?', (provider_folders.mapping_key(ready, folder),)).fetchone()[0] == 'moved-folder'


def test_server_folder_deletion_refuses_uncached_contents(ready, monkeypatch):
    with store.db() as db:
        folder = db.execute("INSERT INTO local_folders(name) VALUES ('Has server mail')").lastrowid
        db.execute('INSERT INTO settings(key,value) VALUES (?,?)', (provider_folders.mapping_key(ready, folder), 'server-folder'))
    rules.delete_folder(folder)
    def graph(account, method, path, *, payload=None, missing_ok=False):
        assert method == 'GET'
        return {'id': 'server-folder', 'totalItemCount': 1, 'childFolderCount': 0}
    monkeypatch.setattr(provider_sync, 'graph', graph)
    drain()
    assert jobs()[0]['state'] == 'failed'
    assert 'not empty' in jobs()[0]['error']


def test_new_folder_is_queued_on_server_and_removal_waits_for_its_creation(ready, monkeypatch):
    folder = rules.add_folder(rules.Folder(name='New mail folder'))
    assert folder['provider_queued'] == 1
    rules.delete_folder(folder['id'])
    assert [j['kind'] for j in jobs()] == ['ensure', 'delete']
    calls = []
    def graph(account, method, path, *, payload=None, missing_ok=False):
        calls.append((method, path))
        if path == 'mailFolders/msgfolderroot?$select=id':
            return {'id': 'root'}
        if '/childFolders' in path:
            return {'value': []} if method == 'GET' else {'id': 'new-folder'}
        if method == 'GET':
            return {'id': 'new-folder', 'totalItemCount': 0, 'childFolderCount': 0}
    monkeypatch.setattr(provider_sync, 'graph', graph)
    drain()
    assert all(j['state'] == 'done' for j in jobs())
    assert ('DELETE', 'mailFolders/new-folder') in calls
