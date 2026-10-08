//! llama.cpp `llama-server` sidecar: lifecycle + OpenAI-compatible client with
//! grammar-constrained JSON output.

pub mod prompts;

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::process::{Child, Command};

use crate::error::{AppError, AppResult};
use crate::models::find_file;

/// Context window we start `llama-server` with (per slot; we run a single slot).
/// Qwen3.5 / Gemma 4 use hybrid or sliding-window attention, so 32k costs
/// well under 1 GB of KV cache even on the 9B model.
pub const N_CTX: u32 = 32_768;

struct Running {
    child: Child,
    port: u16,
    model: PathBuf,
}

#[derive(Default)]
pub struct LlmServer {
    running: Mutex<Option<Running>>,
    /// Serialises start/stop so two jobs don't race to spawn.
    starting: tokio::sync::Mutex<()>,
}

#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LlmStatus {
    pub running: bool,
    pub model: Option<String>,
    pub port: Option<u16>,
}

fn free_port() -> AppResult<u16> {
    let l = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok(l.local_addr()?.port())
}

impl LlmServer {
    pub fn status(&self) -> LlmStatus {
        let g = self.running.lock().unwrap_or_else(|e| e.into_inner());
        LlmStatus {
            running: g.is_some(),
            model: g.as_ref().and_then(|r| r.model.file_name().map(|f| f.to_string_lossy().into_owned())),
            port: g.as_ref().map(|r| r.port),
        }
    }

    pub fn stop(&self) {
        let child = {
            let mut g = self.running.lock().unwrap_or_else(|e| e.into_inner());
            g.take().map(|r| r.child)
        };
        if let Some(mut child) = child {
            let _ = child.start_kill();
            // Wait briefly so the model file is actually released (delete/replace relies on it).
            let deadline = Instant::now() + Duration::from_secs(5);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }

    /// Stop only if the server currently serves `model`.
    pub fn stop_if_model(&self, model: &Path) {
        let serving = {
            let g = self.running.lock().unwrap_or_else(|e| e.into_inner());
            g.as_ref().map(|r| r.model == model).unwrap_or(false)
        };
        if serving {
            self.stop();
        }
    }

    /// Make sure a server is up for `model` (restarting if a different model is loaded). Returns the port.
    pub async fn ensure(&self, runtime_dir: &Path, model: &Path) -> AppResult<u16> {
        let _guard = self.starting.lock().await;

        // Already running the right model and healthy?
        let existing = {
            let mut g = self.running.lock().unwrap_or_else(|e| e.into_inner());
            match g.as_mut() {
                Some(r) if r.model == model => {
                    // If the child exited, drop it so we respawn.
                    match r.child.try_wait() {
                        Ok(Some(_)) => {
                            g.take();
                            None
                        }
                        _ => Some(r.port),
                    }
                }
                Some(_) => {
                    if let Some(mut r) = g.take() {
                        let _ = r.child.start_kill();
                    }
                    None
                }
                None => None,
            }
        };
        if let Some(port) = existing {
            if health(port).await {
                return Ok(port);
            }
            self.stop();
        }

        let bin = find_file(runtime_dir, "llama-server")
            .ok_or_else(|| AppError::Other("llama-server runtime not installed".into()))?;
        let port = free_port()?;
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let mut cmd = Command::new(&bin);
        cmd.arg("-m")
            .arg(model)
            .arg("--host")
            .arg("127.0.0.1")
            .arg("--port")
            .arg(port.to_string())
            .arg("-c")
            .arg(N_CTX.to_string())
            // One slot: the app serialises LLM jobs anyway, and llama-server's
            // auto `-np` would otherwise allocate 4 × N_CTX of KV cache.
            .arg("-np")
            .arg("1")
            .arg("-fa")
            .arg("on")
            .arg("-ngl")
            .arg("99")
            .arg("-t")
            .arg(threads.to_string())
            .arg("--jinja")
            .arg("--no-webui")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        // Dylibs live next to the binary; make sure the loader finds them even if rpath is odd.
        if let Some(dir) = bin.parent() {
            cmd.env("DYLD_LIBRARY_PATH", dir);
        }
        let child = cmd.spawn().map_err(|e| AppError::Other(format!("cannot start llama-server: {e}")))?;
        {
            let mut g = self.running.lock().unwrap_or_else(|e| e.into_inner());
            *g = Some(Running {
                child,
                port,
                model: model.to_path_buf(),
            });
        }

        // Model load can take a while (5 GB from disk).
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            if health(port).await {
                return Ok(port);
            }
            {
                let mut g = self.running.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(r) = g.as_mut() {
                    if let Ok(Some(status)) = r.child.try_wait() {
                        g.take();
                        return Err(AppError::Other(format!("llama-server exited early ({status})")));
                    }
                }
            }
            if Instant::now() > deadline {
                self.stop();
                return Err(AppError::Other("llama-server did not become healthy in time".into()));
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
    }
}

/// Kill `llama-server` processes left over from earlier app runs (a crashed or
/// force-quit app cannot run its cleanup, and the orphan keeps the model file —
/// and several GB of RAM — alive).
pub fn kill_orphans(runtime_dir: &Path) -> usize {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::Always));
    let me = sysinfo::get_current_pid().ok();
    let mut n = 0;
    for (pid, proc_) in sys.processes() {
        let ours = proc_.exe().map(|e| e.starts_with(runtime_dir)).unwrap_or(false);
        let is_server = proc_.name().to_string_lossy().contains("llama-server");
        if ours && is_server && proc_.parent() != me {
            if proc_.kill() {
                n += 1;
                eprintln!("killed orphan llama-server pid {pid}");
            }
        }
    }
    n
}

async fn health(port: u16) -> bool {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(2)).build();
    let Ok(client) = client else { return false };
    match client.get(format!("http://127.0.0.1:{port}/health")).send().await {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

/// Exact token count of `text` for the loaded model (`/tokenize`).
pub async fn count_tokens(port: u16, text: &str) -> AppResult<usize> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let v: Value = client
        .post(format!("http://127.0.0.1:{port}/tokenize"))
        .json(&json!({ "content": text, "add_special": false }))
        .send()
        .await
        .map_err(|e| AppError::Other(format!("tokenize failed: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::Other(format!("tokenize response: {e}")))?;
    Ok(v["tokens"].as_array().map(|a| a.len()).unwrap_or(0))
}

/// One grammar-constrained chat completion. Returns the parsed JSON object.
/// `AppError::LlmTruncated` when the model ran out of `max_tokens` mid-answer.
pub async fn complete_json(port: u16, system: &str, user: &str, schema: &Value, max_tokens: u32) -> AppResult<Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;
    let body = json!({
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
        "temperature": 0.3,
        "top_p": 0.9,
        "max_tokens": max_tokens,
        "stream": false,
        "chat_template_kwargs": { "enable_thinking": false },
        "reasoning_effort": "none",
        "response_format": { "type": "json_schema", "json_schema": { "name": "out", "schema": schema } }
    });
    let resp = client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("llm request failed: {e}")))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| AppError::Other(e.to_string()))?;
    if !status.is_success() {
        return Err(AppError::Other(format!("llm HTTP {status}: {}", text.chars().take(300).collect::<String>())));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| AppError::Other(format!("llm response not JSON: {e}")))?;
    if v["choices"][0]["finish_reason"].as_str() == Some("length") {
        return Err(AppError::LlmTruncated);
    }
    let content = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::Other("llm response missing content".into()))?;
    let content = strip_think(content);
    serde_json::from_str(content.trim()).map_err(|e| AppError::Other(format!("llm output not valid JSON: {e}")))
}

/// Some chat templates still leak `<think>…</think>`; drop it.
fn strip_think(s: &str) -> &str {
    if let Some(end) = s.find("</think>") {
        &s[end + "</think>".len()..]
    } else {
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `PLAUDENOTE_TEST_RUNTIME=<dir> PLAUDENOTE_TEST_LLM=<gguf> cargo test llm -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn structured_note_from_transcript() {
        let runtime = std::env::var("PLAUDENOTE_TEST_RUNTIME").expect("PLAUDENOTE_TEST_RUNTIME");
        let model = std::env::var("PLAUDENOTE_TEST_LLM").expect("PLAUDENOTE_TEST_LLM");
        let server = LlmServer::default();
        let t0 = Instant::now();
        let port = server.ensure(Path::new(&runtime), Path::new(&model)).await.expect("server up");
        println!("server on {port} after {:?}", t0.elapsed());

        let transcript = "Hello, this is a short test recording for the transcription pipeline. The meeting is on Friday at 3 o'clock. \
            Malika will finish the design by Thursday. Jasur handles the whisper integration next week. We decided to ship the first demo in October. \
            Last month we had 4 recordings, this month 7, and we expect 12 next month.";
        let prompt = prompts::build(prompts::Task::Note, transcript, "en", None, &prompts::Extra::default());
        let t1 = Instant::now();
        let out = complete_json(port, &prompt.system, &prompt.user, &prompt.schema, prompt.max_tokens).await.expect("completion");
        println!("completion in {:?}", t1.elapsed());
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
        assert!(out["title"].as_str().map(|s| !s.is_empty()).unwrap_or(false));
        assert!(out["mindmap"]["name"].as_str().is_some());
        assert!(out["action_items"].as_array().map(|a| !a.is_empty()).unwrap_or(false));
        server.stop();
    }
}
