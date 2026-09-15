"""Resumable round-robin Graph delta downloads, with live checks during backfill."""

import threading
import hashlib
import time
from collections import deque
from contextlib import ExitStack
from email.utils import parsedate_to_datetime
import httpx
from . import store, microsoft, mail, remote_folders


class CheckpointLoop(ValueError):
    pass


class BackgroundSync:
    def __init__(self, sync_lock):
        self.sync_lock = sync_lock
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.discovered = 0
        self.retry_until = 0
        self.state = self.empty(0, False)

    @staticmethod
    def empty(id, active):
        return dict(
            id=id,
            active=active,
            total=0,
            done=0,
            added=0,
            errors=[],
            current="",
            revision=0,
            pending=0,
        )

    def status(self):
        with self.lock:
            return {**self.state, "errors": [dict(e) for e in self.state["errors"]]}

    def update(self, **values):
        with self.lock:
            self.state.update(values)
            self.state["revision"] += 1

    def start(self, full=False):
        with self.lock:
            if self.state["active"]:
                if full:
                    self.wake.set()
                return {**self.state, "errors": list(self.state["errors"])}
            if time.monotonic() < self.retry_until:
                return {**self.state, "errors": list(self.state["errors"])}
            if not self.sync_lock.acquire(blocking=False):
                from fastapi import HTTPException

                raise HTTPException(409, "Sync is already running; retry shortly.")
            self.cancel.clear()
            self.wake.clear()
            self.state = self.empty(self.state["id"] + 1, True)
            self.thread = threading.Thread(
                target=self.run, args=(full,), name="inkwell-mail-sync", daemon=True
            )
            try:
                self.thread.start()
            except Exception:
                self.state["active"] = False
                self.sync_lock.release()
                raise
            return {**self.state, "errors": []}

    def failure(self, name, text):
        with self.lock:
            if len(self.state["errors"]) < 100:
                self.state["errors"].append(dict(name=name, error=text))
            self.state["revision"] += 1

    def page(self, added):
        if self.cancel.is_set():
            raise InterruptedError("Sync stopped")
        with self.lock:
            self.state["added"] += added
            self.state["revision"] += 1

    def current(self, account, folder):
        with store.db() as db:
            found = db.execute(
                "SELECT * FROM accounts WHERE id=? AND email=? AND provider=?",
                (account["id"], account["email"], account["provider"]),
            ).fetchone()
            if not found:
                raise InterruptedError("Account disconnected")
            if (
                folder
                and not db.execute(
                    "SELECT 1 FROM remote_folders WHERE id=? AND account_id=? AND remote_id=?",
                    (folder["id"], account["id"], folder["remote_id"]),
                ).fetchone()
            ):
                raise InterruptedError("Folder removed")
            return dict(found)

    def cursor(self, folder):
        with store.db() as db:
            row = db.execute(
                "SELECT * FROM mail_sync_state WHERE folder_id=?", (folder["id"],)
            ).fetchone()
            return dict(row) if row else {"next_url": None, "delta_url": None}

    def pull(self, account, folder):
        saved = self.cursor(folder)
        following = []

        def checkpoint(next_url, delta_url):
            if not next_url and not delta_url:
                raise ValueError("Missing Graph checkpoint")
            if next_url and next_url in (saved["next_url"], saved["delta_url"]):
                raise CheckpointLoop("Repeated Graph checkpoint")
            with store.db() as db:
                db.execute("BEGIN IMMEDIATE")
                if not db.execute(
                    "SELECT 1 FROM remote_folders WHERE id=? AND account_id=? AND remote_id=?",
                    (folder["id"], account["id"], folder["remote_id"]),
                ).fetchone():
                    raise InterruptedError("Folder removed")
                if next_url:
                    digest = hashlib.sha256(next_url.encode()).hexdigest()
                    if not db.execute(
                        "INSERT OR IGNORE INTO mail_sync_pages(folder_id,digest) VALUES (?,?)",
                        (folder["id"], digest),
                    ).rowcount:
                        raise CheckpointLoop("Repeated Graph checkpoint")
                else:
                    db.execute("DELETE FROM mail_sync_pages WHERE folder_id=?", (folder["id"],))
                db.execute(
                    """INSERT INTO mail_sync_state(folder_id,next_url,delta_url,updated)
                  SELECT id,?,?,CURRENT_TIMESTAMP FROM remote_folders WHERE id=? AND account_id=? AND remote_id=?
                  ON CONFLICT(folder_id) DO UPDATE SET next_url=excluded.next_url,delta_url=coalesce(excluded.delta_url,mail_sync_state.delta_url),updated=excluded.updated""",
                    (next_url, delta_url, folder["id"], account["id"], folder["remote_id"]),
                )
            following.append(next_url)

        microsoft.sync_account(
            account,
            folder,
            max_pages=1,
            delta=True,
            start_url=saved["next_url"] or saved["delta_url"],
            on_page=self.page,
            on_cursor=checkpoint,
            cancel=self.cancel,
            http_client=self.http,
        )
        if not following:
            raise ValueError("Missing Graph checkpoint")
        return bool(following[-1])

    def run(self, full=False):
        resources = ExitStack()
        try:
            self.http = resources.enter_context(microsoft.client())
            with store.db() as db:
                accounts = [dict(r) for r in db.execute("SELECT * FROM accounts")]
            tasks = []
            imap = []
            discover = full or time.monotonic() - self.discovered >= 60
            for account in accounts:
                if self.cancel.is_set():
                    return
                if account["provider"] != "microsoft":
                    imap.append(account)
                    continue
                with store.db() as db:
                    has_folders = db.execute(
                        "SELECT 1 FROM remote_folders WHERE account_id=?", (account["id"],)
                    ).fetchone()
                    if full:
                        db.execute(
                            "UPDATE mail_sync_state SET delta_url=NULL WHERE next_url IS NULL AND folder_id IN (SELECT id FROM remote_folders WHERE account_id=?)",
                            (account["id"],),
                        )
                if discover or not has_folders:
                    self.update(current="Discovering folders")
                    try:
                        remote_folders.discover(account)
                    except Exception:
                        self.failure(
                            "Folder discovery",
                            "Discovery failed; the cached tree is retained and will still be checked.",
                        )
                with store.db() as db:
                    folders = [
                        dict(r)
                        for r in db.execute(
                            "SELECT * FROM remote_folders WHERE account_id=? ORDER BY CASE WHEN well_known='inbox' THEN 0 ELSE 1 END,path",
                            (account["id"],),
                        )
                    ]
                tasks.extend((account, f) for f in folders)
                if not folders:
                    self.failure("Folders", "No cached Outlook folders; retry discovery with F9.")
            if discover:
                self.discovered = time.monotonic()
            self.update(total=len(tasks) + len(imap))
            finished = set()
            queue = deque(tasks)
            queued = {f["id"] for _, f in tasks}
            last_live = 0
            # Bound one job's work, not mailbox history. Remaining cursors resume next pass.
            for _ in range(128):
                if self.cancel.is_set():
                    return
                if not queue:
                    break
                if self.wake.is_set() or time.monotonic() - last_live >= 15:
                    self.wake.clear()
                    for a, f in tasks:
                        if self.cancel.is_set():
                            return
                        if (
                            f["id"] in queued
                            and self.cursor(f)["next_url"]
                            and not self.cursor(f)["delta_url"]
                        ):
                            try:
                                self.update(current="New mail · " + f["path"])
                                microsoft.sync_account(
                                    self.current(a, f),
                                    f,
                                    max_pages=2,
                                    on_page=self.page,
                                    cancel=self.cancel,
                                    stop_when_known=True,
                                    http_client=self.http,
                                )
                            except InterruptedError:
                                if self.cancel.is_set():
                                    return
                            except Exception:
                                self.failure(
                                    f["path"], "Recent-mail check failed; cached mail is preserved."
                                )
                        elif f["id"] not in queued:
                            queue.append((a, f))
                            queued.add(f["id"])
                    last_live = time.monotonic()
                account, folder = queue.popleft()
                queued.discard(folder["id"])
                self.update(current=folder["path"])
                try:
                    more = self.pull(self.current(account, folder), folder)
                    if more:
                        queue.append((account, folder))
                        queued.add(folder["id"])
                    else:
                        finished.add(folder["id"])
                except InterruptedError:
                    if self.cancel.is_set():
                        return
                    finished.add(folder["id"])
                except CheckpointLoop:
                    with store.db() as db:
                        db.execute("DELETE FROM mail_sync_state WHERE folder_id=?", (folder["id"],))
                        db.execute("DELETE FROM mail_sync_pages WHERE folder_id=?", (folder["id"],))
                    self.failure(
                        folder["path"],
                        "Repeated pagination stopped; a fresh scan will retry without deleting cached mail.",
                    )
                    finished.add(folder["id"])
                except httpx.HTTPStatusError as error:
                    if error.response.status_code in (429, 503):
                        value = error.response.headers.get("Retry-After", "60")
                        try:
                            delay = int(value)
                        except ValueError:
                            try:
                                delay = parsedate_to_datetime(value).timestamp() - time.time()
                            except (TypeError, ValueError, OverflowError):
                                delay = 60
                        delay = max(1, min(86400, delay))
                        self.retry_until = time.monotonic() + delay
                        self.failure(
                            folder["path"],
                            "Microsoft requested a pause; automatic checks will resume after the retry delay.",
                        )
                        self.update(pending=len(queue) + 1, retry_at=time.time() + delay)
                        break
                    if error.response.status_code == 410:
                        with store.db() as db:
                            db.execute(
                                "DELETE FROM mail_sync_state WHERE folder_id=?", (folder["id"],)
                            )
                            db.execute(
                                "DELETE FROM mail_sync_pages WHERE folder_id=?", (folder["id"],)
                            )
                    self.failure(
                        folder["path"],
                        "Sync failed; saved pages are retained and will retry automatically. F9 also retries.",
                    )
                    finished.add(folder["id"])
                except Exception:
                    self.failure(
                        folder["path"],
                        "Sync failed; saved pages are retained and will retry automatically. F9 also retries.",
                    )
                    finished.add(folder["id"])
                self.update(done=len(finished), pending=len(queue))
            for account in imap:
                if self.cancel.is_set():
                    return
                self.update(current="IMAP Inbox")
                try:
                    self.page(mail.sync_account(self.current(account, None)))
                except Exception:
                    self.failure("IMAP Inbox", "Inbox sync failed; cached mail is preserved.")
                self.update(done=self.status()["done"] + 1)
        except Exception:
            self.failure("Sync", "Background sync failed; cached mail is preserved.")
        finally:
            try:
                resources.close()
            finally:
                self.update(active=False, current="", finished=time.time())
                self.sync_lock.release()

    def stop(self):
        self.cancel.set()
        if self.thread:
            self.thread.join(timeout=2)
