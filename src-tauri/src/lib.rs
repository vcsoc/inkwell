use rusqlite::{Connection, OpenFlags, Result, Row, params};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

pub const SCHEMA: i64 = 22;
pub const PAGE_SIZE: u32 = 50;

#[derive(Debug)]
pub enum StoreError {
    Missing,
    Unsupported(i64),
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
            Self::Query(_) => write!(f, "Could not read the workspace. No data was modified."),
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
#[derive(Serialize)]
pub struct Contact {
    pub name: String,
    pub email: String,
    pub company: String,
}
#[derive(Serialize)]
pub struct Event {
    pub title: String,
    pub start: String,
    pub end: String,
    pub location: String,
}

impl Workspace {
    pub fn open(path: &Path) -> std::result::Result<Self, StoreError> {
        if !path.is_file() {
            return Err(StoreError::Missing);
        }
        // Do not use immutable=1: it can ignore changes in an existing SQLite WAL.
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        connection.busy_timeout(Duration::from_secs(4))?;
        connection.pragma_update(None, "query_only", true)?;
        connection.pragma_update(None, "trusted_schema", false)?;
        let version = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version != SCHEMA {
            return Err(StoreError::Unsupported(version));
        }
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
        let search: String = search.trim().chars().take(250).collect();
        let pattern = format!(
            "%{}%",
            search
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let destination =
            "CASE WHEN local_folder_override=1 THEN local_destination_id ELSE remote_folder_id END";
        let (clause, value) = match folder {
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
                format!("{destination}=CAST(?4 AS INTEGER) AND folder IN ('inbox','remote')"),
                Some(&folder[7..]),
            ),
            _ => ("folder=?4".into(), Some(folder)),
        };
        let filter = if search.is_empty() {
            ""
        } else {
            " AND (subject LIKE ?1 ESCAPE '\\' OR sender LIKE ?1 ESCAPE '\\' OR recipient LIKE ?1 ESCAPE '\\' OR body LIKE ?1 ESCAPE '\\')"
        };
        // Number the placeholders consistently, including optional search and folder parameters.
        let sql = format!(
            "SELECT id,sender,subject,date,unread,starred FROM messages WHERE {clause}{filter} ORDER BY date DESC,id DESC LIMIT ?2 OFFSET ?3"
        );
        let mut statement = self.0.prepare(&sql)?;
        let count = statement.parameter_count();
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
        let mut rows: Vec<MessageRow> = if count == 4 {
            statement
                .query_map(params![pattern, PAGE_SIZE + 1, offset, value], read)?
                .collect::<Result<_>>()?
        } else {
            statement
                .query_map(params![pattern, PAGE_SIZE + 1, offset], read)?
                .collect::<Result<_>>()?
        };
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
    pub fn contacts(&self) -> Result<Vec<Contact>> {
        self.collect(
            "SELECT name,email,company FROM contacts ORDER BY name COLLATE NOCASE,id LIMIT 1000",
            [],
            |r| {
                Ok(Contact {
                    name: r.get(0)?,
                    email: r.get(1)?,
                    company: r.get(2)?,
                })
            },
        )
    }
    pub fn events(&self) -> Result<Vec<Event>> {
        self.collect(
            "SELECT title,start,end,location FROM events ORDER BY start DESC,id DESC LIMIT 500",
            [],
            |r| {
                Ok(Event {
                    title: r.get(0)?,
                    start: r.get(1)?,
                    end: r.get(2)?,
                    location: r.get(3)?,
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
