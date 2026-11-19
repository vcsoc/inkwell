use crate::{StoreError, Workspace};
use rusqlite::{TransactionBehavior, params};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub struct ContactFields {
    pub name: String,
    pub email: String,
    pub company: String,
    pub notes: String,
}

#[derive(Serialize)]
pub struct Contact {
    pub id: i64,
    pub avatar: Option<String>,
    #[serde(flatten)]
    pub fields: ContactFields,
}

impl Workspace {
    pub fn contacts(&self) -> rusqlite::Result<Vec<Contact>> {
        self.collect(
            "SELECT id,name,email,company,notes,(SELECT value FROM settings WHERE key='inkwellr:avatar:'||contacts.id||':'||contacts.email) FROM contacts ORDER BY name COLLATE NOCASE,id",
            [],
            |row| {
                Ok(Contact {
                    id: row.get(0)?,
                    avatar: row.get(5)?,
                    fields: ContactFields {
                        name: row.get(1)?,
                        email: row.get(2)?,
                        company: row.get(3)?,
                        notes: row.get(4)?,
                    },
                })
            },
        )
    }

    pub fn save_contact(
        &mut self,
        id: Option<i64>,
        prior: Option<ContactFields>,
        mut fields: ContactFields,
    ) -> Result<i64, StoreError> {
        fields.name = fields.name.trim().to_owned();
        fields.email = fields.email.trim().to_owned();
        fields.company = fields.company.trim().to_owned();
        let valid_email = fields.email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && domain.contains('.')
                && domain.split('.').all(|label| {
                    !label.is_empty() && label.chars().all(|c| c.is_alphanumeric() || c == '-')
                })
        }) && !fields
            .email
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || "<>,;".contains(c));
        if fields.name.is_empty()
            || fields.name.chars().count() > 200
            || fields.email.chars().count() > 254
            || !valid_email
            || fields.company.chars().count() > 200
            || fields.notes.chars().count() > 10000
        {
            return Err(StoreError::Invalid(
                "Enter a name and a valid email address, and check the field lengths.",
            ));
        }
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = if let Some(id) = id {
            let prior = prior.ok_or(StoreError::Conflict)?;
            if tx.execute("UPDATE contacts SET name=?,email=?,company=?,notes=? WHERE id=? AND name=? AND email=? AND company=? AND notes=?",
                params![fields.name, fields.email, fields.company, fields.notes, id, prior.name, prior.email, prior.company, prior.notes])? != 1 {
                return Err(StoreError::Conflict);
            }
            if prior.email != fields.email {
                tx.execute(
                    "UPDATE OR REPLACE settings SET key=? WHERE key=?",
                    params![avatar_key(id, &fields.email), avatar_key(id, &prior.email)],
                )?;
            }
            id
        } else {
            tx.execute(
                "INSERT INTO contacts(name,email,company,notes) VALUES (?,?,?,?)",
                params![fields.name, fields.email, fields.company, fields.notes],
            )?;
            let id = tx.last_insert_rowid();
            tx.execute(
                "DELETE FROM settings WHERE key GLOB ?",
                [format!("inkwellr:avatar:{id}:*")],
            )?;
            id
        };
        let display = fields.name.split_whitespace().collect::<Vec<_>>().join(" ");
        tx.execute("INSERT INTO address_history(address,name,last_used) VALUES (?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(address) DO UPDATE SET address=excluded.address,name=excluded.name,last_used=excluded.last_used",
            params![fields.email, display])?;
        tx.commit()?;
        Ok(id)
    }

    pub fn delete_contact(&mut self, id: i64, prior: ContactFields) -> Result<(), StoreError> {
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "DELETE FROM contacts WHERE id=? AND name=? AND email=? AND company=? AND notes=?",
            params![id, prior.name, prior.email, prior.company, prior.notes],
        )? != 1
        {
            return Err(StoreError::Conflict);
        }
        tx.execute(
            "DELETE FROM settings WHERE key GLOB ?",
            [format!("inkwellr:avatar:{id}:*")],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn set_contact_avatar(
        &mut self,
        id: i64,
        email: &str,
        avatar: Option<String>,
    ) -> Result<(), StoreError> {
        if avatar.as_ref().is_some_and(|value| {
            value.len() > 150_000
                || !value
                    .strip_prefix("data:image/jpeg;base64,/9j/")
                    .is_some_and(|rest| {
                        !rest.is_empty()
                            && rest.bytes().all(|b| {
                                b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=')
                            })
                    })
        }) {
            return Err(StoreError::Invalid(
                "Choose a valid contact photo under the size limit.",
            ));
        }
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM contacts WHERE id=? AND email=?)",
            params![id, email],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(StoreError::Conflict);
        }
        let key = avatar_key(id, email);
        if let Some(value) = avatar {
            tx.execute(
                "INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)",
                params![key, value],
            )?;
        } else {
            tx.execute("DELETE FROM settings WHERE key=?", [key])?;
        }
        tx.commit()?;
        Ok(())
    }
}

fn avatar_key(id: i64, email: &str) -> String {
    format!("inkwellr:avatar:{id}:{email}")
}
