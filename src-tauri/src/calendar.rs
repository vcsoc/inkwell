use crate::{StoreError, Workspace};
use rusqlite::{TransactionBehavior, params};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct Event {
    pub id: i64,
    #[serde(flatten)]
    pub fields: EventFields,
    pub editable: bool,
}

#[derive(Deserialize, Serialize)]
pub struct EventFields {
    pub title: String,
    pub start: String,
    pub end: String,
    pub location: String,
    pub notes: String,
    pub all_day: bool,
}

const LOCAL: &str = "provider_account_id IS NULL AND provider_event_id IS NULL AND provider_calendar_id IS NULL AND CASE WHEN json_valid(recurrence) THEN COALESCE(json_extract(recurrence,'$.frequency'),'none')='none' ELSE 0 END AND NOT EXISTS (SELECT 1 FROM settings WHERE key='provider_sync_account')";
const CONFLICT: &str = "This event changed or belongs to a connected calendar. Use the legacy app for connected or recurring events.";

impl Workspace {
    pub fn events(&self, start: Option<&str>, end: Option<&str>) -> rusqlite::Result<Vec<Event>> {
        let sql = format!(
            "SELECT id,title,start,end,location,notes,all_day,({LOCAL}) FROM events WHERE (provider_calendar_id IS NULL OR EXISTS (SELECT 1 FROM outlook_calendars WHERE id=events.provider_calendar_id AND selected=1 AND removed=0)) AND (?1 IS NULL OR substr(end,1,10)>=?1) AND (?2 IS NULL OR substr(start,1,10)<?2) ORDER BY start,id"
        );
        self.collect(&sql, params![start, end], |r| {
            Ok(Event {
                id: r.get(0)?,
                fields: EventFields {
                    title: r.get(1)?,
                    start: r.get(2)?,
                    end: r.get(3)?,
                    location: r.get(4)?,
                    notes: r.get(5)?,
                    all_day: r.get(6)?,
                },
                editable: r.get(7)?,
            })
        })
    }
    pub fn open_for_calendar(path: &std::path::Path) -> Result<Self, StoreError> {
        Self::connect(path, true)
    }
    pub fn save_local_event(
        &mut self,
        id: Option<i64>,
        prior: Option<EventFields>,
        fields: EventFields,
    ) -> Result<i64, StoreError> {
        use chrono::{Datelike, Duration, Utc};
        let parse = |value: &str| {
            if fields.all_day {
                chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
                    .ok()
                    .and_then(|day| day.and_hms_opt(0, 0, 0))
                    .map(|time| time.and_utc())
            } else {
                chrono::DateTime::parse_from_rfc3339(value)
                    .ok()
                    .map(|time| time.with_timezone(&Utc))
            }
        };
        let times = parse(&fields.start)
            .zip(parse(&fields.end))
            .filter(|(start, end)| {
                (1970..=2100).contains(&start.year())
                    && end > start
                    && *end - *start <= Duration::days(366)
            });
        let (start, end) = times.ok_or(StoreError::Invalid("Enter valid event dates, with an end after the start and a duration of at most 366 days."))?;
        let (start, end) = (start.to_rfc3339(), end.to_rfc3339());
        let title = fields.title.trim();
        if title.is_empty()
            || title.chars().count() > 200
            || fields.location.chars().count() > 500
            || fields.notes.chars().count() > 10000
        {
            return Err(StoreError::Invalid(
                "Enter a title and an end after the start, within the field limits.",
            ));
        }
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let id = if let Some(id) = id {
            let prior = prior.ok_or(StoreError::Invalid(CONFLICT))?;
            let sql = format!(
                "UPDATE events SET title=?,start=?,end=?,location=?,notes=?,all_day=?,timezone='UTC' WHERE id=? AND title=? AND start=? AND end=? AND location=? AND notes=? AND all_day=? AND ({LOCAL})"
            );
            if tx.execute(
                &sql,
                params![
                    title,
                    start,
                    end,
                    fields.location,
                    fields.notes,
                    fields.all_day,
                    id,
                    prior.title,
                    prior.start,
                    prior.end,
                    prior.location,
                    prior.notes,
                    prior.all_day
                ],
            )? != 1
            {
                return Err(StoreError::Invalid(CONFLICT));
            }
            id
        } else {
            if tx.execute("INSERT INTO events(title,start,end,location,notes,all_day,timezone) SELECT ?,?,?,?,?,?,'UTC' WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key='provider_sync_account')", params![title,start,end,fields.location,fields.notes,fields.all_day])? != 1 { return Err(StoreError::Invalid(CONFLICT)); }
            tx.last_insert_rowid()
        };
        tx.commit()?;
        Ok(id)
    }
    pub fn delete_local_event(&mut self, id: i64, prior: EventFields) -> Result<(), StoreError> {
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let sql = format!(
            "DELETE FROM events WHERE id=? AND title=? AND start=? AND end=? AND location=? AND notes=? AND all_day=? AND ({LOCAL})"
        );
        if tx.execute(
            &sql,
            params![
                id,
                prior.title,
                prior.start,
                prior.end,
                prior.location,
                prior.notes,
                prior.all_day
            ],
        )? != 1
        {
            return Err(StoreError::Invalid(CONFLICT));
        }
        tx.execute("DELETE FROM settings WHERE (key LIKE 'calendar-import:%' OR key LIKE 'calendar-reminder:%') AND CASE WHEN json_valid(value) THEN json_extract(value,'$.event_id') END=?", [id])?;
        tx.commit()?;
        Ok(())
    }
}
