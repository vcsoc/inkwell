"""One bounded, read-only mailbox worker shared by every client."""

import threading
import time
from . import store, microsoft, mail, remote_folders


class BackgroundSync:
    def __init__(self, sync_lock):
        self.sync_lock = sync_lock
        self.lock = threading.Lock()
        self.cancel = threading.Event()
        self.thread = None
        self.completed = set()
        self.state = {
            "id": 0,
            "active": False,
            "total": 0,
            "done": 0,
            "added": 0,
            "errors": [],
            "current": "",
            "revision": 0,
        }

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
                return {**self.state, "errors": list(self.state["errors"])}
            if not self.sync_lock.acquire(blocking=False):
                from fastapi import HTTPException

                raise HTTPException(409, "Sync is already running; retry shortly.")
            self.cancel.clear()
            if full:
                self.completed.clear()
            self.state = {
                "id": self.state["id"] + 1,
                "active": True,
                "total": 0,
                "done": 0,
                "added": 0,
                "errors": [],
                "current": "Discovering folders",
                "revision": 0,
            }
            self.thread = threading.Thread(target=self.run, name="inkwell-mail-sync", daemon=True)
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
                self.state["errors"].append({"name": name, "error": text})
            self.state["revision"] += 1

    def page(self, added):
        if self.cancel.is_set():
            raise InterruptedError("Sync stopped")
        with self.lock:
            self.state["added"] += added
            self.state["revision"] += 1

    def run(self):
        try:
            with store.db() as db:
                accounts = [dict(r) for r in db.execute("SELECT * FROM accounts")]
            tasks = []
            for account in accounts:
                if self.cancel.is_set():
                    return
                if account["provider"] == "microsoft":
                    try:
                        remote_folders.discover(account)
                    except Exception:
                        self.failure(
                            "Folder discovery",
                            "Discovery failed; cached folders were preserved and will still be checked.",
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
                    if not any(f["well_known"] == "inbox" for f in folders):
                        tasks.append((account, None))
                else:
                    tasks.append((account, None))
            self.update(total=len(tasks))
            for account, folder in tasks:
                if self.cancel.is_set():
                    return
                name = folder["path"] if folder else "Inbox"
                self.update(current=name)
                try:
                    with store.db() as db:
                        current = db.execute(
                            "SELECT * FROM accounts WHERE id=?", (account["id"],)
                        ).fetchone()
                        if (
                            not current
                            or current["email"] != account["email"]
                            or current["provider"] != account["provider"]
                        ):
                            continue
                        account = dict(current)
                        if (
                            folder
                            and not db.execute(
                                "SELECT 1 FROM remote_folders WHERE id=? AND account_id=? AND remote_id=?",
                                (folder["id"], account["id"], folder["remote_id"]),
                            ).fetchone()
                        ):
                            continue
                    if account["provider"] == "microsoft":
                        key = (
                            account["id"],
                            account["email"],
                            folder["remote_id"] if folder else "inbox",
                        )
                        microsoft.sync_account(
                            account,
                            folder,
                            max_pages=2 if key in self.completed else 5000,
                            on_page=self.page,
                            cancel=self.cancel,
                        )
                        self.completed.add(key)
                    else:
                        self.page(mail.sync_account(account))
                except InterruptedError:
                    return
                except Exception:
                    self.failure(
                        name,
                        "Sync failed or reached its safety limit; cached mail was preserved. Retry with F9.",
                    )
                finally:
                    self.update(done=self.status()["done"] + 1)
        except Exception:
            self.failure("Sync", "Background sync failed; cached mail was preserved.")
        finally:
            self.update(active=False, current="", finished=time.time())
            self.sync_lock.release()

    def stop(self):
        self.cancel.set()
        if self.thread:
            self.thread.join(timeout=2)
