//! Speech-to-text with whisper.cpp via whisper-rs (Metal).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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

/// A short in-language primer. Whisper treats it as "previous text", which anchors
/// the script and stops the small models drifting into Turkish/English.
fn initial_prompt(lang: &str) -> Option<&'static str> {
    match lang {
        "uz" => Some("Assalomu alaykum. Bu o'zbek tilidagi yozuv. Bugungi darsimizni boshlaymiz."),
        "ar" => Some("بسم الله الرحمن الرحيم. هذا تسجيل باللغة العربية."),
        "ru" => Some("Здравствуйте. Это запись на русском языке."),
        _ => None,
    }
}

fn has_arabic(s: &str) -> bool {
    s.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c) || ('\u{0750}'..='\u{077F}').contains(&c))
}
fn has_latin_or_cyrillic(s: &str) -> bool {
    s.chars().any(|c| c.is_ascii_alphabetic() || ('\u{0400}'..='\u{04FF}').contains(&c))
}

/// Drop segments in the wrong script for the forced language — those are hallucinations.
fn script_ok(lang: &str, text: &str) -> bool {
    match lang {
        "ar" => has_arabic(text),
        "uz" | "en" | "ru" | "tr" => !has_arabic(text) && has_latin_or_cyrillic(text),
        _ => true,
    }
}

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
    /// Set `cancel` to stop early (checked by whisper between compute steps).
    pub fn transcribe(
        &self,
        model: &Path,
        wav: &Path,
        lang: &str,
        cancel: Arc<AtomicBool>,
        mut on_progress: impl FnMut(i32) + Send + 'static,
    ) -> AppResult<SttResult> {
        let ctx = self.context(model)?;
        let samples = read_wav_f32(wav)?;
        if samples.len() < 1600 {
            return Err(AppError::Other("recording too short".into()));
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let mut state = ctx
            .create_state()
            .map_err(|e| AppError::Other(format!("whisper state: {e:?}")))?;

        let lang_owned = if lang.is_empty() { "auto".to_string() } else { lang.to_string() };
        // Beam search is markedly better than greedy for low-resource languages.
        let mut params = FullParams::new(SamplingStrategy::BeamSearch { beam_size: 5, patience: -1.0 });
        params.set_language(Some(lang_owned.as_str()));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_token_timestamps(false);
        params.set_no_speech_thold(0.6);
        if let Some(p) = initial_prompt(&lang_owned) {
            params.set_initial_prompt(p);
        }
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32;
        params.set_n_threads(threads);
        params.set_progress_callback_safe(move |p: i32| on_progress(p));
        // whisper-rs's trampoline reads the user data as `*mut F`; passing the boxed
        // trait object *as* `F` makes the stored type and the read type identical.
        let flag = Arc::clone(&cancel);
        let abort: Box<dyn FnMut() -> bool> = Box::new(move || flag.load(Ordering::Relaxed));
        params.set_abort_callback_safe(abort);

        let run = state.full(params, &samples);
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        run.map_err(|e| AppError::Other(format!("transcription failed: {e:?}")))?;

        let n = state.full_n_segments();
        let mut segments: Vec<Segment> = Vec::with_capacity(n.max(0) as usize);
        let forced = lang_owned != "auto";
        for i in 0..n {
            let Some(seg) = state.get_segment(i) else { continue };
            let text = seg.to_str_lossy().map(|c| c.into_owned()).unwrap_or_default();
            let text = text.trim().to_string();
            if text.is_empty() {
                continue;
            }
            if forced && !script_ok(&lang_owned, &text) {
                continue;
            }
            // Collapse the classic "same line repeated forever" hallucination.
            if segments.last().map(|s| s.text == text).unwrap_or(false) {
                if let Some(last) = segments.last_mut() {
                    last.end_ms = seg.end_timestamp() * 10;
                }
                continue;
            }
            segments.push(Segment {
                start_ms: seg.start_timestamp() * 10,
                end_ms: seg.end_timestamp() * 10,
                text,
            });
        }
        let lang_id = state.full_lang_id_from_state();
        let lang_detected = if forced {
            Some(lang_owned.clone())
        } else {
            whisper_rs::get_lang_str(lang_id).map(|s| s.to_string())
        };
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
        let lang = std::env::var("PLAUDENOTE_TEST_LANG").unwrap_or_else(|_| "auto".into());
        let wav = std::env::temp_dir().join("plaudenote_stt_test.wav");
        let t0 = std::time::Instant::now();
        let dur = crate::audio::decode::decode_to_wav(Path::new(&audio), &wav).expect("decode");
        println!("decoded: {dur} ms in {:?} → {}", t0.elapsed(), wav.display());
        assert!(dur > 1000, "decoded duration too short: {dur}");

        let stt = Stt::default();
        let t1 = std::time::Instant::now();
        let res = stt
            .transcribe(Path::new(&model), &wav, &lang, Arc::new(AtomicBool::new(false)), |p| println!("progress {p}%"))
            .expect("transcribe");
        println!("transcribed in {:?}; lang: {:?}", t1.elapsed(), res.lang_detected);
        for s in &res.segments {
            println!("[{:>6} → {:>6}] {}", s.start_ms, s.end_ms, s.text);
        }
        assert!(!res.segments.is_empty(), "no segments");
    }

    /// Cancellation must stop a long transcription quickly.
    #[test]
    #[ignore]
    fn cancel_stops_transcription() {
        let model = std::env::var("PLAUDENOTE_TEST_MODEL").expect("PLAUDENOTE_TEST_MODEL");
        let audio = std::env::var("PLAUDENOTE_TEST_AUDIO").expect("PLAUDENOTE_TEST_AUDIO");
        let wav = std::env::temp_dir().join("plaudenote_stt_cancel.wav");
        crate::audio::decode::decode_to_wav(Path::new(&audio), &wav).expect("decode");
        let stt = Stt::default();
        let cancel = Arc::new(AtomicBool::new(false));
        let c2 = Arc::clone(&cancel);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            c2.store(true, Ordering::Relaxed);
        });
        let t0 = std::time::Instant::now();
        let res = stt.transcribe(Path::new(&model), &wav, "en", cancel, |_| {});
        println!("returned after {:?}: {:?}", t0.elapsed(), res.as_ref().err());
        assert!(matches!(res, Err(AppError::Cancelled)));
    }
}
