//! Model download manager: resumable HTTP downloads into
//! `<app_data>/models/<kind>/`, progress events to the webview, archives unpacked.

pub mod registry;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};
use registry::{ModelKind, ModelSpec, REGISTRY};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Missing,
    Downloading,
    Paused,
    Extracting,
    Ready,
    Error,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    #[serde(flatten)]
    pub spec: ModelSpec,
    pub status: Status,
    pub downloaded_bytes: u64,
    pub bytes_per_sec: f64,
    pub error: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub id: String,
    pub status: Status,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub bytes_per_sec: f64,
    pub error: Option<String>,
}

pub const PROGRESS_EVENT: &str = "model:progress";

#[derive(Clone)]
struct Live {
    cancel: Arc<AtomicBool>,
    downloaded: u64,
    bps: f64,
    status: Status,
    error: Option<String>,
}

pub struct ModelManager {
    root: PathBuf,
    live: Mutex<HashMap<String, Live>>,
}

impl ModelManager {
    pub fn new(root: PathBuf) -> AppResult<Self> {
        for kind in [ModelKind::Stt, ModelKind::Llm, ModelKind::Runtime] {
            std::fs::create_dir_all(root.join(kind.dir_name()))?;
        }
        Ok(Self {
            root,
            live: Mutex::new(HashMap::new()),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Final on-disk location: a file, or a directory for archives.
    pub fn target_path(&self, spec: &ModelSpec) -> PathBuf {
        self.root.join(spec.kind.dir_name()).join(spec.file)
    }

    fn part_path(&self, spec: &ModelSpec) -> PathBuf {
        self.root.join(spec.kind.dir_name()).join(format!("{}.part", spec.id))
    }

    pub fn is_ready(&self, spec: &ModelSpec) -> bool {
        let p = self.target_path(spec);
        if spec.archive {
            p.is_dir()
        } else {
            p.metadata().map(|m| m.len() == spec.size).unwrap_or(false)
        }
    }

    /// First ready model of a kind, preferring the registry order.
    pub fn ready_path(&self, kind: ModelKind) -> Option<PathBuf> {
        REGISTRY
            .iter()
            .filter(|s| s.kind == kind && self.is_ready(s))
            .map(|s| self.target_path(s))
            .next()
    }

    pub fn list(&self) -> Vec<ModelInfo> {
        let live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        REGISTRY
            .iter()
            .map(|spec| {
                let mut info = ModelInfo {
                    spec: spec.clone(),
                    status: Status::Missing,
                    downloaded_bytes: 0,
                    bytes_per_sec: 0.0,
                    error: None,
                    path: None,
                };
                if let Some(l) = live.get(spec.id) {
                    info.status = l.status;
                    info.downloaded_bytes = l.downloaded;
                    info.bytes_per_sec = l.bps;
                    info.error = l.error.clone();
                } else if self.is_ready(spec) {
                    info.status = Status::Ready;
                    info.downloaded_bytes = spec.size;
                    info.path = Some(self.target_path(spec).to_string_lossy().into_owned());
                } else if let Ok(m) = self.part_path(spec).metadata() {
                    info.status = Status::Paused;
                    info.downloaded_bytes = m.len();
                }
                info
            })
            .collect()
    }

    pub fn pause(&self, id: &str) -> AppResult<()> {
        let live = self.live.lock().unwrap_or_else(|e| e.into_inner());
        match live.get(id) {
            Some(l) => {
                l.cancel.store(true, Ordering::Relaxed);
                Ok(())
            }
            None => Err(AppError::NotFound(format!("no active download for {id}"))),
        }
    }

    pub fn delete(&self, id: &str) -> AppResult<()> {
        let spec = registry::find(id).ok_or_else(|| AppError::NotFound(format!("model {id}")))?;
        if let Some(l) = self.live.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
            l.cancel.store(true, Ordering::Relaxed);
        }
        let target = self.target_path(spec);
        if target.is_dir() {
            std::fs::remove_dir_all(&target)?;
        } else if target.exists() {
            std::fs::remove_file(&target)?;
        }
        let part = self.part_path(spec);
        if part.exists() {
            std::fs::remove_file(part)?;
        }
        Ok(())
    }

    fn set_live(&self, id: &str, f: impl FnOnce(&mut Live)) {
        if let Some(l) = self.live.lock().unwrap_or_else(|e| e.into_inner()).get_mut(id) {
            f(l);
        }
    }

    fn snapshot(&self, id: &str) -> Option<Live> {
        self.live.lock().unwrap_or_else(|e| e.into_inner()).get(id).cloned()
    }

    fn emit(&self, app: &AppHandle, spec: &ModelSpec) {
        let Some(l) = self.snapshot(spec.id) else { return };
        let _ = app.emit(
            PROGRESS_EVENT,
            ProgressEvent {
                id: spec.id.to_string(),
                status: l.status,
                downloaded_bytes: l.downloaded,
                total_bytes: spec.size,
                bytes_per_sec: l.bps,
                error: l.error,
            },
        );
    }

    fn emit_final(&self, app: &AppHandle, spec: &ModelSpec, status: Status, downloaded: u64, error: Option<String>) {
        let _ = app.emit(
            PROGRESS_EVENT,
            ProgressEvent {
                id: spec.id.to_string(),
                status,
                downloaded_bytes: downloaded,
                total_bytes: spec.size,
                bytes_per_sec: 0.0,
                error,
            },
        );
    }

    /// Starts (or resumes) a download in the background. Returns immediately.
    pub fn start_download(self: &Arc<Self>, app: AppHandle, id: &str) -> AppResult<()> {
        let spec = registry::find(id).ok_or_else(|| AppError::NotFound(format!("model {id}")))?;
        if self.is_ready(spec) {
            return Ok(());
        }
        {
            let mut live = self.live.lock().unwrap_or_else(|e| e.into_inner());
            if live.get(id).map(|l| l.status == Status::Downloading || l.status == Status::Extracting).unwrap_or(false) {
                return Ok(());
            }
            live.insert(
                id.to_string(),
                Live {
                    cancel: Arc::new(AtomicBool::new(false)),
                    downloaded: self.part_path(spec).metadata().map(|m| m.len()).unwrap_or(0),
                    bps: 0.0,
                    status: Status::Downloading,
                    error: None,
                },
            );
        }
        self.emit(&app, spec);

        let mgr = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let result = mgr.run_download(&app, spec).await;
            let downloaded = mgr.snapshot(spec.id).map(|l| l.downloaded).unwrap_or(0);
            let cancelled = mgr
                .snapshot(spec.id)
                .map(|l| l.cancel.load(Ordering::Relaxed))
                .unwrap_or(false);
            mgr.live.lock().unwrap_or_else(|e| e.into_inner()).remove(spec.id);
            match result {
                Ok(()) => mgr.emit_final(&app, spec, Status::Ready, spec.size, None),
                Err(_) if cancelled => mgr.emit_final(&app, spec, Status::Paused, downloaded, None),
                Err(e) => mgr.emit_final(&app, spec, Status::Error, downloaded, Some(e.to_string())),
            }
        });
        Ok(())
    }

    async fn run_download(&self, app: &AppHandle, spec: &ModelSpec) -> AppResult<()> {
        let part = self.part_path(spec);
        let mut downloaded = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);
        if downloaded > spec.size {
            tokio::fs::remove_file(&part).await?;
            downloaded = 0;
        }

        let client = reqwest::Client::builder()
            .user_agent(concat!("PlaudeNote/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| AppError::Other(e.to_string()))?;

        if downloaded < spec.size {
            let mut req = client.get(spec.url);
            if downloaded > 0 {
                req = req.header(reqwest::header::RANGE, format!("bytes={downloaded}-"));
            }
            let resp = req.send().await.map_err(|e| AppError::Other(format!("request failed: {e}")))?;
            let status = resp.status();
            if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                tokio::fs::remove_file(&part).await.ok();
                return Err(AppError::Other("server rejected resume; retry".into()));
            }
            if !status.is_success() {
                return Err(AppError::Other(format!("HTTP {status}")));
            }
            // Server ignored the Range header → start over.
            if downloaded > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT {
                downloaded = 0;
            }

            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .append(downloaded > 0)
                .truncate(downloaded == 0)
                .open(&part)
                .await?;

            let cancel = self
                .snapshot(spec.id)
                .map(|l| l.cancel)
                .ok_or_else(|| AppError::Other("download state vanished".into()))?;
            let mut stream = resp.bytes_stream();
            let mut last_emit = Instant::now();
            let mut window_start = Instant::now();
            let mut window_bytes: u64 = 0;

            while let Some(chunk) = stream.next().await {
                if cancel.load(Ordering::Relaxed) {
                    file.flush().await?;
                    return Err(AppError::Other("paused".into()));
                }
                let chunk = chunk.map_err(|e| AppError::Other(format!("stream error: {e}")))?;
                file.write_all(&chunk).await?;
                downloaded += chunk.len() as u64;
                window_bytes += chunk.len() as u64;

                if last_emit.elapsed().as_millis() >= 250 {
                    let secs = window_start.elapsed().as_secs_f64().max(0.001);
                    let bps = window_bytes as f64 / secs;
                    self.set_live(spec.id, |l| {
                        l.downloaded = downloaded;
                        l.bps = bps;
                    });
                    self.emit(app, spec);
                    last_emit = Instant::now();
                    if secs > 2.0 {
                        window_start = Instant::now();
                        window_bytes = 0;
                    }
                }
            }
            file.flush().await?;
        }

        let got = tokio::fs::metadata(&part).await?.len();
        if got != spec.size {
            tokio::fs::remove_file(&part).await.ok();
            return Err(AppError::Other(format!("size mismatch: got {got}, expected {}", spec.size)));
        }

        let target = self.target_path(spec);
        if spec.archive {
            self.set_live(spec.id, |l| {
                l.status = Status::Extracting;
                l.downloaded = spec.size;
            });
            self.emit(app, spec);
            let part2 = part.clone();
            let target2 = target.clone();
            tauri::async_runtime::spawn_blocking(move || unpack_tar_gz(&part2, &target2))
                .await
                .map_err(|e| AppError::Other(e.to_string()))??;
            tokio::fs::remove_file(&part).await.ok();
        } else {
            tokio::fs::rename(&part, &target).await?;
        }
        Ok(())
    }
}

fn unpack_tar_gz(archive: &Path, dest: &Path) -> AppResult<()> {
    if dest.exists() {
        std::fs::remove_dir_all(dest)?;
    }
    let tmp = dest.with_extension("unpacking");
    if tmp.exists() {
        std::fs::remove_dir_all(&tmp)?;
    }
    std::fs::create_dir_all(&tmp)?;
    let file = std::fs::File::open(archive)?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(gz);
    tar.set_preserve_permissions(true);
    tar.unpack(&tmp)?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

/// Find a file by name anywhere under `dir` (archives nest binaries unpredictably).
pub fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    let rd = std::fs::read_dir(dir).ok()?;
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_file(&p, name) {
                return Some(found);
            }
        } else if p.file_name().map(|f| f == name).unwrap_or(false) {
            return Some(p);
        }
    }
    None
}
