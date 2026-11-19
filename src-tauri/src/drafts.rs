use crate::{StoreError, Workspace};
use rusqlite::{
    Connection, OptionalExtension, TransactionBehavior, functions::FunctionFlags, params,
};
use serde::{Deserialize, Serialize};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

const CONFLICT: &str =
    "This draft changed or was removed elsewhere. Your edits are still in the composer.";

#[derive(Serialize, Deserialize)]
pub struct DraftVersion {
    pub id: i64,
    pub key: String,
    pub revision: i64,
}

#[derive(Default, Serialize, Deserialize)]
pub struct DraftFields {
    pub recipient: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body: String,
}

fn strip_reply(subject: &str) -> Option<&str> {
    let (prefix, rest) = subject.trim_start().split_once(':')?;
    let prefix = prefix.trim_end().to_ascii_lowercase();
    if matches!(prefix.as_str(), "re" | "fw" | "fwd") {
        return Some(rest);
    }
    let (kind, number) = prefix.split_once('[')?;
    let number = number.strip_suffix(']')?;
    (matches!(kind, "re" | "fw" | "fwd")
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit()))
    .then_some(rest)
}
fn subject_key(subject: &str) -> String {
    let normalized: String = subject.nfc().collect();
    let mut value = normalized.as_str();
    while let Some(rest) = strip_reply(value) {
        value = rest;
    }
    let result: String = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .case_fold()
        .collect();
    if result == "(no subject)" {
        String::new()
    } else {
        result
    }
}
fn register_draft_functions(db: &Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS;
    for name in ["inkwell_sender_key", "inkwell_domain_key"] {
        db.create_scalar_function(name, 1, flags, |c| match c.get::<String>(0)?.as_str() {
            // The preview does not write drafts with a provider identity. Fail rather than
            // let the legacy trigger silently compute a bogus key for other senders.
            "Me" | "" => Ok(String::new()),
            _ => Err(rusqlite::Error::InvalidQuery),
        })?;
    }
    db.create_scalar_function("inkwell_subject_key", 1, flags, |c| {
        Ok(subject_key(&c.get::<String>(0)?))
    })
}

impl Workspace {
    pub fn open_for_drafts(path: &std::path::Path) -> Result<Self, StoreError> {
        let workspace = Self::connect(path, true)?;
        register_draft_functions(&workspace.0)?;
        Ok(workspace)
    }

    pub fn save_draft(
        &mut self,
        key: String,
        expected: Option<DraftVersion>,
        fields: DraftFields,
    ) -> Result<DraftVersion, StoreError> {
        if key.len() != 36
            || !key.bytes().enumerate().all(|(i, byte)| {
                if [8, 13, 18, 23].contains(&i) {
                    byte == b'-'
                } else {
                    byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
                }
            })
        {
            return Err(StoreError::Invalid("Invalid draft key."));
        }
        if [&fields.recipient, &fields.cc, &fields.bcc]
            .iter()
            .any(|f| f.chars().count() > 8192 || f.chars().any(char::is_control))
            || fields.subject.chars().count() > 998
            || fields.subject.contains(['\r', '\n'])
            || fields.body.chars().count() > 500_000
        {
            return Err(StoreError::Invalid(
                "Check the field lengths and remove line breaks from addresses and subject.",
            ));
        }
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(previous) = expected {
            if previous.key != key || previous.revision < 1 {
                return Err(StoreError::Invalid(CONFLICT));
            }
            let next = previous
                .revision
                .checked_add(1)
                .ok_or(StoreError::Invalid(CONFLICT))?;
            if tx.execute("UPDATE messages SET recipient=?,cc=?,bcc=?,subject=?,body=?,date=strftime('%Y-%m-%dT%H:%M:%fZ','now'),draft_revision=? WHERE id=? AND draft_key=? AND draft_revision=? AND folder='drafts' AND account_id IS NULL AND remote_key IS NULL AND sender='Me' AND html_body IS NULL AND NOT EXISTS (SELECT 1 FROM outgoing_files WHERE message_id=messages.id AND files!='[]')",
                params![fields.recipient, fields.cc, fields.bcc, fields.subject, fields.body, next, previous.id, key, previous.revision])? != 1 {
                return Err(StoreError::Invalid(CONFLICT));
            }
            tx.commit()?;
            Ok(DraftVersion {
                id: previous.id,
                key,
                revision: next,
            })
        } else {
            if tx
                .query_row("SELECT 1 FROM messages WHERE draft_key=?", [&key], |_| {
                    Ok(())
                })
                .optional()?
                .is_some()
            {
                return Err(StoreError::Invalid(CONFLICT));
            }
            tx.execute("INSERT INTO messages(folder,sender,recipient,cc,bcc,subject,body,date,unread,draft_key,draft_revision) VALUES ('drafts','Me',?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),0,?,1)",
                params![fields.recipient, fields.cc, fields.bcc, fields.subject, fields.body, key])?;
            let id = tx.last_insert_rowid();
            tx.commit()?;
            Ok(DraftVersion {
                id,
                key,
                revision: 1,
            })
        }
    }

    pub fn plain_draft(&self, id: i64) -> Result<Option<(DraftVersion, DraftFields)>, StoreError> {
        Ok(self.0.query_row("SELECT draft_key,draft_revision,recipient,cc,bcc,subject,body FROM messages WHERE id=? AND folder='drafts' AND draft_key IS NOT NULL AND draft_revision>=1 AND account_id IS NULL AND remote_key IS NULL AND sender='Me' AND html_body IS NULL AND NOT EXISTS (SELECT 1 FROM outgoing_files WHERE message_id=messages.id AND files!='[]')", [id], |row| {
            Ok((DraftVersion { id, key: row.get(0)?, revision: row.get(1)? }, DraftFields { recipient: row.get(2)?, cc: row.get(3)?, bcc: row.get(4)?, subject: row.get(5)?, body: row.get(6)? }))
        }).optional()?)
    }
}
