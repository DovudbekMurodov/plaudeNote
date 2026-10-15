//! AI stage: transcript → structured note (and ad-hoc tasks) via llama-server.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::recordings;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::llm::prompts::{self, Extra, Task};
use crate::llm::{complete_json, count_tokens, LlmServer, N_CTX};
use crate::models::registry::ModelKind;
use crate::models::ModelManager;
use crate::pipeline::{emit_job, JobEvent, Jobs};

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
    /// Echoed for `ask`, so the UI can show the question above the answer.
    pub question: Option<String>,
}

/// Resolve the model + runtime and bring the server up. Shared by all AI entry points.
async fn server_port(app: &AppHandle) -> AppResult<u16> {
    // Whisper is done by now; give its 0.5–1 GB back before the 3–6 GB language model loads.
    if let Some(stt) = app.try_state::<Arc<crate::stt::Stt>>() {
        stt.unload_all();
    }
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

/// Hard cap on input (~6 h of speech); anything longer is cut, not chunked further.
const MAX_INPUT_CHARS: usize = 600_000;
/// Tokens kept free for the chat template, grammar and rounding.
const CTX_MARGIN: u32 = 512;
/// A map-step chunk aims at this many tokens (≈ 15 min of speech): small
/// enough for a 4–9B model to stay accurate, big enough to keep the step count low.
const CHUNK_TOKENS: usize = 6_000;

fn clamp_input(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let head: String = s.chars().take(max_chars).collect();
    format!("{head}\n\n[… transcript truncated …]")
}

/// Split `text` into pieces of at most `max_chars` chars, preferring paragraph,
/// then sentence, then word boundaries.
fn split_chunks(text: &str, max_chars: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text.trim();
    while !rest.is_empty() {
        if rest.chars().count() <= max_chars {
            out.push(rest.to_string());
            break;
        }
        let hard: usize = rest.char_indices().nth(max_chars).map(|(i, _)| i).unwrap_or(rest.len());
        let window = &rest[..hard];
        let min = hard / 2;
        let cut = ["\n\n", "\n", ". ", "؟ ", "? ", "! ", "، ", ", ", " "]
            .iter()
            .find_map(|sep| window.rfind(sep).filter(|&i| i >= min).map(|i| i + sep.len()))
            .unwrap_or(hard);
        out.push(rest[..cut].trim().to_string());
        rest = rest[cut..].trim_start();
    }
    out.retain(|c| !c.is_empty());
    out
}

/// One completion; if the answer was cut by `max_tokens`, retry once with a
/// larger budget as long as it still fits the context.
async fn complete_fit(port: u16, prompt: &prompts::Prompt, prompt_tokens: usize) -> AppResult<Value> {
    match complete_json(port, &prompt.system, &prompt.user, &prompt.schema, prompt.max_tokens).await {
        Err(AppError::LlmTruncated) => {
            let room = N_CTX.saturating_sub(prompt_tokens as u32 + CTX_MARGIN);
            let bigger = (prompt.max_tokens * 2).min(room);
            if bigger <= prompt.max_tokens {
                return Err(AppError::LlmTruncated);
            }
            complete_json(port, &prompt.system, &prompt.user, &prompt.schema, bigger).await
        }
        r => r,
    }
}

/// Run `task` over `text`, chunking (map → reduce) when the input does not fit
/// the context window. `progress` gets 0..1 for the LLM phase.
async fn run_task(
    port: u16,
    task: Task,
    text: &str,
    lang: &str,
    target_lang: Option<&str>,
    extra: &Extra<'_>,
    progress: &(dyn Fn(f64) + Sync),
) -> AppResult<Value> {
    run_task_with(port, task, text, lang, target_lang, extra, CHUNK_TOKENS, progress).await
}

#[allow(clippy::too_many_arguments)]
async fn run_task_with(
    port: u16,
    task: Task,
    text: &str,
    lang: &str,
    target_lang: Option<&str>,
    extra: &Extra<'_>,
    chunk_tokens: usize,
    progress: &(dyn Fn(f64) + Sync),
) -> AppResult<Value> {
    let prompt = prompts::build(task, text, lang, target_lang, extra);
    let sys_tokens = count_tokens(port, &prompt.system).await?;
    let in_tokens = count_tokens(port, &prompt.user).await?;
    let fits = (sys_tokens + in_tokens) as u32 + prompt.max_tokens + CTX_MARGIN <= N_CTX;
    // Below ~2× a chunk, one shot over the raw transcript beats condensing first.
    if fits && in_tokens <= chunk_tokens * 2 {
        return complete_fit(port, &prompt, sys_tokens + in_tokens).await;
    }

    // Map: condense each part. Chunk size from the measured chars/token ratio.
    let chars = text.chars().count().max(1);
    let chars_per_token = chars as f64 / in_tokens.max(1) as f64;
    let chunk_chars = ((chunk_tokens as f64 * chars_per_token) as usize).max(200);
    let chunks = split_chunks(text, chunk_chars);
    let total = chunks.len();
    let mut notes: Vec<String> = Vec::with_capacity(total);
    for (i, chunk) in chunks.iter().enumerate() {
        let p = prompts::build_part(task, chunk, lang, target_lang, extra, i + 1, total);
        let ptoks = count_tokens(port, &p.user).await? + sys_tokens;
        let v = complete_fit(port, &p, ptoks).await?;
        let t = v["text"].as_str().unwrap_or("").trim().to_string();
        if !t.is_empty() {
            notes.push(t);
        }
        progress((i + 1) as f64 / (total + 1) as f64);
    }
    if task == Task::Translate {
        return Ok(serde_json::json!({ "text": notes.join("\n\n") }));
    }

    // Reduce: the real task over the joined notes (recursing if they are still too long).
    let mut joined = notes.join("\n\n");
    for _ in 0..3 {
        let p = prompts::build_from_notes(task, &joined, lang, target_lang, extra);
        let ptoks = count_tokens(port, &p.system).await? + count_tokens(port, &p.user).await?;
        if ptoks as u32 + p.max_tokens + CTX_MARGIN <= N_CTX {
            return complete_fit(port, &p, ptoks).await;
        }
        let parts = split_chunks(&joined, joined.chars().count() / 2 + 1);
        let mut again = Vec::new();
        for (i, part) in parts.iter().enumerate() {
            let pp = prompts::build_part(task, part, lang, target_lang, extra, i + 1, parts.len());
            let pt = count_tokens(port, &pp.user).await? + sys_tokens;
            let v = complete_fit(port, &pp, pt).await?;
            again.push(v["text"].as_str().unwrap_or("").trim().to_string());
        }
        joined = again.join("\n\n");
    }
    Err(AppError::Other("transcript too long to summarise".into()))
}

/// Structured note from a recording's transcript. Fire-and-forget; returns job id.
pub fn start_note_from_recording(
    app: AppHandle,
    note_id: String,
    recording_id: String,
    target_lang: Option<String>,
    instruction: Option<String>,
) -> AppResult<String> {
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
        target_lang.filter(|t| t != "auto" && !t.is_empty()),
        instruction,
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
    instruction: Option<String>,
    question: Option<String>,
) -> AppResult<String> {
    let job_id = crate::db::new_id();
    spawn_task(app, job_id.clone(), note_id, None, task, text, lang, target_lang, instruction, question);
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
    instruction: Option<String>,
    question: Option<String>,
) {
    let task_name = format!("{task:?}").to_lowercase();
    // Language the result is written in (headings/RTL on the UI side follow this).
    let out_lang = match (&target_lang, task) {
        (Some(t), _) if t != "auto" && !t.is_empty() => t.clone(),
        _ => lang.clone(),
    };
    let ctx = JobCtx {
        job_id,
        recording_id,
        note_id,
    };
    emit_job(&app, ctx.ev("queued", 0.0, None));
    let jobs = Arc::clone(&*app.state::<Arc<Jobs>>());
    let cancel = jobs.register(&ctx.job_id);

    tauri::async_runtime::spawn(async move {
        let set_db = |status: &str, progress: f64, error: Option<&str>| {
            if ctx.recording_id.is_some() {
                let db = app.state::<Db>();
                let _ = db.with(|c| recordings::update_job(c, &ctx.job_id, status, progress, error));
            }
        };

        let result: AppResult<Value> = async {
            let _permit = jobs.llm.acquire().await.map_err(|_| AppError::Other("job queue closed".into()))?;
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }
            set_db("running", 0.05, None);
            emit_job(&app, ctx.ev("running", 0.05, None));
            let port = server_port(&app).await?;
            let llm = Arc::clone(&*app.state::<Arc<LlmServer>>());
            let _lease = llm.lease();
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }
            emit_job(&app, ctx.ev("running", 0.25, None));
            let extra = Extra {
                instruction: instruction.as_deref(),
                question: question.as_deref(),
            };
            let input = clamp_input(&text, MAX_INPUT_CHARS);
            let app2 = app.clone();
            let ctx2 = ctx.clone();
            let on_progress = move |p: f64| emit_job(&app2, ctx2.ev("running", 0.25 + 0.7 * p, None));
            let request = run_task(port, task, &input, &lang, target_lang.as_deref(), &extra, &on_progress);
            let cancel2 = Arc::clone(&cancel);
            let watch = async move {
                loop {
                    if cancel2.load(std::sync::atomic::Ordering::Relaxed) {
                        return;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            };
            tokio::select! {
                r = request => r,
                _ = watch => Err(AppError::Cancelled),
            }
        }
        .await;
        jobs.finish(&ctx.job_id);

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
                        lang: out_lang,
                        result: value,
                        question: question.clone(),
                    },
                );
            }
            Err(AppError::Cancelled) => {
                set_db("cancelled", 0.0, None);
                emit_job(&app, ctx.ev("cancelled", 0.0, None));
            }
            Err(e) => {
                set_db("failed", 0.0, Some(&e.to_string()));
                emit_job(&app, ctx.ev("failed", 0.0, Some(e.to_string())));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_prefers_sentence_boundaries_and_covers_everything() {
        let text = "Birinchi gap. Ikkinchi gap juda uzun bo'ldi. Uchinchi gap.\n\nYangi abzats boshlandi. Oxirgi gap.";
        let chunks = split_chunks(text, 40);
        assert!(chunks.len() >= 3, "{chunks:?}");
        for c in &chunks {
            assert!(c.chars().count() <= 40, "{c:?}");
        }
        // Nothing lost: joining with spaces gives back every word in order.
        let words: Vec<&str> = text.split_whitespace().collect();
        let joined = chunks.join(" ");
        let got: Vec<&str> = joined.split_whitespace().collect();
        assert_eq!(words, got);
        // Short input stays whole.
        assert_eq!(split_chunks("qisqa", 40), vec!["qisqa".to_string()]);
    }

    #[test]
    fn split_handles_text_without_separators() {
        let text = "a".repeat(100);
        let chunks = split_chunks(&text, 30);
        assert_eq!(chunks.len(), 4);
        assert_eq!(chunks.concat(), text);
    }

    /// Real map → reduce over a long Uzbek transcript with a tiny chunk size.
    /// `PLAUDENOTE_TEST_RUNTIME=<dir> PLAUDENOTE_TEST_LLM=<gguf> PLAUDENOTE_TEST_TEXT=<txt> cargo test chunked -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn chunked_note_from_long_transcript() {
        let runtime = std::env::var("PLAUDENOTE_TEST_RUNTIME").expect("PLAUDENOTE_TEST_RUNTIME");
        let model = std::env::var("PLAUDENOTE_TEST_LLM").expect("PLAUDENOTE_TEST_LLM");
        let text = std::fs::read_to_string(std::env::var("PLAUDENOTE_TEST_TEXT").expect("PLAUDENOTE_TEST_TEXT")).unwrap();
        let text: String = text.chars().take(3000).collect();
        let server = LlmServer::default();
        let port = server.ensure(std::path::Path::new(&runtime), std::path::Path::new(&model)).await.expect("server up");
        let seen = std::sync::Mutex::new(Vec::new());
        let progress = |p: f64| seen.lock().unwrap().push(p);
        let t0 = std::time::Instant::now();
        let out = run_task_with(port, Task::Note, &text, "uz", None, &Extra::default(), 400, &progress)
            .await
            .expect("chunked note");
        println!("chunked note in {:?}, progress {:?}", t0.elapsed(), seen.lock().unwrap());
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
        assert!(seen.lock().unwrap().len() >= 2, "expected several map steps");
        assert!(out["title"].as_str().map(|s| !s.is_empty()).unwrap_or(false));
        assert!(out["summary"].as_str().map(|s| s.len() > 40).unwrap_or(false));
        server.stop();
    }
}
