#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use inkwell_tauri::{
    Event, Folder, Message, MessagePage, StoreError, Workspace,
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
) -> Result<MessagePage, String> {
    let scope = scope.unwrap_or_else(|| "folder".into());
    if !matches!(scope.as_str(), "folder" | "subfolders" | "all") {
        return Err("Unknown search scope.".into());
    }
    read(move |workspace| workspace.scoped_messages(&folder, &search, offset, &scope)).await
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
#[tauri::command]
async fn events() -> Result<Vec<Event>, String> {
    read(Workspace::events).await
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
            plain_draft,
            save_draft,
            events,
            export_theme
        ])
        .run(tauri::generate_context!())
        .expect("could not launch Inkwell Preview");
}
