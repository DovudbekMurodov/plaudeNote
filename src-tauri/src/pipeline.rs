//! Background jobs: recording → transcript. One transcription at a time (the GPU
//! is shared), everything else waits in `queued`. Jobs can be cancelled.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

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

/// Shared job registry: concurrency limits + cancellation flags.
pub struct Jobs {
    pub stt: Arc<Semaphore>,
    pub llm: Arc<Semaphore>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for Jobs {
    fn default() -> Self {
        Self {
            stt: Arc::new(Semaphore::new(1)),
            llm: Arc::new(Semaphore::new(1)),
            cancels: Mutex::new(HashMap::new()),
        }
    }
}

impl Jobs {
    pub fn register(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(job_id.to_string(), Arc::clone(&flag));
        flag
    }
    pub fn finish(&self, job_id: &str) {
        self.cancels.lock().unwrap_or_else(|e| e.into_inner()).remove(job_id);
    }
    pub fn cancel(&self, job_id: &str) -> bool {
        match self.cancels.lock().unwrap_or_else(|e| e.into_inner()).get(job_id) {
            Some(f) => {
                f.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

pub fn emit_job(app: &AppHandle, ev: JobEvent) {
    let _ = app.emit(JOB_EVENT, ev);
}

struct Ctx {
    job_id: String,
    recording_id: String,
    note_id: Option<String>,
}

impl Ctx {
    fn ev(&self, status: &str, progress: f64, error: Option<String>) -> JobEvent {
        JobEvent {
            id: self.job_id.clone(),
            recording_id: self.recording_id.clone(),
            note_id: self.note_id.clone(),
            stage: "transcribe".into(),
            status: status.into(),
            progress,
            error,
        }
    }
}

/// Queue a transcription for `recording_id`. Returns the job id immediately.
pub fn start_transcription(app: AppHandle, recording_id: String, lang: String) -> AppResult<String> {
    let db = app.state::<Db>();
    let recording = db.with(|c| recordings::get_recording(c, &recording_id))?;
    let job = db.with(|c| recordings::insert_job(c, &recording_id, "transcribe"))?;
    db.with(|c| recordings::set_recording_lang(c, &recording_id, Some(&lang)))?;

    let ctx = Ctx {
        job_id: job.id.clone(),
        recording_id: recording_id.clone(),
        note_id: recording.note_id.clone(),
    };
    let jobs = Arc::clone(&*app.state::<Arc<Jobs>>());
    let cancel = jobs.register(&ctx.job_id);
    emit_job(&app, ctx.ev("queued", 0.0, None));

    let job_id = ctx.job_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = run(&app, &ctx, &jobs, cancel, recording.path.clone(), lang).await;
        jobs.finish(&ctx.job_id);
        let db = app.state::<Db>();
        match result {
            Ok(transcript) => {
                let _ = db.with(|c| recordings::update_job(c, &ctx.job_id, "done", 1.0, None));
                emit_job(&app, ctx.ev("done", 1.0, None));
                let _ = app.emit(
                    TRANSCRIPT_EVENT,
                    TranscriptEvent {
                        recording_id: ctx.recording_id.clone(),
                        note_id: ctx.note_id.clone(),
                        transcript,
                    },
                );
            }
            Err(AppError::Cancelled) => {
                let _ = db.with(|c| recordings::update_job(c, &ctx.job_id, "cancelled", 0.0, None));
                emit_job(&app, ctx.ev("cancelled", 0.0, None));
            }
            Err(e) => {
                let _ = db.with(|c| recordings::update_job(c, &ctx.job_id, "failed", 0.0, Some(&e.to_string())));
                emit_job(&app, ctx.ev("failed", 0.0, Some(e.to_string())));
            }
        }
    });

    Ok(job_id)
}

async fn run(
    app: &AppHandle,
    ctx: &Ctx,
    jobs: &Jobs,
    cancel: Arc<AtomicBool>,
    wav_path: String,
    lang: String,
) -> AppResult<Transcript> {
    // Wait for the GPU slot. Cancelling while queued just skips the work.
    let _permit = jobs.stt.acquire().await.map_err(|_| AppError::Other("job queue closed".into()))?;
    if cancel.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
    }

    let models = Arc::clone(&*app.state::<Arc<ModelManager>>());
    let general = models.ready_path(ModelKind::Stt);
    let stt = Arc::clone(&*app.state::<Arc<Stt>>());
    let wav = std::path::PathBuf::from(&wav_path);

    let db = app.state::<Db>();
    let _ = db.with(|c| recordings::update_job(c, &ctx.job_id, "running", 0.0, None));
    emit_job(app, ctx.ev("running", 0.0, None));

    // "auto": let the general model identify the language first, so a specialised
    // model (e.g. the Uzbek fine-tune) can take over when one is installed.
    // Whisper is confident on well-resourced languages (en/ar/ru ≈ 1.0) but hedges on
    // Uzbek (en 0.4, az 0.4 …), so low confidence or a Turkic guess both mean "try Uzbek".
    let mut lang = lang;
    if lang == "auto" {
        if let Some(g) = general.clone() {
            let stt2 = Arc::clone(&stt);
            let wav2 = wav.clone();
            if let Ok(Ok(probs)) = tauri::async_runtime::spawn_blocking(move || stt2.detect_language_probs(&g, &wav2)).await {
                if let Some((top, p)) = probs.first() {
                    let turkic = ["uz", "az", "tr", "kk", "ky", "tt", "tk", "ug", "ba"];
                    let candidate = if turkic.contains(&top.as_str()) || *p < 0.6 { "uz" } else { top.as_str() };
                    if models.ready_specialised(ModelKind::Stt, candidate).is_some() {
                        lang = candidate.to_string();
                    }
                }
            }
        }
    }
    let specialised = if lang == "auto" { None } else { models.ready_specialised(ModelKind::Stt, &lang) };
    let primer = specialised.is_none();
    let model_path = specialised
        .or(general.clone())
        .ok_or_else(|| AppError::Other("no speech model downloaded".into()))?;
    let model_name = model_path.file_name().map(|f| f.to_string_lossy().into_owned());
    let progress_app = app.clone();
    let pctx = Ctx {
        job_id: ctx.job_id.clone(),
        recording_id: ctx.recording_id.clone(),
        note_id: ctx.note_id.clone(),
    };
    let lang_for_task = lang.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        stt.transcribe_with(&model_path, &wav, &lang_for_task, primer, cancel, move |p| {
            emit_job(&progress_app, pctx.ev("running", (p as f64 / 100.0).clamp(0.0, 1.0), None));
        })
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;

    db.with(|c| {
        recordings::insert_transcript(
            c,
            &ctx.recording_id,
            res.lang_detected.as_deref(),
            &res.segments,
            &res.text,
            model_name.as_deref(),
        )
    })
}
