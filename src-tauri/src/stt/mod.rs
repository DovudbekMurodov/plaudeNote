//! Speech-to-text with whisper.cpp via whisper-rs (Metal).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Once};

use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::audio::read_wav_f32;
use crate::error::{AppError, AppResult};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SttResult {
    pub lang_detected: Option<String>,
    pub segments: Vec<Segment>,
    pub text: String,
}

/// Keeps the last loaded model in memory (loading takes seconds).
#[derive(Default)]
pub struct Stt {
    ctx: Mutex<Option<(PathBuf, Arc<WhisperContext>)>>,
}

static LOGGING: Once = Once::new();

impl Stt {
    fn context(&self, model: &Path) -> AppResult<Arc<WhisperContext>> {
        LOGGING.call_once(whisper_rs::install_logging_hooks);
        let mut guard = self.ctx.lock().map_err(|_| AppError::Other("stt lock".into()))?;
        if let Some((p, c)) = guard.as_ref() {
            if p == model {
                return Ok(Arc::clone(c));
            }
        }
        let mut params = WhisperContextParameters::new();
        params.use_gpu(true);
        let ctx = WhisperContext::new_with_params(
            model.to_str().ok_or_else(|| AppError::Other("bad model path".into()))?,
            params,
        )
        .map_err(|e| AppError::Other(format!("cannot load whisper model: {e:?}")))?;
        let ctx = Arc::new(ctx);
        *guard = Some((model.to_path_buf(), Arc::clone(&ctx)));
        Ok(ctx)
    }

    /// `lang`: "auto" | ISO-639-1 ("uz", "ar", …). Blocking — call from `spawn_blocking`.
    pub fn transcribe(
        &self,
        model: &Path,
        wav: &Path,
        lang: &str,
        mut on_progress: impl FnMut(i32) + Send + 'static,
    ) -> AppResult<SttResult> {
        let ctx = self.context(model)?;
        let samples = read_wav_f32(wav)?;
        if samples.len() < 1600 {
            return Err(AppError::Other("recording too short".into()));
        }
        let mut state = ctx
            .create_state()
            .map_err(|e| AppError::Other(format!("whisper state: {e:?}")))?;

        let lang_owned = if lang.is_empty() { "auto".to_string() } else { lang.to_string() };
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some(lang_owned.as_str()));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_token_timestamps(false);
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32;
        params.set_n_threads(threads);
        params.set_progress_callback_safe(move |p: i32| on_progress(p));

        state
            .full(params, &samples)
            .map_err(|e| AppError::Other(format!("transcription failed: {e:?}")))?;

        let n = state.full_n_segments();
        let mut segments = Vec::with_capacity(n.max(0) as usize);
        for i in 0..n {
            let Some(seg) = state.get_segment(i) else { continue };
            let text = seg.to_str_lossy().map(|c| c.into_owned()).unwrap_or_default();
            let text = text.trim().to_string();
            if text.is_empty() {
                continue;
            }
            segments.push(Segment {
                start_ms: seg.start_timestamp() * 10,
                end_ms: seg.end_timestamp() * 10,
                text,
            });
        }
        let lang_id = state.full_lang_id_from_state();
        let lang_detected = whisper_rs::get_lang_str(lang_id).map(|s| s.to_string());
        let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
        Ok(SttResult {
            lang_detected,
            segments,
            text,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end smoke test: decode → resample → whisper. Needs a model and an audio file:
    /// `PLAUDENOTE_TEST_MODEL=... PLAUDENOTE_TEST_AUDIO=... cargo test stt -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn transcribes_a_real_file() {
        let model = std::env::var("PLAUDENOTE_TEST_MODEL").expect("PLAUDENOTE_TEST_MODEL");
        let audio = std::env::var("PLAUDENOTE_TEST_AUDIO").expect("PLAUDENOTE_TEST_AUDIO");
        let wav = std::env::temp_dir().join("plaudenote_stt_test.wav");
        let dur = crate::audio::decode::decode_to_wav(Path::new(&audio), &wav).expect("decode");
        println!("decoded: {dur} ms → {}", wav.display());
        assert!(dur > 1000, "decoded duration too short: {dur}");

        let stt = Stt::default();
        let res = stt
            .transcribe(Path::new(&model), &wav, "auto", |p| println!("progress {p}%"))
            .expect("transcribe");
        println!("lang: {:?}", res.lang_detected);
        for s in &res.segments {
            println!("[{:>6} → {:>6}] {}", s.start_ms, s.end_ms, s.text);
        }
        assert!(!res.segments.is_empty(), "no segments");
        assert!(res.text.to_lowercase().contains("test"), "unexpected text: {}", res.text);
    }
}
