//! Microphone capture with cpal. The cpal stream is `!Send` on macOS, so a
//! dedicated thread owns it, drains samples, resamples and writes the WAV.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

use super::resample::{downmix, to_i16, Resampler};
use super::{wav_spec, TARGET_RATE};

pub const LEVEL_EVENT: &str = "record:level";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LevelEvent {
    pub rms: f32,
    pub peak: f32,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone)]
pub struct RecordResult {
    pub path: PathBuf,
    pub duration_ms: i64,
}

struct Active {
    stop_tx: mpsc::Sender<()>,
    done_rx: mpsc::Receiver<AppResult<RecordResult>>,
    path: PathBuf,
}

#[derive(Default)]
pub struct Recorder {
    active: Mutex<Option<Active>>,
}

impl Recorder {
    pub fn is_recording(&self) -> bool {
        self.active.lock().map(|a| a.is_some()).unwrap_or(false)
    }

    pub fn start(&self, app: AppHandle, path: &Path) -> AppResult<()> {
        let mut guard = self.active.lock().map_err(|_| AppError::Other("recorder lock".into()))?;
        if guard.is_some() {
            return Err(AppError::Other("already recording".into()));
        }
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (done_tx, done_rx) = mpsc::channel::<AppResult<RecordResult>>();
        let (ready_tx, ready_rx) = mpsc::channel::<AppResult<()>>();
        let path_owned = path.to_path_buf();

        thread::Builder::new()
            .name("plaudenote-record".into())
            .spawn(move || {
                let result = capture_loop(app, path_owned, stop_rx, ready_tx);
                let _ = done_tx.send(result);
            })
            .map_err(|e| AppError::Other(e.to_string()))?;

        match ready_rx.recv_timeout(Duration::from_secs(8)) {
            Ok(Ok(())) => {}
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(AppError::Other("microphone did not start (permission denied?)".into())),
        }

        *guard = Some(Active {
            stop_tx,
            done_rx,
            path: path.to_path_buf(),
        });
        Ok(())
    }

    pub fn stop(&self) -> AppResult<RecordResult> {
        let active = self
            .active
            .lock()
            .map_err(|_| AppError::Other("recorder lock".into()))?
            .take()
            .ok_or_else(|| AppError::Other("not recording".into()))?;
        let _ = active.stop_tx.send(());
        active
            .done_rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| AppError::Other("recorder did not finish".into()))?
    }

    pub fn cancel(&self) -> AppResult<()> {
        let path = self.active.lock().ok().and_then(|a| a.as_ref().map(|a| a.path.clone()));
        let _ = self.stop();
        if let Some(p) = path {
            let _ = std::fs::remove_file(p);
        }
        Ok(())
    }
}

enum Msg {
    Samples(Vec<f32>),
    Error(String),
}

fn capture_loop(
    app: AppHandle,
    path: PathBuf,
    stop_rx: mpsc::Receiver<()>,
    ready_tx: mpsc::Sender<AppResult<()>>,
) -> AppResult<RecordResult> {
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            let _ = ready_tx.send(Err(AppError::Other("no microphone found".into())));
            return Err(AppError::Other("no microphone found".into()));
        }
    };
    let supported = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            let _ = ready_tx.send(Err(AppError::Other(format!("input config: {e}"))));
            return Err(AppError::Other(format!("input config: {e}")));
        }
    };
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let channels = config.channels.max(1) as usize;
    let in_rate = config.sample_rate;

    let (tx, rx) = mpsc::channel::<Msg>();
    let err_tx = tx.clone();
    let err_fn = move |e: cpal::Error| {
        let _ = err_tx.send(Msg::Error(e.to_string()));
    };

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            config.clone(),
            move |data: &[f32], _| {
                let _ = tx.send(Msg::Samples(data.to_vec()));
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            config.clone(),
            move |data: &[i16], _| {
                let _ = tx.send(Msg::Samples(data.iter().map(|&s| s as f32 / 32768.0).collect()));
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            config.clone(),
            move |data: &[u16], _| {
                let _ = tx.send(Msg::Samples(data.iter().map(|&s| (s as f32 - 32768.0) / 32768.0).collect()));
            },
            err_fn,
            None,
        ),
        other => {
            let _ = ready_tx.send(Err(AppError::Other(format!("unsupported sample format {other:?}"))));
            return Err(AppError::Other(format!("unsupported sample format {other:?}")));
        }
    };
    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(AppError::Other(format!("cannot open microphone: {e}"))));
            return Err(AppError::Other(format!("cannot open microphone: {e}")));
        }
    };
    if let Err(e) = stream.play() {
        let _ = ready_tx.send(Err(AppError::Other(format!("cannot start microphone: {e}"))));
        return Err(AppError::Other(format!("cannot start microphone: {e}")));
    }

    let mut writer = hound::WavWriter::create(&path, wav_spec()).map_err(|e| AppError::Other(e.to_string()))?;
    let mut resampler = Resampler::new(in_rate, TARGET_RATE);
    let started = Instant::now();
    let mut last_level = Instant::now();
    let mut peak = 0.0f32;
    let mut sum_sq = 0.0f64;
    let mut n = 0usize;
    let mut written: u64 = 0;

    let _ = ready_tx.send(Ok(()));

    loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Msg::Samples(data)) => {
                let mono = downmix(&data, channels);
                for &s in &mono {
                    peak = peak.max(s.abs());
                    sum_sq += (s * s) as f64;
                }
                n += mono.len();
                for s in resampler.process(&mono) {
                    writer.write_sample(to_i16(s)).map_err(|e| AppError::Other(e.to_string()))?;
                    written += 1;
                }
            }
            Ok(Msg::Error(e)) => {
                drop(stream);
                let _ = writer.finalize();
                return Err(AppError::Other(format!("microphone error: {e}")));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if last_level.elapsed() >= Duration::from_millis(100) {
            let rms = if n > 0 { (sum_sq / n as f64).sqrt() as f32 } else { 0.0 };
            let _ = app.emit(
                LEVEL_EVENT,
                LevelEvent {
                    rms,
                    peak,
                    elapsed_ms: started.elapsed().as_millis() as u64,
                },
            );
            peak = 0.0;
            sum_sq = 0.0;
            n = 0;
            last_level = Instant::now();
        }
    }

    drop(stream);
    for s in resampler.finish() {
        writer.write_sample(to_i16(s)).map_err(|e| AppError::Other(e.to_string()))?;
        written += 1;
    }
    writer.finalize().map_err(|e| AppError::Other(e.to_string()))?;
    Ok(RecordResult {
        path,
        duration_ms: (written * 1000 / TARGET_RATE as u64) as i64,
    })
}
