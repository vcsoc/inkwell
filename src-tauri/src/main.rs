#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use inkwell_tauri::{
    Contact, Event, Folder, Message, MessagePage, StoreError, Workspace, workspace_database,
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
async fn messages(folder: String, search: String, offset: u32) -> Result<MessagePage, String> {
    read(move |workspace| workspace.messages(&folder, &search, offset)).await
}
#[tauri::command]
async fn message(id: i64) -> Result<Message, String> {
    read(move |workspace| workspace.message(id)).await
}
#[tauri::command]
async fn contacts() -> Result<Vec<Contact>, String> {
    read(Workspace::contacts).await
}
#[tauri::command]
async fn events() -> Result<Vec<Event>, String> {
    read(Workspace::events).await
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            folders, messages, message, contacts, events
        ])
        .run(tauri::generate_context!())
        .expect("could not launch Inkwell Preview");
}
