//! Background jobs: recording → transcript (M4), transcript → AI note (M5).

use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::recordings::{self, Transcript};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::models::registry::ModelKind;
use crate::models::ModelManager;
use crate::stt::Stt;

pub const JOB_EVENT: &str = "job:update";
pub const TRANSCRIPT_EVENT: &str = "transcript:ready";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JobEvent {
    pub id: String,
    pub recording_id: String,
    pub note_id: Option<String>,
    pub stage: String,
    pub status: String,
    pub progress: f64,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEvent {
    pub recording_id: String,
    pub note_id: Option<String>,
    pub transcript: Transcript,
}

fn emit_job(app: &AppHandle, ev: JobEvent) {
    let _ = app.emit(JOB_EVENT, ev);
}

/// Queue a transcription for `recording_id`. Returns the job id immediately.
pub fn start_transcription(app: AppHandle, recording_id: String, lang: String) -> AppResult<String> {
    let db = app.state::<Db>();
    let recording = db.with(|c| recordings::get_recording(c, &recording_id))?;
    let job = db.with(|c| recordings::insert_job(c, &recording_id, "transcribe"))?;
    db.with(|c| recordings::set_recording_lang(c, &recording_id, Some(&lang)))?;

    let models = Arc::clone(&*app.state::<Arc<ModelManager>>());
    let model_path = models
        .ready_path(ModelKind::Stt)
        .ok_or_else(|| AppError::Other("no speech model downloaded".into()));

    let job_id = job.id.clone();
    let note_id = recording.note_id.clone();
    emit_job(
        &app,
        JobEvent {
            id: job_id.clone(),
            recording_id: recording_id.clone(),
            note_id: note_id.clone(),
            stage: "transcribe".into(),
            status: "queued".into(),
            progress: 0.0,
            error: None,
        },
    );

    let model_path = match model_path {
        Ok(p) => p,
        Err(e) => {
            db.with(|c| recordings::update_job(c, &job_id, "failed", 0.0, Some(&e.to_string())))?;
            emit_job(
                &app,
                JobEvent {
                    id: job_id.clone(),
                    recording_id,
                    note_id,
                    stage: "transcribe".into(),
                    status: "failed".into(),
                    progress: 0.0,
                    error: Some(e.to_string()),
                },
            );
            return Err(e);
        }
    };

    let app2 = app.clone();
    let job_id2 = job_id.clone();
    tauri::async_runtime::spawn(async move {
        let app = app2;
        let db = app.state::<Db>();
        let _ = db.with(|c| recordings::update_job(c, &job_id2, "running", 0.0, None));
        emit_job(
            &app,
            JobEvent {
                id: job_id2.clone(),
                recording_id: recording_id.clone(),
                note_id: note_id.clone(),
                stage: "transcribe".into(),
                status: "running".into(),
                progress: 0.0,
                error: None,
            },
        );

        let stt = Arc::clone(&*app.state::<Arc<Stt>>());
        let wav = std::path::PathBuf::from(&recording.path);
        let progress_app = app.clone();
        let (pj, pr, pn) = (job_id2.clone(), recording_id.clone(), note_id.clone());
        let model_name = model_path.file_name().map(|f| f.to_string_lossy().into_owned());
        let lang_for_task = lang.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            stt.transcribe(&model_path, &wav, &lang_for_task, move |p| {
                emit_job(
                    &progress_app,
                    JobEvent {
                        id: pj.clone(),
                        recording_id: pr.clone(),
                        note_id: pn.clone(),
                        stage: "transcribe".into(),
                        status: "running".into(),
                        progress: (p as f64 / 100.0).clamp(0.0, 1.0),
                        error: None,
                    },
                );
            })
        })
        .await
        .map_err(|e| AppError::Other(e.to_string()))
        .and_then(|r| r);

        match result {
            Ok(res) => {
                let saved = db.with(|c| {
                    recordings::insert_transcript(
                        c,
                        &recording_id,
                        res.lang_detected.as_deref(),
                        &res.segments,
                        &res.text,
                        model_name.as_deref(),
                    )
                });
                match saved {
                    Ok(transcript) => {
                        let _ = db.with(|c| recordings::update_job(c, &job_id2, "done", 1.0, None));
                        emit_job(
                            &app,
                            JobEvent {
                                id: job_id2.clone(),
                                recording_id: recording_id.clone(),
                                note_id: note_id.clone(),
                                stage: "transcribe".into(),
                                status: "done".into(),
                                progress: 1.0,
                                error: None,
                            },
                        );
                        let _ = app.emit(
                            TRANSCRIPT_EVENT,
                            TranscriptEvent {
                                recording_id,
                                note_id,
                                transcript,
                            },
                        );
                    }
                    Err(e) => fail(&app, &job_id2, &recording_id, note_id, e),
                }
            }
            Err(e) => fail(&app, &job_id2, &recording_id, note_id, e),
        }
    });

    Ok(job_id)
}

fn fail(app: &AppHandle, job_id: &str, recording_id: &str, note_id: Option<String>, e: AppError) {
    let db = app.state::<Db>();
    let _ = db.with(|c| recordings::update_job(c, job_id, "failed", 0.0, Some(&e.to_string())));
    emit_job(
        app,
        JobEvent {
            id: job_id.to_string(),
            recording_id: recording_id.to_string(),
            note_id,
            stage: "transcribe".into(),
            status: "failed".into(),
            progress: 0.0,
            error: Some(e.to_string()),
        },
    );
}
