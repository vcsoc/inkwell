use inkwell_tauri::{Workspace, workspace_database};
use std::process::ExitCode;

fn main() -> ExitCode {
    match check() {
        Ok(()) => {
            println!(
                "Schema validated; folders, Inbox, Archive, Drafts, contacts, and events read successfully. No contents printed."
            );
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn check() -> Result<(), inkwell_tauri::StoreError> {
    let path = workspace_database().ok_or(inkwell_tauri::StoreError::Missing)?;
    let db = Workspace::open(&path)?;
    db.folders()?;
    for folder in ["inbox", "archive", "drafts"] {
        let page = db.messages(folder, "", 0)?;
        if let Some(first) = page.rows.first() {
            db.message(first.id)?;
        }
    }
    db.contacts()?;
    db.events()?;
    Ok(())
}
