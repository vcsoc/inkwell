"""SQLite storage and local credential encryption. No cloud storage or telemetry."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from cryptography.fernet import Fernet

from .message_keys import sender_key, domain_key, subject_key
from .mail_search import key as search_key

DATA = Path(os.environ.get("INKWELL_DATA_DIR", Path.home() / ".inkwell"))


def init():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    keyfile = DATA / "vault.key"
    try:
        fd = os.open(keyfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        pass
    else:
        with os.fdopen(fd, "wb") as f:
            f.write(Fernet.generate_key())
    with db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS accounts(
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
            imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL,
            smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL,
            username TEXT NOT NULL, secret TEXT NOT NULL, smtp_security TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS messages(
            id INTEGER PRIMARY KEY, account_id INTEGER, remote_key TEXT UNIQUE,
            folder TEXT NOT NULL DEFAULT 'inbox', sender TEXT NOT NULL,
            recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
            date TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 1,
            starred INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS message_folder_date ON messages(folder,date DESC);
        CREATE TABLE IF NOT EXISTS events(
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, start TEXT NOT NULL,
            end TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS contacts(
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
            company TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
        """)
        # Version 1: preserve password accounts while adding Microsoft OAuth metadata.
        conn.execute("BEGIN IMMEDIATE")
        version = conn.execute("PRAGMA user_version").fetchone()[0]
        if version > 12:
            raise RuntimeError("This database was created by a newer inkwell version")
        if version < 1:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(accounts)")}
            if "provider" not in columns:
                conn.execute(
                    "ALTER TABLE accounts ADD COLUMN provider TEXT NOT NULL DEFAULT 'imap'"
                )
            if "client_id" not in columns:
                conn.execute("ALTER TABLE accounts ADD COLUMN client_id TEXT NOT NULL DEFAULT ''")
            conn.execute("PRAGMA user_version=1")
        if version < 2:
            columns = {row[1] for row in conn.execute("PRAGMA table_info(messages)")}
            for key in ("sender_key", "domain_key", "subject_key"):
                if key not in columns:
                    conn.execute(f"ALTER TABLE messages ADD COLUMN {key} TEXT NOT NULL DEFAULT ''")
            conn.execute(
                "UPDATE messages SET sender_key=inkwell_sender_key(sender), domain_key=inkwell_domain_key(sender), subject_key=inkwell_subject_key(subject)"
            )
            for key in ("sender_key", "domain_key", "subject_key"):
                conn.execute(
                    f"CREATE INDEX IF NOT EXISTS message_{key}_date ON messages({key},date DESC,id DESC)"
                )
            for name, event in [("insert", "INSERT"), ("update", "UPDATE OF sender,subject")]:
                conn.execute(f"""CREATE TRIGGER IF NOT EXISTS message_collections_{name} AFTER {event} ON messages BEGIN
                    UPDATE messages SET sender_key=inkwell_sender_key(NEW.sender), domain_key=inkwell_domain_key(NEW.sender), subject_key=inkwell_subject_key(NEW.subject) WHERE id=NEW.id;
                    END""")
            conn.execute("PRAGMA user_version=2")
        if version < 3:
            conn.execute("""CREATE TABLE remote_folders(
                id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL,
                remote_id TEXT NOT NULL, parent_remote_id TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL, path TEXT NOT NULL, well_known TEXT NOT NULL DEFAULT '',
                total_count INTEGER NOT NULL DEFAULT 0, unread_count INTEGER NOT NULL DEFAULT 0,
                UNIQUE(account_id,remote_id))""")
            conn.execute("ALTER TABLE messages ADD COLUMN remote_folder_id INTEGER")
            conn.execute(
                "ALTER TABLE messages ADD COLUMN local_folder_override INTEGER NOT NULL DEFAULT 0"
            )
            conn.execute(
                "UPDATE messages SET local_folder_override=1 WHERE folder NOT IN ('inbox','remote')"
            )
            conn.execute(
                "CREATE INDEX message_remote_folder_date ON messages(remote_folder_id,date DESC,id DESC)"
            )
            conn.execute(
                "CREATE INDEX remote_folder_account_parent ON remote_folders(account_id,parent_remote_id,name)"
            )
            conn.execute("PRAGMA user_version=3")
        if version < 4:
            conn.execute("ALTER TABLE messages ADD COLUMN html_body TEXT")
            conn.execute("ALTER TABLE messages ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
            conn.execute("PRAGMA user_version=4")
        if version < 5:
            conn.execute(
                "CREATE TABLE local_folders(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)"
            )
            conn.execute(
                "CREATE TABLE mail_rules(id INTEGER PRIMARY KEY AUTOINCREMENT,config TEXT NOT NULL)"
            )
            conn.execute("ALTER TABLE events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0")
            conn.execute("ALTER TABLE events ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'")
            conn.execute("ALTER TABLE events ADD COLUMN recurrence TEXT NOT NULL DEFAULT '{}' ")
            conn.execute("PRAGMA user_version=5")
        if version < 6:
            conn.execute("ALTER TABLE messages ADD COLUMN draft_key TEXT")
            conn.execute(
                "CREATE UNIQUE INDEX message_draft_key ON messages(draft_key) WHERE draft_key IS NOT NULL"
            )
            conn.execute(
                "ALTER TABLE messages ADD COLUMN draft_revision INTEGER NOT NULL DEFAULT 0"
            )
            conn.execute(
                "ALTER TABLE messages ADD COLUMN restore_folder TEXT NOT NULL DEFAULT 'inbox'"
            )
            conn.execute("ALTER TABLE messages ADD COLUMN local_destination_id INTEGER")
            conn.execute("ALTER TABLE messages ADD COLUMN restore_destination_id INTEGER")
            conn.execute("PRAGMA user_version=6")
        if version < 7:
            conn.execute(
                "CREATE TABLE tag_catalog(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,key TEXT NOT NULL UNIQUE,color TEXT NOT NULL)"
            )
            conn.execute("CREATE INDEX tagged_messages ON messages(id) WHERE tags!='[]'")
            from . import tag_store

            tag_store.migrate(conn)
            conn.execute("PRAGMA user_version=7")
        if version < 8:
            conn.execute("ALTER TABLE messages ADD COLUMN cc TEXT NOT NULL DEFAULT ''")
            conn.execute("ALTER TABLE messages ADD COLUMN bcc TEXT NOT NULL DEFAULT ''")
            conn.execute(
                "CREATE TABLE address_history(address TEXT PRIMARY KEY COLLATE NOCASE,name TEXT NOT NULL DEFAULT '',last_used TEXT NOT NULL)"
            )
            conn.execute(
                "CREATE INDEX address_history_recent ON address_history(last_used DESC,address)"
            )
            from . import addresses

            addresses.migrate(conn)
            conn.execute("PRAGMA user_version=8")
        if version < 9:
            conn.execute(
                "CREATE TABLE not_junk_senders(sender_key TEXT PRIMARY KEY,created_at TEXT NOT NULL)"
            )
            conn.execute("PRAGMA user_version=9")
        if version < 10:
            # Older rule engines cannot interpret TLD conditions safely.
            conn.execute("PRAGMA user_version=10")
        if version < 11:
            sequence = conn.execute(
                "SELECT seq FROM sqlite_sequence WHERE name='local_folders'"
            ).fetchone()
            last_id = sequence[0] if sequence else 0
            conn.execute("ALTER TABLE local_folders RENAME TO local_folders_old")
            conn.execute(
                "CREATE TABLE local_folders(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,parent TEXT NOT NULL DEFAULT '')"
            )
            conn.execute("INSERT INTO local_folders(id,name) SELECT id,name FROM local_folders_old")
            conn.execute("DROP TABLE local_folders_old")
            updated = conn.execute(
                "UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='local_folders'", (last_id,)
            )
            if not updated.rowcount:
                conn.execute(
                    "INSERT INTO sqlite_sequence(name,seq) VALUES ('local_folders',?)", (last_id,)
                )
            conn.execute("CREATE INDEX local_folder_parent ON local_folders(parent)")
            conn.execute("PRAGMA user_version=11")
        if version < 12:
            conn.execute("ALTER TABLE local_folders ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
            conn.execute("""WITH ranked AS (SELECT id,ROW_NUMBER() OVER (ORDER BY name,id)-1 AS rank FROM local_folders)
                UPDATE local_folders SET position=(SELECT rank FROM ranked WHERE ranked.id=local_folders.id)""")
            conn.execute("PRAGMA user_version=12")
        # Repair derived keys from old unquoted Graph display names, without changing
        # message contents, filing, or sender decisions. Idempotent; no schema change.
        conn.execute("""UPDATE messages SET sender_key=inkwell_sender_key(sender),
            domain_key=inkwell_domain_key(sender)
            WHERE sender_key='' AND inkwell_sender_key(sender)!=''""")
    if os.name != "nt":
        os.chmod(DATA / "inkwell.db", 0o600)


@contextmanager
def db():
    conn = sqlite3.connect(DATA / "inkwell.db", timeout=15)
    conn.row_factory = sqlite3.Row
    conn.create_function("inkwell_search_key", 1, search_key, deterministic=True)
    conn.create_function(
        "inkwell_tag_key", 1, lambda value: str(value).strip().casefold(), deterministic=True
    )
    conn.create_function("inkwell_sender_key", 1, sender_key, deterministic=True)
    conn.create_function("inkwell_domain_key", 1, domain_key, deterministic=True)
    conn.create_function("inkwell_subject_key", 1, subject_key, deterministic=True)
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def seal(value: str) -> str:
    return Fernet((DATA / "vault.key").read_bytes()).encrypt(value.encode()).decode()


def unseal(value: str) -> str:
    return Fernet((DATA / "vault.key").read_bytes()).decrypt(value.encode()).decode()


def setting(key, default=""):
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else default


def set_setting(key, value):
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES (?,?)", (key, value))
