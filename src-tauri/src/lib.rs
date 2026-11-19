use rusqlite::{Connection, OpenFlags, Result, Row, params_from_iter, types::Value};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub mod calendar;
pub mod contacts;
pub mod drafts;
mod search;
pub mod vault;

pub const SCHEMA: i64 = 22;
pub const PAGE_SIZE: u32 = 50;

#[derive(Debug)]
pub enum StoreError {
    Missing,
    Unsupported(i64),
    Invalid(&'static str),
    Conflict,
    Query(rusqlite::Error),
}
impl From<rusqlite::Error> for StoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Query(value)
    }
}
impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => write!(
                f,
                "No existing inkwell.db was found. Set INKWELL_DATA_DIR to its workspace folder."
            ),
            Self::Unsupported(version) => write!(
                f,
                "This preview reads schema {SCHEMA}; the workspace is schema {version}. No migration was performed."
            ),
            Self::Query(rusqlite::Error::SqliteFailure(error, _))
                if matches!(
                    error.code,
                    rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
                ) =>
            {
                write!(f, "The workspace is busy. Try again shortly.")
            }
            Self::Invalid(error) => f.write_str(error),
            Self::Conflict => {
                f.write_str("This contact changed elsewhere. Refresh before editing it again.")
            }
            Self::Query(_) => f.write_str("Could not complete the workspace operation."),
        }
    }
}

pub fn workspace_database() -> Option<PathBuf> {
    let directory = std::env::var_os("INKWELL_DATA_DIR")
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".inkwell")))?;
    Some(directory.join("inkwell.db"))
}

pub struct Workspace(Connection);

#[derive(Default, serde::Deserialize)]
#[serde(default)]
pub struct MailFilters {
    pub unread: bool,
    pub starred: bool,
    pub from: Option<String>,
    pub to: Option<String>,
    pub oldest: bool,
}
impl MailFilters {
    pub fn valid(&self) -> bool {
        let valid = |date: &Option<String>| {
            date.as_ref().is_none_or(|value| {
                value.len() == 10 && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
            })
        };
        valid(&self.from)
            && valid(&self.to)
            && !matches!((&self.from,&self.to),(Some(a),Some(b)) if a>b)
    }
}

#[derive(Serialize)]
pub struct Folder {
    pub key: String,
    pub label: String,
    pub account: Option<String>,
}
#[derive(Serialize)]
pub struct MessageRow {
    pub id: i64,
    pub sender: String,
    pub subject: String,
    pub date: String,
    pub unread: bool,
    pub starred: bool,
}
#[derive(Serialize)]
pub struct MessagePage {
    pub rows: Vec<MessageRow>,
    pub more: bool,
}
#[derive(Serialize)]
pub struct Message {
    pub sender: String,
    pub recipient: String,
    pub subject: String,
    pub date: String,
    pub body: String,
}

impl Workspace {
    pub fn open(path: &Path) -> std::result::Result<Self, StoreError> {
        Self::connect(path, false)
    }

    pub fn open_for_contacts(path: &Path) -> std::result::Result<Self, StoreError> {
        Self::connect(path, true)
    }

    fn connect(path: &Path, write: bool) -> std::result::Result<Self, StoreError> {
        if !path.is_file() {
            return Err(StoreError::Missing);
        }
        // Do not use immutable=1: it can ignore changes in an existing SQLite WAL.
        let connection = Connection::open_with_flags(
            path,
            (if write {
                OpenFlags::SQLITE_OPEN_READ_WRITE
            } else {
                OpenFlags::SQLITE_OPEN_READ_ONLY
            }) | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(Duration::from_secs(4))?;
        connection.pragma_update(None, "query_only", !write)?;
        connection.pragma_update(None, "foreign_keys", true)?;
        connection.pragma_update(None, "trusted_schema", false)?;
        let version = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version != SCHEMA {
            return Err(StoreError::Unsupported(version));
        }
        search::register(&connection)?;
        Ok(Self(connection))
    }

    pub fn folders(&self) -> Result<Vec<Folder>> {
        let mut folders: Vec<_> = [
            ("inbox", "Inbox"),
            ("starred", "Starred"),
            ("sent", "Sent"),
            ("drafts", "Drafts"),
            ("archive", "Archive"),
            ("trash", "Trash"),
        ]
        .into_iter()
        .map(|(key, label)| Folder {
            key: key.into(),
            label: label.into(),
            account: None,
        })
        .collect();
        folders.extend(self.collect("SELECT 'local-'||id, name, 'Local folders' FROM local_folders ORDER BY name COLLATE NOCASE", [], folder_row)?);
        folders.extend(self.collect("SELECT 'remote:'||f.id, f.path, a.email FROM remote_folders f JOIN accounts a ON f.account_id=a.id ORDER BY a.email COLLATE NOCASE, f.path COLLATE NOCASE", [], folder_row)?);
        Ok(folders)
    }

    pub fn messages(&self, folder: &str, search: &str, offset: u32) -> Result<MessagePage> {
        self.scoped_messages(folder, search, offset, "folder")
    }

    pub fn scoped_messages(
        &self,
        folder: &str,
        search: &str,
        offset: u32,
        scope: &str,
    ) -> Result<MessagePage> {
        self.filtered_messages(folder, search, offset, scope, &MailFilters::default())
    }

    pub fn filtered_messages(
        &self,
        folder: &str,
        search: &str,
        offset: u32,
        scope: &str,
        filters: &MailFilters,
    ) -> Result<MessagePage> {
        let mut bindings: Vec<Value> = Vec::new();
        let mut cte = "";
        let destination =
            "CASE WHEN local_folder_override=1 THEN local_destination_id ELSE remote_folder_id END";
        let (mut clause, value) = match folder {
            "starred" => ("starred=1 AND folder!='trash'".into(), None),
            "archive" | "sent" => {
                let role = if folder == "archive" {
                    "archive"
                } else {
                    "sentitems"
                };
                (
                    format!(
                        "(folder='{folder}' OR (folder IN ('inbox','remote') AND {destination} IN (SELECT id FROM remote_folders WHERE well_known='{role}')))"
                    ),
                    None,
                )
            }
            _ if folder.starts_with("remote:") => (
                format!("{destination}=? AND folder IN ('inbox','remote')"),
                Some(
                    folder[7..]
                        .parse::<i64>()
                        .ok()
                        .map_or(Value::Null, Into::into),
                ),
            ),
            _ => ("folder=?".into(), Some(folder.to_owned().into())),
        };
        if scope == "all" {
            clause = "1".into();
        } else {
            if let Some(value) = value {
                bindings.push(value);
            }
            if scope == "subfolders" {
                let role = match folder {
                    "archive" => Some("archive"),
                    "sent" => Some("sentitems"),
                    "inbox" => Some("inbox"),
                    _ => None,
                };
                let remote = folder
                    .strip_prefix("remote:")
                    .and_then(|id| id.parse::<i64>().ok());
                cte = "WITH RECURSIVE tree(id,remote_id,account_id) AS (
                    SELECT id,remote_id,account_id FROM remote_folders WHERE id=? OR well_known=?
                    UNION SELECT c.id,c.remote_id,c.account_id FROM remote_folders c JOIN tree p
                      ON c.parent_remote_id=p.remote_id AND c.account_id=p.account_id
                  ), local(id) AS (
                    SELECT id FROM local_folders WHERE parent=? OR parent IN (SELECT 'remote:'||id FROM tree)
                    UNION SELECT c.id FROM local_folders c JOIN local p ON c.parent='local-'||p.id
                  ) ";
                clause = format!("({clause} OR ({destination} IN (SELECT id FROM tree) AND folder IN ('inbox','remote'))
                    OR folder IN (SELECT 'local-'||id FROM local))");
                bindings.splice(
                    0..0,
                    [
                        remote.map_or(Value::Null, Into::into),
                        role.map_or(Value::Null, |role| role.to_owned().into()),
                        folder.to_owned().into(),
                    ],
                );
            }
        }
        clause = format!("({clause})");
        search::append(search, &mut clause, &mut bindings);
        if filters.unread {
            clause.push_str(" AND unread=1");
        }
        if filters.starred {
            clause.push_str(" AND starred=1");
        }
        if let Some(date) = &filters.from {
            clause.push_str(" AND substr(date,1,10)>=?");
            bindings.push(date.clone().into());
        }
        if let Some(date) = &filters.to {
            clause.push_str(" AND substr(date,1,10)<=?");
            bindings.push(date.clone().into());
        }
        let order = if filters.oldest {
            "date ASC,id ASC"
        } else {
            "date DESC,id DESC"
        };
        bindings.extend([i64::from(PAGE_SIZE + 1).into(), i64::from(offset).into()]);
        let sql = format!(
            "{cte}SELECT id,sender,subject,date,unread,starred FROM messages WHERE {clause} ORDER BY {order} LIMIT ? OFFSET ?"
        );
        let mut statement = self.0.prepare(&sql)?;
        let read = |row: &Row<'_>| {
            Ok(MessageRow {
                id: row.get(0)?,
                sender: row.get(1)?,
                subject: row.get(2)?,
                date: row.get(3)?,
                unread: row.get(4)?,
                starred: row.get(5)?,
            })
        };
        let mut rows: Vec<MessageRow> = statement
            .query_map(params_from_iter(bindings), read)?
            .collect::<Result<_>>()?;
        let more = rows.len() > PAGE_SIZE as usize;
        rows.truncate(PAGE_SIZE as usize);
        Ok(MessagePage { rows, more })
    }

    pub fn message(&self, id: i64) -> Result<Message> {
        self.0.query_row(
            "SELECT sender,recipient,subject,date,body FROM messages WHERE id=?",
            [id],
            |r| {
                Ok(Message {
                    sender: r.get(0)?,
                    recipient: r.get(1)?,
                    subject: r.get(2)?,
                    date: r.get(3)?,
                    body: r.get(4)?,
                })
            },
        )
    }
    fn collect<T>(
        &self,
        sql: &str,
        args: impl rusqlite::Params,
        read: impl FnMut(&Row<'_>) -> Result<T>,
    ) -> Result<Vec<T>> {
        self.0.prepare(sql)?.query_map(args, read)?.collect()
    }
}
fn folder_row(row: &Row<'_>) -> Result<Folder> {
    Ok(Folder {
        key: row.get(0)?,
        label: row.get(1)?,
        account: row.get(2)?,
    })
}
