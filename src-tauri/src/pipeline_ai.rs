//! AI stage: transcript → structured note (and ad-hoc tasks) via llama-server.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::recordings;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::llm::prompts::{self, Task};
use crate::llm::{complete_json, LlmServer};
use crate::models::registry::ModelKind;
use crate::models::ModelManager;
use crate::pipeline::{JobEvent, JOB_EVENT};

pub const AI_EVENT: &str = "ai:ready";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiEvent {
    pub job_id: String,
    pub note_id: Option<String>,
    pub recording_id: Option<String>,
    pub task: String,
    pub lang: String,
    pub result: Value,
}

/// Resolve the model + runtime and bring the server up. Shared by all AI entry points.
async fn server_port(app: &AppHandle) -> AppResult<u16> {
    let models = Arc::clone(&*app.state::<Arc<ModelManager>>());
    let model = models
        .ready_path(ModelKind::Llm)
        .ok_or_else(|| AppError::Other("no language model downloaded".into()))?;
    let runtime = models
        .ready_path(ModelKind::Runtime)
        .ok_or_else(|| AppError::Other("llama.cpp runtime not downloaded".into()))?;
    let llm = Arc::clone(&*app.state::<Arc<LlmServer>>());
    llm.ensure(&runtime, &model).await
}

/// Keep prompts within context: ~4 chars/token, leave room for the answer.
fn clamp_input(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let head: String = s.chars().take(max_chars).collect();
    format!("{head}\n\n[… transcript truncated …]")
}

fn emit_job(app: &AppHandle, ev: JobEvent) {
    let _ = app.emit(JOB_EVENT, ev);
}

/// Structured note from a recording's transcript. Fire-and-forget; returns job id.
pub fn start_note_from_recording(app: AppHandle, note_id: String, recording_id: String) -> AppResult<String> {
    let db = app.state::<Db>();
    let transcript = db
        .with(|c| recordings::transcript_for_recording(c, &recording_id))?
        .ok_or_else(|| AppError::NotFound(format!("transcript for {recording_id}")))?;
    let recording = db.with(|c| recordings::get_recording(c, &recording_id))?;
    let job = db.with(|c| recordings::insert_job(c, &recording_id, "summarize"))?;
    let lang = transcript
        .lang_detected
        .clone()
        .or(recording.lang.clone())
        .filter(|l| l != "auto")
        .unwrap_or_else(|| "auto".into());

    let job_id = job.id.clone();
    spawn_task(
        app,
        job_id.clone(),
        Some(note_id),
        Some(recording_id),
        Task::Note,
        transcript.text,
        lang,
        None,
    );
    Ok(job_id)
}

/// Ad-hoc task on arbitrary text (AI menu). Returns job id; result arrives as `ai:ready`.
pub fn start_task(
    app: AppHandle,
    note_id: Option<String>,
    task: Task,
    text: String,
    lang: String,
    target_lang: Option<String>,
) -> AppResult<String> {
    let job_id = crate::db::new_id();
    spawn_task(app, job_id.clone(), note_id, None, task, text, lang, target_lang);
    Ok(job_id)
}

#[derive(Clone)]
struct JobCtx {
    job_id: String,
    recording_id: Option<String>,
    note_id: Option<String>,
}

impl JobCtx {
    fn ev(&self, status: &str, progress: f64, error: Option<String>) -> JobEvent {
        JobEvent {
            id: self.job_id.clone(),
            recording_id: self.recording_id.clone().unwrap_or_default(),
            note_id: self.note_id.clone(),
            stage: "summarize".into(),
            status: status.into(),
            progress,
            error,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn spawn_task(
    app: AppHandle,
    job_id: String,
    note_id: Option<String>,
    recording_id: Option<String>,
    task: Task,
    text: String,
    lang: String,
    target_lang: Option<String>,
) {
    let task_name = format!("{task:?}").to_lowercase();
    let ctx = JobCtx {
        job_id,
        recording_id,
        note_id,
    };
    emit_job(&app, ctx.ev("queued", 0.0, None));

    tauri::async_runtime::spawn(async move {
        let set_db = |status: &str, progress: f64, error: Option<&str>| {
            if ctx.recording_id.is_some() {
                let db = app.state::<Db>();
                let _ = db.with(|c| recordings::update_job(c, &ctx.job_id, status, progress, error));
            }
        };
        set_db("running", 0.05, None);
        emit_job(&app, ctx.ev("running", 0.05, None));

        let result: AppResult<Value> = async {
            let port = server_port(&app).await?;
            emit_job(&app, ctx.ev("running", 0.25, None));
            let prompt = prompts::build(task, &clamp_input(&text, 48_000), &lang, target_lang.as_deref());
            complete_json(port, &prompt.system, &prompt.user, &prompt.schema, prompt.max_tokens).await
        }
        .await;

        match result {
            Ok(value) => {
                set_db("done", 1.0, None);
                emit_job(&app, ctx.ev("done", 1.0, None));
                let _ = app.emit(
                    AI_EVENT,
                    AiEvent {
                        job_id: ctx.job_id.clone(),
                        note_id: ctx.note_id.clone(),
                        recording_id: ctx.recording_id.clone(),
                        task: task_name,
                        lang,
                        result: value,
                    },
                );
            }
            Err(e) => {
                set_db("failed", 0.0, Some(&e.to_string()));
                emit_job(&app, ctx.ev("failed", 0.0, Some(e.to_string())));
            }
        }
    });
}
