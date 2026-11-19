use inkwell_tauri::{
    Workspace,
    drafts::{DraftFields, DraftVersion},
};
use rusqlite::Connection;

const KEY: &str = "00000000-0000-4000-8000-000000000001";
#[test]
fn plain_drafts_follow_legacy_schema_and_reject_conflicting_edits() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("inkwell.db");
    let raw = Connection::open(&path).unwrap();
    raw.execute_batch("PRAGMA user_version=22;
      CREATE TABLE messages(id INTEGER PRIMARY KEY, folder TEXT, sender TEXT, recipient TEXT, cc TEXT, bcc TEXT, subject TEXT, body TEXT, date TEXT, unread INTEGER, draft_key TEXT UNIQUE, draft_revision INTEGER, account_id INTEGER, remote_key TEXT, html_body TEXT, sender_key TEXT, domain_key TEXT, subject_key TEXT);
      CREATE TABLE outgoing_files(message_id INTEGER PRIMARY KEY, files TEXT);
      CREATE TRIGGER message_collections_insert AFTER INSERT ON messages BEGIN
          UPDATE messages SET sender_key=inkwell_sender_key(NEW.sender), domain_key=inkwell_domain_key(NEW.sender), subject_key=inkwell_subject_key(NEW.subject) WHERE id=NEW.id;
      END;
      CREATE TRIGGER message_collections_update AFTER UPDATE OF sender,subject ON messages BEGIN
          UPDATE messages SET sender_key=inkwell_sender_key(NEW.sender), domain_key=inkwell_domain_key(NEW.sender), subject_key=inkwell_subject_key(NEW.subject) WHERE id=NEW.id;
      END;").unwrap();
    let mut editor = Workspace::open_for_drafts(&path).unwrap();
    let first = editor
        .save_draft(
            KEY.into(),
            None,
            DraftFields {
                subject: "Re[2]: Fwd: A test".into(),
                body: "First".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(
        raw.query_row("SELECT subject_key FROM messages", [], |row| row
            .get::<_, String>(0))
            .unwrap(),
        "a test"
    );
    assert!(
        editor
            .save_draft(KEY.into(), None, DraftFields::default())
            .is_err()
    );
    let id = first.id;
    let second = editor
        .save_draft(
            KEY.into(),
            Some(first),
            DraftFields {
                body: "Updated".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(second.revision, 2);
    let (_, data) = Workspace::open(&path)
        .unwrap()
        .plain_draft(id)
        .unwrap()
        .unwrap();
    assert_eq!(data.body, "Updated");
    assert!(
        editor
            .save_draft(
                KEY.into(),
                Some(DraftVersion {
                    id,
                    key: KEY.into(),
                    revision: 1
                }),
                DraftFields::default()
            )
            .is_err()
    );
    raw.execute(
        "UPDATE messages SET html_body='<p>Preserve</p>' WHERE id=?",
        [id],
    )
    .unwrap();
    assert!(editor.plain_draft(id).unwrap().is_none());
    assert!(
        editor
            .save_draft(KEY.into(), Some(second), DraftFields::default())
            .is_err()
    );
    assert_eq!(
        raw.query_row("SELECT html_body FROM messages", [], |row| row
            .get::<_, String>(0))
            .unwrap(),
        "<p>Preserve</p>"
    );
}
