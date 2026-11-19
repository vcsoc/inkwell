use inkwell_tauri::{PAGE_SIZE, SCHEMA, StoreError, Workspace};
use rusqlite::Connection;
use tempfile::tempdir;

#[test]
fn refuses_missing_and_incompatible_stores_without_creating_or_migrating() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("inkwell.db");
    assert!(matches!(Workspace::open(&path), Err(StoreError::Missing)));
    assert!(!path.exists());
    let writer = Connection::open(&path).unwrap();
    writer
        .pragma_update(None, "user_version", SCHEMA + 1)
        .unwrap();
    assert!(matches!(
        Workspace::open(&path),
        Err(StoreError::Unsupported(23))
    ));
    let version: i64 = writer
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, SCHEMA + 1);
}

#[test]
fn reads_bookmarked_folders_and_existing_wal_without_mutating_the_store() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("inkwell.db");
    let writer = Connection::open(&path).unwrap();
    writer.execute_batch(
        "PRAGMA user_version=22;
         PRAGMA journal_mode=WAL;
         CREATE TABLE accounts(id INTEGER, email TEXT);
         CREATE TABLE remote_folders(id INTEGER, account_id INTEGER, path TEXT, well_known TEXT);
         CREATE TABLE local_folders(id INTEGER, name TEXT);
         CREATE TABLE contacts(id INTEGER, name TEXT, email TEXT, company TEXT);
         CREATE TABLE events(id INTEGER, title TEXT, start TEXT, end TEXT, location TEXT);
         CREATE TABLE messages(id INTEGER PRIMARY KEY, folder TEXT, sender TEXT, recipient TEXT,
           subject TEXT, body TEXT, date TEXT, unread INT, starred INT, remote_folder_id INT,
           local_destination_id INT, local_folder_override INT);
         INSERT INTO accounts VALUES (1,'account@example.test');
         INSERT INTO remote_folders VALUES (2,1,'Archive','archive'), (3,1,'Inbox','inbox');
         INSERT INTO local_folders VALUES (1,'Working');
         INSERT INTO contacts VALUES (1,'First','first@example.test','Example');
         INSERT INTO events VALUES (1,'Event','2026-01-01','2026-01-02','Here');
         INSERT INTO messages VALUES
           (1,'remote','A','B','100% done','<script>literal text</script>','2026-01-01',1,0,2,NULL,0),
           (2,'remote','A','B','Inbox to archive','Other','2026-01-01',0,1,3,2,1),
           (3,'trash','A','B','Hidden','Other','2026-01-01',0,1,3,NULL,1),
           (4,'drafts','A','B','Draft','Untouched','2026-01-01',0,0,NULL,NULL,0);"
    ).unwrap();
    let db = Workspace::open(&path).unwrap();
    let folders = db.folders().unwrap();
    assert!(folders.iter().any(|folder| folder.key == "remote:2"));
    assert!(folders.iter().any(|folder| folder.key == "local-1"));
    assert_eq!(db.messages("archive", "", 0).unwrap().rows.len(), 2);
    assert_eq!(db.messages("remote:2", "", 0).unwrap().rows.len(), 2);
    assert_eq!(db.messages("starred", "", 0).unwrap().rows[0].id, 2);
    assert_eq!(db.messages("drafts", "", 0).unwrap().rows[0].id, 4);
    assert_eq!(db.messages("archive", "%", 0).unwrap().rows[0].id, 1);
    assert_eq!(db.message(1).unwrap().body, "<script>literal text</script>");
    assert!(
        db.messages("archive' OR 1=1 --", "", 0)
            .unwrap()
            .rows
            .is_empty()
    );
    assert_eq!(db.contacts().unwrap().len(), 1);
    assert_eq!(db.events().unwrap().len(), 1);
    assert_eq!(
        writer
            .query_row("SELECT unread FROM messages WHERE id=1", [], |row| row
                .get::<_, i32>(0))
            .unwrap(),
        1
    );
    for _ in 0..PAGE_SIZE + 1 {
        writer.execute("INSERT INTO messages (folder,sender,recipient,subject,body,date,unread,starred,local_folder_override) VALUES ('inbox','A','B','Title','','2026-01-01',0,0,0)", []).unwrap();
    }
    let first = db.messages("inbox", "", 0).unwrap();
    let second = db.messages("inbox", "", PAGE_SIZE).unwrap();
    assert!(first.more);
    assert_eq!(first.rows.len(), PAGE_SIZE as usize);
    assert_eq!(second.rows.len(), 1);
    assert!(!second.more);
}
