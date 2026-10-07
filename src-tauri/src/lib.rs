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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // ── database ───────────────────────────────────────────────
            let data_dir = app.path().app_data_dir()?;
            let db = Db::open(&data_dir.join("plaudenote.db"))?;
            db.with(|c| db::notes::purge_trash_older_than(c, 30))?;
            db.with(db::recordings::fail_stale_jobs)?;
            app.manage(db);
            app.manage(Arc::new(Recorder::default()));
            app.manage(Arc::new(Stt::default()));
            app.manage(Arc::new(LlmServer::default()));

            // ── models ─────────────────────────────────────────────────
            let models = ModelManager::new(data_dir.join("models"))?;
            app.manage(Arc::new(models));

            // ── window chrome ──────────────────────────────────────────
            let window = app
                .get_webview_window("main")
                .expect("main window must exist");

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                )
                .expect("vibrancy is only supported on macOS 10.10+");
            }

            let _ = window;
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
