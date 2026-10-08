mod attachments;
mod audio;
mod commands;
mod db;
mod error;
mod llm;
mod models;
mod pipeline;
mod pipeline_ai;
mod stt;
mod system;

use tauri::Manager;

use std::sync::Arc;

use db::Db;
use models::ModelManager;
use audio::record::Recorder;
use stt::Stt;
use llm::LlmServer;

/// Everything that must exist before the first window is usable.
fn init(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // ── database ───────────────────────────────────────────────────────
    let data_dir = app.path().app_data_dir()?;
    let db = Db::open(&data_dir.join("plaudenote.db"))?;
    db.with(|c| db::notes::purge_trash_older_than(c, 30))?;
    db.with(db::recordings::fail_stale_jobs)?;
    app.manage(db);
    app.manage(Arc::new(Recorder::default()));
    app.manage(Arc::new(Stt::default()));
    app.manage(Arc::new(LlmServer::default()));
    app.manage(Arc::new(pipeline::Jobs::default()));

    // ── models ─────────────────────────────────────────────────────────
    let models = ModelManager::new(data_dir.join("models"))?;
    llm::kill_orphans(&models.root().join("runtime"));
    app.manage(Arc::new(models));

    // ── window chrome ──────────────────────────────────────────────────
    let window = app.get_webview_window("main").ok_or("main window must exist")?;
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        // Vibrancy is cosmetic — log and carry on if the OS refuses.
        if let Err(e) = apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, Some(NSVisualEffectState::Active), None) {
            eprintln!("vibrancy unavailable: {e}");
        }
    }
    let _ = window;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Never let a startup error become a panic inside AppKit's
            // didFinishLaunching (that aborts the process with a crash report).
            if let Err(e) = init(app) {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                app.dialog()
                    .message(format!("PlaudeNote could not start:\n\n{e}"))
                    .title("PlaudeNote")
                    .kind(MessageDialogKind::Error)
                    .blocking_show();
                std::process::exit(1);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::folders_list,
            commands::folder_create,
            commands::folder_rename,
            commands::folder_delete,
            commands::notes_list,
            commands::notes_counts,
            commands::note_get,
            commands::note_create,
            commands::note_save,
            commands::note_set_pinned,
            commands::note_set_lang,
            commands::note_move,
            commands::note_trash,
            commands::note_restore,
            commands::note_delete_forever,
            commands::trash_empty,
            attachments::attachment_save,
            commands::models_list,
            commands::models_dir,
            commands::model_download,
            commands::model_pause,
            commands::model_delete,
            commands::model_import_file,
            commands::system_info,
            commands::open_models_window,
            commands::reveal_models_dir,
            commands::recording_start,
            commands::recording_stop,
            commands::recording_cancel,
            commands::recording_is_active,
            commands::recording_import,
            commands::recordings_list,
            commands::transcribe_start,
            commands::transcript_get,
            commands::job_cancel,
            commands::pick_media_files,
            commands::attachment_import,
            commands::ai_note,
            commands::ai_task,
            commands::llm_status,
            commands::llm_stop,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<LlmServer>>().stop();
            }
        });
}
