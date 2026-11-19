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
         CREATE TABLE remote_folders(id INTEGER, account_id INTEGER, path TEXT, well_known TEXT, remote_id TEXT, parent_remote_id TEXT);
         CREATE TABLE local_folders(id INTEGER, name TEXT, parent TEXT);
         CREATE TABLE contacts(id INTEGER PRIMARY KEY, name TEXT, email TEXT, company TEXT, notes TEXT);
         CREATE TABLE address_history(address TEXT PRIMARY KEY COLLATE NOCASE,name TEXT,last_used TEXT);
         CREATE TABLE events(id INTEGER, title TEXT, start TEXT, end TEXT, location TEXT);
         CREATE TABLE messages(id INTEGER PRIMARY KEY, folder TEXT, sender TEXT, recipient TEXT,
           subject TEXT, body TEXT, date TEXT, unread INT, starred INT, remote_folder_id INT,
           local_destination_id INT, local_folder_override INT);
         INSERT INTO accounts VALUES (1,'account@example.test');
         INSERT INTO remote_folders VALUES (2,1,'Archive','archive','a',''), (3,1,'Inbox','inbox','b',''), (4,1,'Archive/Child','','c','a');
         INSERT INTO local_folders VALUES (1,'Working','archive');
         INSERT INTO contacts VALUES (1,'First','first@example.test','Example','');
         INSERT INTO events VALUES (1,'Event','2026-01-01','2026-01-02','Here');
         INSERT INTO messages VALUES
           (1,'remote','A','B','100% done','<script>literal text</script>','2026-01-01',1,0,2,NULL,0),
           (2,'remote','A','B','Inbox to archive','Other','2026-01-01',0,1,3,2,1),
           (3,'trash','A','B','Hidden','Other','2026-01-01',0,1,3,NULL,1),
           (4,'drafts','A','B','Draft','Untouched','2026-01-01',0,0,NULL,NULL,0),
           (5,'remote','A','B','Child copy','Ticket #tag','2026-01-01',0,0,4,NULL,0),
           (6,'local-1','A','B','Local child','Other','2026-01-01',0,0,NULL,NULL,0);
         ALTER TABLE messages ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
         ALTER TABLE messages ADD COLUMN cc TEXT NOT NULL DEFAULT '';
         ALTER TABLE messages ADD COLUMN bcc TEXT NOT NULL DEFAULT '';
         UPDATE messages SET tags='[\"Straße\",\"Tag\"]' WHERE id=1;
         UPDATE messages SET cc='cc-only@example.test' WHERE id=5;"
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
    assert_eq!(
        db.scoped_messages("archive", "tag:\"STRASSE\"", 0, "subfolders")
            .unwrap()
            .rows[0]
            .id,
        1
    );
    assert_eq!(
        db.scoped_messages("archive", "cc-only@example.test", 0, "subfolders")
            .unwrap()
            .rows[0]
            .id,
        5
    );
    assert_eq!(
        db.scoped_messages("archive", "", 0, "subfolders")
            .unwrap()
            .rows
            .len(),
        4
    );
    assert_eq!(
        db.scoped_messages("inbox", "#tag", 0, "all")
            .unwrap()
            .rows
            .len(),
        2
    );
    assert!(db.messages("archive", "tag:", 0).unwrap().rows.is_empty());

    let mut editor = Workspace::open_for_contacts(&path).unwrap();
    let old = db.contacts().unwrap().pop().unwrap();
    let mut updated = old.fields.clone();
    updated.notes = "New note".into();
    editor
        .save_contact(Some(old.id), Some(old.fields.clone()), updated.clone())
        .unwrap();
    assert!(matches!(
        editor.delete_contact(old.id, old.fields),
        Err(StoreError::Conflict)
    ));
    assert_eq!(db.contacts().unwrap()[0].fields.notes, "New note");
    assert_eq!(
        writer
            .query_row(
                "SELECT name FROM address_history WHERE address='first@example.test'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
        "First"
    );
    editor.delete_contact(old.id, updated.clone()).unwrap();
    let new_id = editor.save_contact(None, None, updated).unwrap();
    assert_eq!(db.contacts().unwrap()[0].id, new_id);
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
