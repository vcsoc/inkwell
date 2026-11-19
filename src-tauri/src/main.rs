#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use inkwell_tauri::{
    Folder, MailFilters, Message, MessagePage, StoreError, Workspace,
    calendar::{Event, EventFields},
    contacts::{Contact, ContactFields},
    drafts::{DraftFields, DraftVersion},
    workspace_database,
};

async fn read<T: Send + 'static>(
    operation: impl FnOnce(&Workspace) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = workspace_database().ok_or(StoreError::Missing)?;
        Ok::<_, StoreError>(operation(&Workspace::open(&path)?)?)
    })
    .await
    .map_err(|_| "Could not start a workspace read.".to_owned())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn folders() -> Result<Vec<Folder>, String> {
    read(Workspace::folders).await
}
#[tauri::command]
async fn messages(
    folder: String,
    search: String,
    offset: u32,
    scope: Option<String>,
    filters: Option<MailFilters>,
) -> Result<MessagePage, String> {
    let scope = scope.unwrap_or_else(|| "folder".into());
    if !matches!(scope.as_str(), "folder" | "subfolders" | "all") {
        return Err("Unknown search scope.".into());
    }
    let filters = filters.unwrap_or_default();
    if !filters.valid() {
        return Err("Check the mail filter dates.".into());
    }
    read(move |workspace| workspace.filtered_messages(&folder, &search, offset, &scope, &filters))
        .await
}
#[tauri::command]
async fn message(id: i64) -> Result<Message, String> {
    read(move |workspace| workspace.message(id)).await
}
#[tauri::command]
async fn contacts() -> Result<Vec<Contact>, String> {
    read(Workspace::contacts).await
}
async fn contact_write<T: Send + 'static>(
    operation: impl FnOnce(&mut Workspace) -> Result<T, StoreError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = workspace_database().ok_or(StoreError::Missing)?;
        operation(&mut Workspace::open_for_contacts(&path)?)
    })
    .await
    .map_err(|_| "Could not start the contact update.".to_owned())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
async fn save_contact(
    id: Option<i64>,
    prior: Option<ContactFields>,
    fields: ContactFields,
) -> Result<i64, String> {
    contact_write(move |workspace| workspace.save_contact(id, prior, fields)).await
}
#[tauri::command]
async fn delete_contact(id: i64, prior: ContactFields) -> Result<(), String> {
    contact_write(move |workspace| workspace.delete_contact(id, prior)).await
}
#[tauri::command]
async fn set_contact_avatar(id: i64, email: String, avatar: Option<String>) -> Result<(), String> {
    contact_write(move |workspace| workspace.set_contact_avatar(id, &email, avatar)).await
}
#[tauri::command]
async fn plain_draft(id: i64) -> Result<Option<(DraftVersion, DraftFields)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = workspace_database().ok_or(StoreError::Missing)?;
        Workspace::open(&path)?.plain_draft(id)
    })
    .await
    .map_err(|_| "Could not open the draft.".to_owned())?
    .map_err(|error| error.to_string())
}
#[tauri::command]
async fn save_draft(
    key: String,
    expected: Option<DraftVersion>,
    fields: DraftFields,
) -> Result<DraftVersion, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = workspace_database().ok_or(StoreError::Missing)?;
        Workspace::open_for_drafts(&path)?.save_draft(key, expected, fields)
    })
    .await
    .map_err(|_| "Could not save the draft.".to_owned())?
    .map_err(|error| error.to_string())
}
mod local_translation;

#[tauri::command]
async fn translate_draft(text: String, language: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || local_translation::translate(&text, &language))
        .await
        .map_err(|_| "Could not start local translation.".to_owned())?
        .map_err(str::to_owned)
}
#[tauri::command]
async fn draft_clipboard(text: Option<String>) -> Result<String, String> {
    static CLIPBOARD: std::sync::Mutex<Option<arboard::Clipboard>> = std::sync::Mutex::new(None);
    if text.as_ref().is_some_and(|value| value.len() > 2_000_000) {
        return Err("Clipboard selection is too large.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut active = CLIPBOARD.lock().map_err(|_| "Clipboard is unavailable.")?;
        if active.is_none() {
            *active = Some(arboard::Clipboard::new().map_err(|_| "Clipboard is unavailable.")?);
        }
        let Some(clipboard) = active.as_mut() else {
            return Err("Clipboard is unavailable.");
        };
        if let Some(text) = text {
            clipboard
                .set_text(text)
                .map_err(|_| "Could not copy text.")?;
            Ok(String::new())
        } else {
            clipboard
                .get_text()
                .map_err(|_| "No text is available to paste.")
        }
    })
    .await
    .map_err(|_| "Clipboard is unavailable.".to_owned())?
    .map_err(str::to_owned)
}
#[tauri::command]
async fn recent_sent_addresses() -> Result<Vec<[String; 3]>, String> {
    read(Workspace::recent_sent_addresses).await
}
#[tauri::command]
async fn delete_plain_draft(expected: DraftVersion) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = workspace_database().ok_or(StoreError::Missing)?;
        Workspace::open_for_drafts(&path)?.delete_plain_draft(expected)
    })
    .await
    .map_err(|_| "Could not delete the draft.".to_owned())?
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn events(start: Option<String>, end: Option<String>) -> Result<Vec<Event>, String> {
    read(move |workspace| workspace.events(start.as_deref(), end.as_deref())).await
}
async fn calendar_write<T: Send + 'static>(
    operation: impl FnOnce(&mut Workspace) -> Result<T, StoreError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = workspace_database().ok_or(StoreError::Missing)?;
        operation(&mut Workspace::open_for_calendar(&path)?)
    })
    .await
    .map_err(|_| "Could not start the calendar update.".to_owned())?
    .map_err(|e| e.to_string())
}
#[tauri::command]
async fn save_local_event(
    id: Option<i64>,
    prior: Option<EventFields>,
    fields: EventFields,
) -> Result<i64, String> {
    calendar_write(move |db| db.save_local_event(id, prior, fields)).await
}
#[tauri::command]
async fn delete_local_event(id: i64, prior: EventFields) -> Result<(), String> {
    calendar_write(move |db| db.delete_local_event(id, prior)).await
}

#[tauri::command]
async fn export_theme(
    window: tauri::WebviewWindow,
    format: String,
    contents: String,
) -> Result<bool, String> {
    use std::{fs::OpenOptions, io::Write};
    use tauri_plugin_dialog::DialogExt;

    if contents.len() > 16000 || !matches!(format.as_str(), "yaml" | "json") {
        return Err("Invalid theme export.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = window
            .dialog()
            .file()
            .set_parent(&window)
            .add_filter("Inkwell theme", &[&format])
            .set_file_name(format!("inkwell-theme.{format}"))
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|_| "Choose a local theme file.")?;
        // Never replace an existing file, even if the platform dialog permits it.
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    "A file with that name already exists. Pick a new name."
                } else {
                    "Could not create the theme file."
                }
            })?;
        file.write_all(contents.as_bytes())
            .map_err(|_| "Could not write the theme file.")?;
        Ok(true)
    })
    .await
    .map_err(|_| "Could not open the save dialog.".to_owned())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            folders,
            messages,
            message,
            contacts,
            save_contact,
            delete_contact,
            set_contact_avatar,
            plain_draft,
            save_draft,
            delete_plain_draft,
            draft_clipboard,
            translate_draft,
            recent_sent_addresses,
            events,
            save_local_event,
            delete_local_event,
            export_theme
        ])
        .run(tauri::generate_context!())
        .expect("could not launch inkwellr");
}
