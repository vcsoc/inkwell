//! Bounded, insert-only Outlook Inbox import. This does not own OAuth refresh or
//! the archived background worker's delta state, and does not apply mail rules.

use inkwell_tauri::{SCHEMA, vault::Vault};
use reqwest::{Url, blocking::Client, redirect::Policy};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, TransactionBehavior, functions::FunctionFlags, params,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fmt,
    io::Read,
    path::Path,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

const GRAPH: &str = "https://graph.microsoft.com";
const PAGE_SIZE: usize = 25;
const MAX_PAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_LINK_BYTES: usize = 16 * 1024;
const PREFER: &str = r#"IdType="ImmutableId", outlook.body-content-type="text""#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SyncError {
    Workspace,
    UnsupportedSchema,
    Account,
    Credential,
    Busy,
    WorkspaceChanged,
    Graph,
    GraphStatus(u16),
    InvalidPage,
    UnsafeLink,
    RepeatedPage,
}

impl From<rusqlite::Error> for SyncError {
    fn from(error: rusqlite::Error) -> Self {
        match error.sqlite_error_code() {
            Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
                Self::Busy
            }
            _ => Self::Workspace,
        }
    }
}

impl fmt::Display for SyncError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Workspace => "Could not complete the Outlook import in this workspace.",
            Self::UnsupportedSchema => "This workspace schema is not supported for Outlook import.",
            Self::Account => "The Outlook account or its cached Inbox is unavailable.",
            Self::Credential => "No valid cached Outlook access grant. Refresh or reauthorize the account before importing.",
            Self::Busy => "The workspace is busy. Retry the Outlook import.",
            Self::WorkspaceChanged => "The workspace changed during the Outlook import. Retry to use the current state.",
            Self::Graph => "Could not read the Outlook Inbox from Microsoft.",
            Self::GraphStatus(status) => return write!(f, "Microsoft rejected the Outlook Inbox request (HTTP {status})."),
            Self::InvalidPage => "Microsoft returned an incomplete or oversized Outlook Inbox page.",
            Self::UnsafeLink => "Microsoft returned an unexpected Outlook Inbox continuation.",
            Self::RepeatedPage => "Microsoft returned a repeated Outlook Inbox continuation.",
        })
    }
}

impl std::error::Error for SyncError {}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct SyncReport {
    pub inserted: usize,
    pub pages: usize,
    /// A continuation exists for an intermediate page; false on successful completion.
    pub more_available: bool,
}

pub fn outlook_accounts(path: &Path) -> Result<Vec<i64>, SyncError> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    db.busy_timeout(Duration::from_secs(4))?;
    let version: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version != SCHEMA {
        return Err(SyncError::UnsupportedSchema);
    }
    let mut query = db.prepare("SELECT id FROM accounts WHERE provider='microsoft' ORDER BY id")?;
    Ok(query
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Run on a blocking thread with a trusted workspace DB path and selected account ID.
/// Only reads an unexpired grant from the existing vault; no refresh, secret update,
/// provider write, delete, existing-message update, or delta checkpoint is performed.
pub fn sync_inbox(
    path: &Path,
    account_id: i64,
    mut progress: impl FnMut(SyncReport),
) -> Result<SyncReport, SyncError> {
    let mut db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    db.busy_timeout(Duration::from_secs(4))?;
    db.pragma_update(None, "foreign_keys", true)?;
    db.pragma_update(None, "trusted_schema", false)?;
    let snapshot = snapshot(&db, account_id)?;
    let vault = Vault::open(path.parent().ok_or(SyncError::Credential)?)
        .map_err(|_| SyncError::Credential)?;
    let clear = vault
        .unseal(&snapshot.secret)
        .map_err(|_| SyncError::Credential)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| SyncError::Credential)?;
    let token = cached_token(&clear, now.as_secs_f64())?;
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .no_proxy()
        .retry(reqwest::retry::never())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| SyncError::Graph)?;
    let mut report = SyncReport::default();
    let db = std::cell::RefCell::new(&mut db);
    let page_snapshot = std::cell::RefCell::new(None);
    walk_inbox(
        &snapshot.inbox.remote_id,
        |url| {
            let current = self::snapshot(&db.borrow(), account_id)?;
            if !current.same_account(&snapshot) {
                return Err(SyncError::WorkspaceChanged);
            }
            *page_snapshot.borrow_mut() = Some(current);
            let current_time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| SyncError::Credential)?;
            cached_token(&clear, current_time.as_secs_f64())?;
            let response = client
                .get(url)
                .bearer_auth(token)
                .header("Prefer", PREFER)
                .send()
                .map_err(|_| SyncError::Graph)?;
            if !response.status().is_success() {
                return Err(SyncError::GraphStatus(response.status().as_u16()));
            }
            if response
                .content_length()
                .is_some_and(|n| n > MAX_PAGE_BYTES as u64)
            {
                return Err(SyncError::InvalidPage);
            }
            let mut bytes = Vec::new();
            response
                .take(MAX_PAGE_BYTES as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| SyncError::Graph)?;
            Ok(bytes)
        },
        |batch, removed| {
            // Normal Inbox listing is not a delta feed; never infer deletions from it.
            if !removed.is_empty() {
                return Err(SyncError::InvalidPage);
            }
            let expected = page_snapshot
                .borrow_mut()
                .take()
                .ok_or(SyncError::WorkspaceChanged)?;
            let page = apply(&mut db.borrow_mut(), &expected, batch)?;
            report.inserted += page.inserted;
            report.pages += 1;
            report.more_available = page.more_available;
            progress(report);
            Ok(())
        },
    )?;
    Ok(report)
}

fn cached_token(clear: &str, now: f64) -> Result<&str, SyncError> {
    #[derive(Deserialize)]
    struct Grant<'a> {
        access_token: &'a str,
        expires_at: f64,
    }
    let grant: Grant<'_> = serde_json::from_str(clear).map_err(|_| SyncError::Credential)?;
    if !grant.expires_at.is_finite()
        || grant.expires_at <= now + 120.0
        || grant.access_token.is_empty()
        || grant.access_token.len() > 32 * 1024
        || !grant.access_token.bytes().all(|b| b.is_ascii_graphic())
    {
        return Err(SyncError::Credential);
    }
    Ok(grant.access_token)
}

#[derive(PartialEq, Eq)]
struct Inbox {
    local_id: Option<i64>,
    remote_id: String,
}

#[derive(PartialEq, Eq)]
struct Snapshot {
    account_id: i64,
    email: String,
    secret: String,
    client_id: String,
    data_version: i64,
    inbox: Inbox,
}

impl Snapshot {
    fn same_account(&self, other: &Self) -> bool {
        self.account_id == other.account_id
            && self.email == other.email
            && self.secret == other.secret
            && self.client_id == other.client_id
            && self.inbox == other.inbox
    }
}

fn snapshot(db: &Connection, account_id: i64) -> Result<Snapshot, SyncError> {
    // Read the change counter first so even a commit during these reads invalidates the batch.
    let data_version = db.pragma_query_value(None, "data_version", |r| r.get(0))?;
    let schema: i64 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if schema != SCHEMA {
        return Err(SyncError::UnsupportedSchema);
    }
    let (email, secret, client_id) = db
        .query_row(
            "SELECT email,secret,client_id FROM accounts WHERE id=? AND provider='microsoft'",
            [account_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(SyncError::Account)?;
    let mut stmt = db.prepare(
        "SELECT id,remote_id FROM remote_folders WHERE account_id=? AND well_known='inbox' LIMIT 2",
    )?;
    let mut rows = stmt.query([account_id])?;
    let inbox = if let Some(row) = rows.next()? {
        let inbox = Inbox {
            local_id: Some(row.get(0)?),
            remote_id: row.get(1)?,
        };
        if rows.next()?.is_some()
            || !valid_id(&inbox.remote_id)
            || matches!(inbox.remote_id.as_str(), "." | "..")
        {
            return Err(SyncError::Account);
        }
        inbox
    } else {
        Inbox {
            local_id: None,
            remote_id: "inbox".into(),
        }
    };
    Ok(Snapshot {
        account_id,
        email,
        secret,
        client_id,
        data_version,
        inbox,
    })
}

#[derive(Deserialize)]
struct Page {
    value: Vec<serde_json::Value>,
    #[serde(rename = "@odata.nextLink")]
    next: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphMessage {
    id: String,
    from: Option<Recipient>,
    to_recipients: Vec<Recipient>,
    cc_recipients: Vec<Recipient>,
    bcc_recipients: Vec<Recipient>,
    subject: Option<String>,
    body: Body,
    received_date_time: String,
    is_read: bool,
    flag: Flag,
    has_attachments: bool,
    #[serde(default)]
    is_draft: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Recipient {
    email_address: Address,
}
#[derive(Deserialize)]
struct Address {
    address: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Body {
    content_type: String,
    content: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Flag {
    flag_status: FlagStatus,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum FlagStatus {
    NotFlagged,
    Complete,
    Flagged,
}

struct Batch {
    messages: Vec<GraphMessage>,
    pages: usize,
    more_available: bool,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 2048 && id.bytes().all(|b| b.is_ascii_graphic())
}

fn continuation(raw: &str, inbox_path: &str) -> Result<Url, SyncError> {
    // Check raw syntax as well as the parsed URL: its normalizer tolerates backslashes,
    // strips some control characters, and can erase empty user information.
    if raw.len() > MAX_LINK_BYTES
        || !raw.starts_with("https://graph.microsoft.com/")
        || raw
            .bytes()
            .any(|b| b.is_ascii_whitespace() || b.is_ascii_control() || b == b'\\')
        || !raw
            .strip_prefix(GRAPH)
            .and_then(|tail| tail.split_once('?'))
            .is_some_and(|(path, _)| path == inbox_path)
    {
        return Err(SyncError::UnsafeLink);
    }
    let url = Url::parse(raw).map_err(|_| SyncError::UnsafeLink)?;
    if url.path() != inbox_path || url.fragment().is_some() || url.query().is_none_or(str::is_empty)
    {
        return Err(SyncError::UnsafeLink);
    }
    Ok(url)
}

fn walk_inbox(
    remote_id: &str,
    mut get: impl FnMut(Url) -> Result<Vec<u8>, SyncError>,
    mut commit: impl FnMut(Batch, HashSet<String>) -> Result<(), SyncError>,
) -> Result<(), SyncError> {
    let mut url = Url::parse(GRAPH).map_err(|_| SyncError::UnsafeLink)?;
    url.path_segments_mut()
        .map_err(|_| SyncError::UnsafeLink)?
        .extend(["v1.0", "me", "mailFolders", remote_id, "messages"]);
    let path = url.path().to_owned();
    url.query_pairs_mut()
        .append_pair("$top", &PAGE_SIZE.to_string())
        .append_pair("$orderby", "receivedDateTime desc")
        .append_pair("$select", "id,from,toRecipients,ccRecipients,bccRecipients,subject,body,receivedDateTime,isRead,flag,hasAttachments,isDraft");
    let mut seen_urls = HashSet::new();
    loop {
        use sha2::{Digest, Sha256};
        let fingerprint: [u8; 32] = Sha256::digest(url.as_str()).into();
        if !seen_urls.insert(fingerprint) {
            return Err(SyncError::RepeatedPage);
        }
        let bytes = get(url)?;
        if bytes.len() > MAX_PAGE_BYTES {
            return Err(SyncError::InvalidPage);
        }
        let page: Page = serde_json::from_slice(&bytes).map_err(|_| SyncError::InvalidPage)?;
        if page.value.len() > PAGE_SIZE {
            return Err(SyncError::InvalidPage);
        }
        let mut seen_ids = HashSet::new();
        let mut excluded = HashSet::new();
        let mut messages = Vec::new();
        for value in page.value {
            let id = value
                .get("id")
                .and_then(|id| id.as_str())
                .filter(|id| valid_id(id))
                .ok_or(SyncError::InvalidPage)?;
            if value.get("@removed").is_some() {
                excluded.insert(id.to_owned());
                continue;
            }
            if seen_ids.insert(id.to_owned()) {
                let message: GraphMessage =
                    serde_json::from_value(value).map_err(|_| SyncError::InvalidPage)?;
                if !message.body.content_type.eq_ignore_ascii_case("text")
                    || chrono::DateTime::parse_from_rfc3339(&message.received_date_time).is_err()
                {
                    return Err(SyncError::InvalidPage);
                }
                if !message.is_draft {
                    messages.push(message);
                }
            }
        }
        let next = page
            .next
            .as_deref()
            .map(|next| continuation(next, &path))
            .transpose()?;
        if next.as_ref().is_some_and(|next| {
            let digest: [u8; 32] = Sha256::digest(next.as_str()).into();
            seen_urls.contains(&digest)
        }) {
            return Err(SyncError::RepeatedPage);
        }
        messages.retain(|message| !excluded.contains(&message.id));
        commit(
            Batch {
                messages,
                pages: 1,
                more_available: next.is_some(),
            },
            excluded,
        )?;
        match next {
            Some(next) => url = next,
            None => return Ok(()),
        }
    }
}

#[cfg(test)]
fn fetch_inbox(
    remote_id: &str,
    get: impl FnMut(Url) -> Result<Vec<u8>, SyncError>,
) -> Result<Batch, SyncError> {
    let mut collected = Batch {
        messages: Vec::new(),
        pages: 0,
        more_available: false,
    };
    let mut seen = HashSet::new();
    let mut excluded = HashSet::new();
    walk_inbox(remote_id, get, |page, removed| {
        collected.pages += 1;
        collected.messages.extend(
            page.messages
                .into_iter()
                .filter(|item| seen.insert(item.id.clone())),
        );
        excluded.extend(removed);
        Ok(())
    })?;
    collected
        .messages
        .retain(|item| !excluded.contains(&item.id));
    Ok(collected)
}

// The importer emits plain addr-specs, not arbitrary RFC 5322 display strings.
// Derive the legacy trigger keys for exactly that representation.
fn address_parts(value: &str) -> Option<(&str, &str)> {
    let (local, domain) = value.rsplit_once('@')?;
    let atom = |c: char| c.is_ascii_alphanumeric() || "!#$%&'*+-/=?^_`{|}~".contains(c);
    if local
        .split('.')
        .any(|part| part.is_empty() || !part.chars().all(atom))
        || domain.trim_end_matches('.').split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || !label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
    {
        return None;
    }
    Some((local, domain.trim_end_matches('.')))
}

fn subject_key(value: &str) -> String {
    let normalized: String = value.nfc().collect();
    let whitespace = |c: char| c.is_whitespace() || matches!(c, '\u{001c}'..='\u{001f}');
    let mut value = normalized.trim_start_matches(whitespace);
    while let Some((head, tail)) = value.split_once(':') {
        let head = head.trim_end_matches(whitespace);
        let (prefix, suffix) = head.split_once('[').unwrap_or((head, ""));
        let valid = if head.contains('[') {
            suffix.strip_suffix(']').is_some_and(|digits| {
                !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit())
            })
        } else {
            true
        };
        if !valid
            || !["re", "fw", "fwd"]
                .iter()
                .any(|key| prefix.eq_ignore_ascii_case(key))
        {
            break;
        }
        value = tail.trim_start_matches(whitespace);
    }
    let key: String = value
        .split(whitespace)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .case_fold()
        .collect();
    if key == "(no subject)" {
        String::new()
    } else {
        key
    }
}

fn register_keys(db: &Connection) -> rusqlite::Result<()> {
    let flags = FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS;
    db.create_scalar_function("inkwell_sender_key", 1, flags, |ctx| {
        Ok(
            address_parts(ctx.get_raw(0).as_str()?).map_or_else(String::new, |(local, domain)| {
                format!(
                    "{}@{}",
                    local.to_ascii_lowercase(),
                    domain.to_ascii_lowercase()
                )
            }),
        )
    })?;
    db.create_scalar_function("inkwell_domain_key", 1, flags, |ctx| {
        Ok(address_parts(ctx.get_raw(0).as_str()?)
            .map_or_else(String::new, |(_, domain)| domain.to_ascii_lowercase()))
    })?;
    db.create_scalar_function("inkwell_subject_key", 1, flags, |ctx| {
        Ok(subject_key(ctx.get_raw(0).as_str()?))
    })
}

fn recipients(list: &[Recipient]) -> String {
    list.iter()
        .map(|r| r.email_address.address.as_str())
        .filter(|address| {
            !address.is_empty() && !address.chars().any(|c| c.is_control() || c == ',')
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn apply(db: &mut Connection, expected: &Snapshot, batch: Batch) -> Result<SyncReport, SyncError> {
    register_keys(db)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current = snapshot(&tx, expected.account_id).map_err(|error| match error {
        SyncError::Account | SyncError::UnsupportedSchema => SyncError::WorkspaceChanged,
        other => other,
    })?;
    if current != *expected {
        return Err(SyncError::WorkspaceChanged);
    }
    let mut report = SyncReport {
        pages: batch.pages,
        more_available: batch.more_available,
        inserted: 0,
    };
    if batch.messages.is_empty() {
        return Ok(report);
    }
    // Deleted rows can leave provider jobs keyed by the old SQLite ID; never reuse it.
    let mut last_id: i64 = tx.query_row("SELECT max(0,coalesce((SELECT max(id) FROM messages),0),coalesce((SELECT max(resource_id) FROM provider_jobs WHERE resource_type='mail'),0))", [], |r| r.get(0))?;
    // Keep matching queued/in-flight/failed work and historical delete intents even
    // when the local row is gone. Match payload identity, not reusable resource IDs.
    let blocked = {
        let mut stmt = tx.prepare("SELECT payload FROM provider_jobs WHERE account_id=? AND resource_type='mail' AND (kind='delete' OR state!='done')")?;
        let candidates: HashSet<&str> = batch
            .messages
            .iter()
            .map(|message| message.id.as_str())
            .collect();
        let mut result = HashSet::new();
        let mut jobs = stmt.query([expected.account_id])?;
        while let Some(job) = jobs.next()? {
            let payload: String = job.get(0)?;
            let payload: serde_json::Value =
                serde_json::from_str(&payload).map_err(|_| SyncError::Workspace)?;
            let id = payload
                .get("remote_id")
                .and_then(|id| id.as_str())
                .filter(|id| valid_id(id))
                .ok_or(SyncError::Workspace)?;
            if candidates.contains(id) {
                result.insert(id.to_owned());
            }
        }
        result
    };
    {
        let mut insert = tx.prepare("INSERT INTO messages(id,account_id,remote_key,folder,remote_folder_id,sender,recipient,cc,bcc,subject,body,date,unread,flagged,starred)
             VALUES(?,?,?,'inbox',?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(remote_key) DO NOTHING")?;
        let mut attachment =
            tx.prepare("INSERT INTO message_attachment_status(message_id,present) VALUES(?,1)")?;
        for message in batch.messages {
            if blocked.contains(&message.id) {
                continue;
            }
            let id = last_id.checked_add(1).ok_or(SyncError::Workspace)?;
            let sender = message
                .from
                .as_ref()
                .map(|sender| sender.email_address.address.as_str())
                .filter(|address| !address.is_empty() && !address.chars().any(char::is_control))
                .unwrap_or("(Unknown sender)");
            let flagged = matches!(message.flag.flag_status, FlagStatus::Flagged);
            let count = insert.execute(params![
                id,
                expected.account_id,
                format!("{}:graph:{}", expected.account_id, message.id),
                expected.inbox.local_id,
                sender,
                recipients(&message.to_recipients),
                recipients(&message.cc_recipients),
                recipients(&message.bcc_recipients),
                message
                    .subject
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .unwrap_or("(No subject)"),
                &message.body.content,
                &message.received_date_time,
                !message.is_read,
                flagged,
                flagged,
            ])?;
            if count != 0 {
                // Graph's false value does not rule out inline-only attachments.
                if message.has_attachments {
                    attachment.execute([id])?;
                }
                last_id = id;
                report.inserted += 1;
            }
        }
    }
    tx.commit()?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::collections::VecDeque;

    const NEXT: &str =
        "https://graph.microsoft.com/v1.0/me/mailFolders/cached-inbox/messages?$skiptoken=";

    fn schema(db: &Connection) {
        db.execute_batch(r#"
            PRAGMA user_version=22;
            PRAGMA foreign_keys=ON;
            PRAGMA trusted_schema=OFF;
            CREATE TABLE accounts(id INTEGER PRIMARY KEY, email TEXT NOT NULL, secret TEXT NOT NULL, provider TEXT NOT NULL, client_id TEXT NOT NULL);
            CREATE TABLE remote_folders(id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, remote_id TEXT NOT NULL, well_known TEXT NOT NULL);
            CREATE TABLE messages(
                id INTEGER PRIMARY KEY, account_id INTEGER, remote_key TEXT UNIQUE,
                folder TEXT NOT NULL DEFAULT 'inbox', sender TEXT NOT NULL, recipient TEXT NOT NULL,
                subject TEXT NOT NULL, body TEXT NOT NULL, date TEXT NOT NULL, unread INTEGER NOT NULL DEFAULT 1,
                starred INTEGER NOT NULL DEFAULT 0, demo INTEGER NOT NULL DEFAULT 0,
                sender_key TEXT NOT NULL DEFAULT '', domain_key TEXT NOT NULL DEFAULT '', subject_key TEXT NOT NULL DEFAULT '',
                remote_folder_id INTEGER, local_folder_override INTEGER NOT NULL DEFAULT 0, html_body TEXT,
                tags TEXT NOT NULL DEFAULT '[]', draft_key TEXT UNIQUE, cc TEXT NOT NULL DEFAULT '', bcc TEXT NOT NULL DEFAULT '',
                local_destination_id INTEGER, restore_destination_id INTEGER, flagged INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE provider_jobs(id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, resource_type TEXT NOT NULL,
                resource_id INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL);
            CREATE TABLE message_attachment_status(message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
                present INTEGER NOT NULL CHECK(present IN (0,1)));
            CREATE TABLE mail_sync_state(folder_id INTEGER PRIMARY KEY, next_url TEXT, delta_url TEXT);
            INSERT INTO accounts VALUES (1,'a@example.test','fixture','microsoft','client'), (2,'b@example.test','fixture','microsoft','client');
            INSERT INTO remote_folders VALUES(7,1,'cached-inbox','inbox'),(8,2,'other-inbox','inbox');
            INSERT INTO mail_sync_state VALUES(7,'archive-next','archive-delta');
            CREATE TRIGGER message_collections_insert AFTER INSERT ON messages BEGIN
                UPDATE messages SET sender_key=inkwell_sender_key(NEW.sender), domain_key=inkwell_domain_key(NEW.sender),
                    subject_key=inkwell_subject_key(NEW.subject) WHERE id=NEW.id;
            END;
        "#).unwrap();
        register_keys(db).unwrap();
    }

    fn message(id: &str) -> Value {
        json!({
            "id": id, "from": {"emailAddress": {"address": "Alice@EXAMPLE.test"}},
            "toRecipients": [{"emailAddress": {"address": "a@example.test"}}],
            "ccRecipients": [], "bccRecipients": [], "subject": " Re[2] : Fwd: An Update ",
            "body": {"contentType": "text", "content": "Plain <text>"},
            "receivedDateTime": "2026-07-01T11:22:00Z", "isRead": false,
            "flag": {"flagStatus": "flagged"}, "hasAttachments": true, "isDraft": false
        })
    }

    fn fixture(pages: Vec<Value>) -> Result<Batch, SyncError> {
        let mut pages = VecDeque::from(pages);
        fetch_inbox("cached-inbox", |url| {
            assert_eq!(url.host_str(), Some("graph.microsoft.com"));
            assert_eq!(url.path(), "/v1.0/me/mailFolders/cached-inbox/messages");
            Ok(
                serde_json::to_vec(&pages.pop_front().expect("unexpected fixture request"))
                    .unwrap(),
            )
        })
    }

    #[test]
    fn inserts_only_missing_immutable_ids_and_preserves_existing_local_and_queue_state() {
        let mut db = Connection::open_in_memory().unwrap();
        schema(&db);
        db.execute_batch(r#"
            INSERT INTO messages(id,account_id,remote_key,folder,sender,recipient,subject,body,date,
                unread,starred,flagged,html_body,tags,draft_key,remote_folder_id,local_folder_override,local_destination_id,restore_destination_id)
            VALUES (41,1,'1:graph:keep','trash','Local','','Local subject','Local body','local date',0,0,0,
                'local HTML','["custom"]','draft-identity',99,1,123,456),
                (42,2,'2:graph:new/id','inbox','Other','','Other subject','Other body','other date',1,0,0,
                NULL,'[]',NULL,8,0,NULL,NULL);
            INSERT INTO message_attachment_status VALUES(41,0);
            INSERT INTO provider_jobs VALUES
                (1,1,'mail',41,'move','{"remote_id":"keep"}','pending'),
                (2,1,'mail',900,'delete','{"remote_id":"deleted"}','done'),
                (3,1,'mail',902,'delete','{"remote_id":"failed"}','failed'),
                (4,1,'mail',903,'move','{"remote_id":"running"}','running'),
                (5,1,'mail',904,'read','{"remote_id":"pending"}','pending'),
                (6,2,'mail',42,'delete','{"remote_id":"new/id"}','failed');
        "#).unwrap();
        let pages = || {
            vec![
                json!({"value": [message("keep"),message("new/id"),message("deleted"),message("removed")], "@odata.nextLink": format!("{NEXT}2")}),
                json!({"value": [message("new/id"),message("failed"),message("running"),message("pending"),
                {"id": "removed", "@removed": {"reason":"deleted"}}]}),
            ]
        };
        let expected = snapshot(&db, 1).unwrap();
        let first = apply(&mut db, &expected, fixture(pages()).unwrap()).unwrap();
        assert_eq!(
            first,
            SyncReport {
                inserted: 1,
                pages: 2,
                more_available: false
            }
        );
        let expected = snapshot(&db, 1).unwrap();
        assert_eq!(
            apply(&mut db, &expected, fixture(pages()).unwrap())
                .unwrap()
                .inserted,
            0
        );
        let imported: (i64, i64, String, String, String, String, bool, bool, bool) = db.query_row(
            "SELECT id,remote_folder_id,sender_key,domain_key,subject_key,body,unread,flagged,starred FROM messages WHERE remote_key='1:graph:new/id'",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
        ).unwrap();
        assert_eq!(
            imported,
            (
                905,
                7,
                "alice@example.test".into(),
                "example.test".into(),
                "an update".into(),
                "Plain <text>".into(),
                true,
                true,
                true
            )
        );
        let unchanged: bool = db.query_row("SELECT count(*)=1 FROM messages WHERE id=41 AND folder='trash' AND sender='Local' AND subject='Local subject' AND body='Local body' AND date='local date' AND unread=0 AND starred=0 AND flagged=0 AND html_body='local HTML' AND tags='[\"custom\"]' AND draft_key='draft-identity' AND remote_folder_id=99 AND local_folder_override=1 AND local_destination_id=123 AND restore_destination_id=456", [], |r| r.get(0)).unwrap();
        assert!(unchanged);
        let counts: (i64,i64,i64,i64) = db.query_row("SELECT (SELECT count(*) FROM messages), (SELECT count(*) FROM provider_jobs), (SELECT sum(present) FROM message_attachment_status), (SELECT count(*) FROM mail_sync_state WHERE next_url='archive-next' AND delta_url='archive-delta')", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap();
        assert_eq!(counts, (3, 6, 1, 1));
    }

    #[test]
    fn rejects_cross_origin_and_cross_folder_continuations_before_fetching_them() {
        for link in [
            "http://graph.microsoft.com/v1.0/me/mailFolders/cached-inbox/messages?skip=2",
            "https://graph.microsoft.com.evil.test/v1.0/me/mailFolders/cached-inbox/messages?skip=2",
            "https://graph.microsoft.com@evil.test/v1.0/me/mailFolders/cached-inbox/messages?skip=2",
            "https://@graph.microsoft.com/v1.0/me/mailFolders/cached-inbox/messages?skip=2",
            "https://graph.microsoft.com:443/v1.0/me/mailFolders/cached-inbox/messages?skip=2",
            "https://graph.microsoft.com/v1.0/me/mailFolders/other-inbox/messages?skip=2",
            "https://graph.microsoft.com/v1.0/me/mailFolders/cached-inbox/../cached-inbox/messages?skip=2",
            "https://graph.microsoft.com/v1.0/me/mailFolders/cached-inbox/messages?skip=2#fragment",
            "https://graph.microsoft.com/v1.0/me/mailFolders/cached-inbox/messages?skip=2\n",
            "/v1.0/me/mailFolders/cached-inbox/messages?skip=2",
        ] {
            assert_eq!(
                fixture(vec![json!({"value": [], "@odata.nextLink": link})]).err(),
                Some(SyncError::UnsafeLink),
                "{link}"
            );
        }
    }

    #[test]
    fn pagination_follows_all_pages_and_detects_cycles() {
        const COUNT: usize = 20;
        let pages = || {
            (1..=COUNT).map(|n| if n < COUNT { json!({"value": [message(&format!("{n}"))], "@odata.nextLink": format!("{NEXT}{n}")}) }
                else { json!({"value": [message(&format!("{n}"))]}) }).collect::<Vec<_>>()
        };
        let batch = fixture(pages()).unwrap();
        assert_eq!(batch.pages, COUNT);
        assert_eq!(batch.messages.len(), COUNT);
        assert!(!batch.more_available);
        let mut cycle = pages();
        cycle[COUNT - 1]["@odata.nextLink"] = json!(format!("{NEXT}1"));
        assert_eq!(fixture(cycle).err(), Some(SyncError::RepeatedPage));
        let mut unsafe_last = pages();
        unsafe_last[COUNT - 1]["@odata.nextLink"] = json!("https://example.test/not-graph");
        assert_eq!(fixture(unsafe_last).err(), Some(SyncError::UnsafeLink));
    }

    #[test]
    fn invalid_or_oversized_pages_are_rejected_and_folder_ids_are_escaped() {
        for page in [
            json!({}),
            json!({"value": [{"id":"too-partial"}]}),
            json!({"value": vec![message("duplicate"); PAGE_SIZE + 1]}),
            json!({"value": [],"@odata.nextLink": 4}),
        ] {
            assert_eq!(fixture(vec![page]).err(), Some(SyncError::InvalidPage));
        }
        assert_eq!(
            fetch_inbox("id/+==", |url| {
                assert_eq!(url.path(), "/v1.0/me/mailFolders/id%2F+==/messages");
                assert!(url.query_pairs().any(|(k, v)| k == "$top" && v == "25"));
                Ok(vec![b' '; MAX_PAGE_BYTES + 1])
            })
            .err(),
            Some(SyncError::InvalidPage)
        );
    }

    #[test]
    fn transaction_rolls_back_whole_batch_when_attachment_write_fails() {
        let mut db = Connection::open_in_memory().unwrap();
        schema(&db);
        db.execute_batch("CREATE TRIGGER reject_attachment BEFORE INSERT ON message_attachment_status WHEN NEW.message_id = 2 BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").unwrap();
        let expected = snapshot(&db, 1).unwrap();
        assert_eq!(
            apply(
                &mut db,
                &expected,
                fixture(vec![json!({"value": [message("1"),message("2")]})]).unwrap()
            ),
            Err(SyncError::Workspace)
        );
        let count: i64 = db
            .query_row("SELECT count(*) FROM messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn concurrent_commit_rejects_stale_fetch_even_if_account_snapshot_matches() {
        for journal in ["DELETE", "WAL"] {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("fixture.db");
            let mut db = Connection::open(&path).unwrap();
            schema(&db);
            db.pragma_update(None, "journal_mode", journal).unwrap();
            let other = Connection::open(&path).unwrap();
            let expected = snapshot(&db, 1).unwrap();
            let batch = fixture(vec![json!({"value": [message("late")]})]).unwrap();
            other
                .execute(
                    "INSERT INTO provider_jobs VALUES(1,1,'mail',101,'delete',?,'pending')",
                    [r#"{"remote_id":"late"}"#],
                )
                .unwrap();
            assert_eq!(
                apply(&mut db, &expected, batch),
                Err(SyncError::WorkspaceChanged)
            );
            let count: i64 = db
                .query_row("SELECT count(*) FROM messages", [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0);
        }
    }

    #[test]
    fn missing_account_schema_and_cached_grant_fail_closed() {
        let db = Connection::open_in_memory().unwrap();
        assert!(matches!(
            snapshot(&db, 1),
            Err(SyncError::UnsupportedSchema)
        ));
        schema(&db);
        assert!(matches!(snapshot(&db, 3), Err(SyncError::Account)));
        assert!(cached_token(r#"{"expires_at":120,"access_token":"fixture"}"#, 0.0).is_err());
        assert!(cached_token(r#"{"expires_at":121,"access_token":" "}"#, 0.0).is_err());
    }
}
