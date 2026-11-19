"""Read-only Microsoft folder discovery. Message import is bounded and on demand."""

from urllib.parse import quote, urlparse

from . import microsoft, store


def safe_next(url):
    parsed = urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "graph.microsoft.com"
        or not parsed.path.startswith("/v1.0/me/")
        or parsed.fragment
    ):
        raise ValueError("Unexpected Graph pagination URL")
    return url


def discover(account):
    headers = {"Authorization": "Bearer " + microsoft.access_token(account)}
    found = {}
    requests = 1  # Includes the initial Inbox identity lookup.
    with microsoft.client() as http:
        response = http.get(microsoft.GRAPH + "/me/mailFolders/inbox?$select=id", headers=headers)
        response.raise_for_status()
        inbox_id = response.json()["id"]
        pending = [("", "", microsoft.GRAPH + "/me/mailFolders?$top=100")]
        while pending:
            parent, prefix, url = pending.pop()
            while url:
                requests += 1
                if requests > 500:
                    raise ValueError("Folder discovery exceeded its request limit")
                response = http.get(safe_next(url), headers=headers)
                response.raise_for_status()
                data = response.json()
                for item in data["value"]:
                    remote_id = item["id"]
                    if remote_id in found:
                        continue
                    name = item.get("displayName") or "Unnamed folder"
                    path = prefix + name
                    found[remote_id] = (
                        parent,
                        name,
                        path,
                        "inbox" if remote_id == inbox_id else "",
                        int(item.get("totalItemCount", 0)),
                        int(item.get("unreadItemCount", 0)),
                    )
                    if item.get("childFolderCount", 0):
                        pending.append(
                            (
                                remote_id,
                                path + " / ",
                                microsoft.GRAPH
                                + "/me/mailFolders/"
                                + quote(remote_id, safe="")
                                + "/childFolders?$top=100",
                            )
                        )
                url = data.get("@odata.nextLink")
        # Resolve roles by provider IDs, not localized display names. These are GET-only.
        for role in ("junkemail", "deleteditems", "sentitems", "drafts", "archive"):
            requests += 1
            if requests > 500:
                raise ValueError("Folder discovery exceeded its request limit")
            response = http.get(
                microsoft.GRAPH + "/me/mailFolders/" + role + "?$select=id", headers=headers
            )
            if response.status_code == 404:
                continue
            response.raise_for_status()
            remote_id = response.json()["id"]
            if remote_id in found:
                parent, name, path, _, total, unread = found[remote_id]
                found[remote_id] = (parent, name, path, role, total, unread)
    # Publish only a complete snapshot. Keep cached mail when folders disappear.
    with store.db() as db:
        db.execute("BEGIN IMMEDIATE")
        if not db.execute(
            "SELECT 1 FROM accounts WHERE id=? AND email=? AND provider='microsoft'",
            (account["id"], account["email"]),
        ).fetchone():
            raise ValueError("Account disconnected")
        for remote_id, values in found.items():
            db.execute(
                """INSERT INTO remote_folders(account_id,remote_id,parent_remote_id,name,path,well_known,total_count,unread_count)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(account_id,remote_id) DO UPDATE SET
                parent_remote_id=excluded.parent_remote_id,name=excluded.name,path=excluded.path,
                well_known=excluded.well_known,total_count=excluded.total_count,unread_count=excluded.unread_count""",
                (account["id"], remote_id, *values),
            )
        for row in db.execute(
            "SELECT id,remote_id FROM remote_folders WHERE account_id=?", (account["id"],)
        ).fetchall():
            if row["remote_id"] not in found:
                db.execute(
                    """UPDATE messages SET
                    folder=CASE WHEN local_destination_id=? OR (remote_folder_id=? AND local_folder_override=0 AND folder='remote') THEN 'inbox' ELSE folder END,
                    local_destination_id=CASE WHEN local_destination_id=? THEN NULL ELSE local_destination_id END,
                    remote_folder_id=CASE WHEN remote_folder_id=? THEN NULL ELSE remote_folder_id END
                    WHERE remote_folder_id=? OR local_destination_id=?""",
                    (row["id"],) * 6,
                )
                db.execute("DELETE FROM remote_folders WHERE id=?", (row["id"],))
        inbox = db.execute(
            "SELECT id FROM remote_folders WHERE account_id=? AND well_known='inbox'",
            (account["id"],),
        ).fetchone()
        if inbox:
            db.execute(
                "UPDATE messages SET remote_folder_id=? WHERE account_id=? AND folder='inbox' AND remote_folder_id IS NULL AND remote_key LIKE ?",
                (inbox["id"], account["id"], str(account["id"]) + ":graph:%"),
            )
    return len(found)
