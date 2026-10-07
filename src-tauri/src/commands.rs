//! Tauri commands: thin wrappers over `db::*`. Keep logic out of here so the
//! LAN server (M6) can reuse the same functions.

use tauri::State;

use crate::db::folders::{self, Folder};
use crate::db::notes::{self, Counts, Filter, NoteFull, NoteSummary, SaveNote};
use crate::db::Db;
use crate::error::{AppError, AppResult};

#[derive(serde::Serialize)]
pub struct AppInfo {
    version: &'static str,
    os: &'static str,
    arch: &'static str,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

// ── folders ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn folders_list(db: State<'_, Db>) -> AppResult<Vec<Folder>> {
    db.with(folders::list)
}

#[tauri::command]
pub fn folder_create(db: State<'_, Db>, name: String) -> AppResult<Folder> {
    db.with(|c| folders::create(c, &name))
}

#[tauri::command]
pub fn folder_rename(db: State<'_, Db>, id: String, name: String) -> AppResult<()> {
    db.with(|c| folders::rename(c, &id, &name))
}

#[tauri::command]
pub fn folder_delete(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.with(|c| folders::delete(c, &id))
}

// ── notes ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn notes_list(db: State<'_, Db>, folder: String, query: Option<String>) -> AppResult<Vec<NoteSummary>> {
    db.with(|c| notes::list(c, Filter::parse(&folder), query.as_deref()))
}

#[tauri::command]
pub fn notes_counts(db: State<'_, Db>) -> AppResult<Counts> {
    db.with(notes::counts)
}

#[tauri::command]
pub fn note_get(db: State<'_, Db>, id: String) -> AppResult<NoteFull> {
    db.with(|c| notes::get(c, &id))
}

#[tauri::command]
pub fn note_create(db: State<'_, Db>, folder_id: Option<String>, lang: Option<String>) -> AppResult<NoteFull> {
    db.with(|c| notes::create(c, folder_id.as_deref(), lang.as_deref().unwrap_or("uz")))
}

#[tauri::command]
pub fn note_save(db: State<'_, Db>, note: SaveNote) -> AppResult<String> {
    db.with(|c| notes::save(c, &note))
}

#[tauri::command]
pub fn note_set_pinned(db: State<'_, Db>, id: String, pinned: bool) -> AppResult<()> {
    db.with(|c| notes::set_pinned(c, &id, pinned))
}

#[tauri::command]
pub fn note_set_lang(db: State<'_, Db>, id: String, lang: String) -> AppResult<()> {
    db.with(|c| notes::set_lang(c, &id, &lang))
}

#[tauri::command]
pub fn note_move(db: State<'_, Db>, id: String, folder_id: Option<String>) -> AppResult<()> {
    db.with(|c| notes::move_to(c, &id, folder_id.as_deref()))
}

#[tauri::command]
pub fn note_trash(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.with(|c| notes::trash(c, &id))
}

#[tauri::command]
pub fn note_restore(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.with(|c| notes::restore(c, &id))
}

#[tauri::command]
pub fn note_delete_forever(db: State<'_, Db>, id: String) -> AppResult<()> {
    db.with(|c| notes::delete_forever(c, &id))
}

#[tauri::command]
pub fn trash_empty(db: State<'_, Db>) -> AppResult<usize> {
    db.with(notes::empty_trash)
}

// ── models ─────────────────────────────────────────────────────────────────

use std::sync::Arc;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::models::{ModelInfo, ModelManager};
use crate::system::{system_info as sys_info, SystemInfo};

#[tauri::command]
pub fn models_list(models: State<'_, Arc<ModelManager>>) -> Vec<ModelInfo> {
    models.list()
}

#[tauri::command]
pub fn models_dir(models: State<'_, Arc<ModelManager>>) -> String {
    models.root().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn model_download(app: AppHandle, models: State<'_, Arc<ModelManager>>, id: String) -> AppResult<()> {
    models.start_download(app, &id)
}

#[tauri::command]
pub fn model_pause(models: State<'_, Arc<ModelManager>>, id: String) -> AppResult<()> {
    models.pause(&id)
}

#[tauri::command]
pub fn model_delete(models: State<'_, Arc<ModelManager>>, id: String) -> AppResult<()> {
    models.delete(&id)
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    sys_info()
}

#[tauri::command]
pub fn open_models_window(app: AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window("models") {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(&app, "models", WebviewUrl::App("models.html".into()))
        .title("Models")
        .inner_size(640.0, 700.0)
        .min_inner_size(520.0, 480.0)
        .resizable(true);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    builder.build()?;
    Ok(())
}

#[tauri::command]
pub fn reveal_models_dir(models: State<'_, Arc<ModelManager>>) -> AppResult<()> {
    let dir = models.root().to_string_lossy().into_owned();
    std::process::Command::new("open").arg(dir).spawn()?;
    Ok(())
}

// ── recording / transcription ──────────────────────────────────────────────

use crate::audio::record::Recorder;
use crate::db::recordings::{self, Recording, Transcript};
use crate::pipeline;

fn recordings_dir(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    let dir = app.path().app_data_dir()?.join("recordings");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStarted {
    pub id: String,
    pub path: String,
}

#[tauri::command]
pub fn recording_start(app: AppHandle, recorder: State<'_, Arc<Recorder>>) -> AppResult<RecordingStarted> {
    let id = crate::db::new_id();
    let path = recordings_dir(&app)?.join(format!("{id}.wav"));
    recorder.start(app.clone(), &path)?;
    Ok(RecordingStarted {
        id,
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn recording_stop(
    recorder: State<'_, Arc<Recorder>>,
    db: State<'_, Db>,
    note_id: Option<String>,
    lang: Option<String>,
) -> AppResult<Recording> {
    let res = recorder.stop()?;
    db.with(|c| {
        recordings::insert_recording(
            c,
            note_id.as_deref(),
            &res.path.to_string_lossy(),
            res.duration_ms,
            lang.as_deref(),
            "mic",
        )
    })
}

#[tauri::command]
pub fn recording_cancel(recorder: State<'_, Arc<Recorder>>) -> AppResult<()> {
    recorder.cancel()
}

#[tauri::command]
pub fn recording_is_active(recorder: State<'_, Arc<Recorder>>) -> bool {
    recorder.is_recording()
}

/// Decode an audio file the user picked and register it as a recording.
#[tauri::command]
pub async fn recording_import(app: AppHandle, path: String, note_id: Option<String>, lang: Option<String>) -> AppResult<Recording> {
    let id = crate::db::new_id();
    let dest = recordings_dir(&app)?.join(format!("{id}.wav"));
    let src = std::path::PathBuf::from(&path);
    let dest2 = dest.clone();
    let duration = tauri::async_runtime::spawn_blocking(move || crate::audio::decode::decode_to_wav(&src, &dest2))
        .await
        .map_err(|e| AppError::Other(e.to_string()))??;
    let db = app.state::<Db>();
    db.with(|c| {
        recordings::insert_recording(c, note_id.as_deref(), &dest.to_string_lossy(), duration, lang.as_deref(), "upload")
    })
}

#[tauri::command]
pub fn recordings_list(db: State<'_, Db>, note_id: String) -> AppResult<Vec<Recording>> {
    db.with(|c| recordings::recordings_for_note(c, &note_id))
}

#[tauri::command]
pub fn transcribe_start(app: AppHandle, recording_id: String, lang: Option<String>) -> AppResult<String> {
    pipeline::start_transcription(app, recording_id, lang.unwrap_or_else(|| "auto".into()))
}

#[tauri::command]
pub fn transcript_get(db: State<'_, Db>, recording_id: String) -> AppResult<Option<Transcript>> {
    db.with(|c| recordings::transcript_for_recording(c, &recording_id))
}

// ── AI ─────────────────────────────────────────────────────────────────────

use crate::llm::prompts::Task;
use crate::llm::{LlmServer, LlmStatus};
use crate::pipeline_ai;

#[tauri::command]
pub fn ai_note(app: AppHandle, note_id: String, recording_id: String) -> AppResult<String> {
    pipeline_ai::start_note_from_recording(app, note_id, recording_id)
}

#[tauri::command]
pub fn ai_task(
    app: AppHandle,
    note_id: Option<String>,
    task: Task,
    text: String,
    lang: Option<String>,
    target_lang: Option<String>,
) -> AppResult<String> {
    pipeline_ai::start_task(app, note_id, task, text, lang.unwrap_or_else(|| "auto".into()), target_lang)
}

#[tauri::command]
pub fn llm_status(llm: State<'_, Arc<LlmServer>>) -> LlmStatus {
    llm.status()
}

#[tauri::command]
pub fn llm_stop(llm: State<'_, Arc<LlmServer>>) {
    llm.stop()
}
