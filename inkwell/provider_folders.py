"""Durable mailbox counterparts for workspace folder IDs, scoped to each account."""

import json
import threading
from urllib.parse import quote

from fastapi import HTTPException

from . import store

_lock = threading.Lock()


def mapping_key(account_id, folder_id):
    return f"provider_folder:{account_id}:{folder_id}"


def plan(db, account_id, folder_id):
    segments = []
    seen = set()
    key = f"local-{folder_id}"
    while key.startswith("local-"):
        id = int(key[6:])
        if id in seen or len(seen) >= 32:
            raise HTTPException(422, "Invalid folder hierarchy")
        seen.add(id)
        row = db.execute("SELECT * FROM local_folders WHERE id=?", (id,)).fetchone()
        if not row:
            raise HTTPException(422, "Destination folder no longer exists")
        segments.insert(0, {"id": id, "name": row["name"]})
        key = row["parent"]
    if key.startswith("remote:"):
        row = db.execute("SELECT remote_id FROM remote_folders WHERE id=? AND account_id=?",
                         (int(key[7:]), account_id)).fetchone()
        if not row:
            raise HTTPException(422, "Choose a folder in the same server account")
        root = row["remote_id"]
    else:
        root = {"": "msgfolderroot", "trash": "deleteditems", "sent": "sentitems"}.get(key, key)
        if root not in {"msgfolderroot", "inbox", "archive", "deleteditems", "sentitems", "drafts"}:
            raise HTTPException(422, "Invalid folder parent")
    return {"root": root, "segments": segments}


def enqueue(db, folder_id, kind="ensure"):
    from . import provider_sync

    accounts = db.execute("SELECT id FROM accounts WHERE provider='microsoft'").fetchall()
    queued = 0
    for account in accounts:
        account_id = account["id"]
        if kind == "delete":
            row = db.execute("SELECT value FROM settings WHERE key=?", (mapping_key(account_id, folder_id),)).fetchone()
            if not row and not db.execute("SELECT 1 FROM provider_jobs WHERE account_id=? AND resource_type='folder' AND resource_id=?", (account_id, folder_id)).fetchone():
                continue
            payload = {"remote_id": row[0]} if row else {}
        else:
            try:
                payload = {"folder_path": plan(db, account_id, folder_id)}
            except HTTPException:
                # A server-parented branch belongs to exactly one mailbox.
                if db.execute('SELECT 1 FROM settings WHERE key=?', (mapping_key(account_id, folder_id),)).fetchone():
                    raise
                continue
        if not provider_sync.account_ready(db, account_id):
            raise HTTPException(409, "Grant Microsoft mail write access in Settings before changing mailbox folders")
        db.execute("INSERT INTO provider_jobs(account_id,resource_type,resource_id,kind,payload) VALUES (?,'folder',?,?,?)",
                   (account_id, folder_id, kind, json.dumps(payload)))
        queued += 1
    return queued


def resolve(account, tree, graph):
    # Search-before-create and a persistent mapping make retries safe after timeouts.
    with _lock:
        parent = graph(account, "GET", "mailFolders/" + quote(tree["root"], safe="") + "?$select=id")["id"]
        for segment in tree["segments"]:
            key = mapping_key(account["id"], segment["id"])
            with store.db() as db:
                mapping = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            folder = graph(account, "GET", "mailFolders/" + quote(mapping[0], safe="") + "?$select=id,displayName,parentFolderId", missing_ok=True) if mapping else None
            if folder:
                id = folder["id"]
                if folder.get("parentFolderId") != parent:
                    moved = graph(account, "POST", "mailFolders/" + quote(id, safe="") + "/move", payload={"destinationId": parent})
                    if not moved or not moved.get('id'):
                        raise ValueError('Microsoft did not confirm the folder move')
                    id = moved['id']
                if folder.get("displayName") != segment["name"]:
                    graph(account, "PATCH", "mailFolders/" + quote(id, safe=""), payload={"displayName": segment["name"]})
            else:
                escaped = segment["name"].replace("'", "''")
                query = quote("displayName eq '" + escaped + "'", safe="")
                endpoint = "mailFolders/" + quote(parent, safe="") + "/childFolders"
                matches = graph(account, "GET", endpoint + "?$filter=" + query + "&$select=id,displayName").get("value", [])
                if len(matches) > 1:
                    raise ValueError("Ambiguous server folder name; resolve duplicate folders in Outlook")
                folder = matches[0] if matches else graph(account, "POST", endpoint, payload={"displayName": segment["name"]})
                if not folder or not folder.get("id"):
                    raise ValueError("Microsoft did not return the destination folder ID")
                id = folder["id"]
            with store.db() as db:
                if not db.execute("SELECT 1 FROM accounts WHERE id=? AND email=? AND provider='microsoft'", (account['id'], account['email'])).fetchone():
                    raise ValueError('Account disconnected while synchronizing folders')
                db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", (key, id))
            parent = id
        return parent
