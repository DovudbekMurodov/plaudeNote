//! Binary attachments (images now, audio later) live next to the database:
//! `<app_data>/attachments/<uuid>.<ext>`. The webview loads them through the
//! asset protocol (`convertFileSrc`), so nothing is embedded in note JSON.

use base64::Engine;
use tauri::{AppHandle, Manager};

use crate::db::new_id;
use crate::error::{AppError, AppResult};

pub fn attachments_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app.path().app_data_dir()?.join("attachments");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// `data` is base64 (no data-URL prefix). Returns the absolute file path.
#[tauri::command]
pub fn attachment_save(app: AppHandle, data: String, ext: String) -> AppResult<String> {
    let ext: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_lowercase();
    if ext.is_empty() {
        return Err(AppError::Other("missing file extension".into()));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.as_bytes())
        .map_err(|e| AppError::Other(format!("bad base64: {e}")))?;
    let path = attachments_dir(&app)?.join(format!("{}.{ext}", new_id()));
    std::fs::write(&path, bytes)?;
    Ok(path.to_string_lossy().into_owned())
}
