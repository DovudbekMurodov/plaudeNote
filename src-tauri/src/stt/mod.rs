//! Speech-to-text with whisper.cpp via whisper-rs (Metal).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Once};

use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::audio::{read_wav_window, wav_frames};
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

/// Keeps the most recently used model in memory (loading takes a few seconds);
/// `unload_idle` drops it when the app has been quiet for a while.
pub struct Stt {
    ctx: Mutex<Vec<(PathBuf, Arc<WhisperContext>)>>,
    last_used: Mutex<std::time::Instant>,
}

impl Default for Stt {
    fn default() -> Self {
        Self {
            ctx: Mutex::new(Vec::new()),
            last_used: Mutex::new(std::time::Instant::now()),
        }
    }
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
        self.touch();
        let mut guard = self.ctx.lock().map_err(|_| AppError::Other("stt lock".into()))?;
        if let Some((_, c)) = guard.iter().find(|(p, _)| p == model) {
            return Ok(Arc::clone(c));
        }
        let mut params = WhisperContextParameters::new();
        params.use_gpu(true);
        // Flash attention on Metal: noticeably faster encoder/decoder, same output.
        params.flash_attn(true);
        let ctx = WhisperContext::new_with_params(
            model.to_str().ok_or_else(|| AppError::Other("bad model path".into()))?,
            params,
        )
        .map_err(|e| AppError::Other(format!("cannot load whisper model: {e:?}")))?;
        let ctx = Arc::new(ctx);
        // One model at a time: a second one would cost another 0.5 GB on a 16 GB Mac.
        guard.clear();
        guard.push((model.to_path_buf(), Arc::clone(&ctx)));
        Ok(ctx)
    }

    /// Language probabilities from the first ~30 s, best first (ISO-639-1 codes).
    pub fn detect_language_probs(&self, model: &Path, wav: &Path) -> AppResult<Vec<(String, f32)>> {
        let ctx = self.context(model)?;
        let (total, _) = wav_frames(wav)?;
        if total < 16_000 {
            return Ok(Vec::new());
        }
        // Skip a little lead-in silence/music, then one 30 s window.
        let start = (total / 10).min(5 * 16_000);
        let samples = read_wav_window(wav, start, 30 * 16_000)?;
        let mut state = ctx.create_state().map_err(|e| AppError::Other(format!("whisper state: {e:?}")))?;
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
        state
            .pcm_to_mel(&samples, threads)
            .map_err(|e| AppError::Other(format!("mel: {e:?}")))?;
        let (_id, probs) = state
            .lang_detect(0, threads)
            .map_err(|e| AppError::Other(format!("lang detect: {e:?}")))?;
        let mut v: Vec<(String, f32)> = probs
            .iter()
            .enumerate()
            .filter_map(|(i, p)| whisper_rs::get_lang_str(i as i32).map(|l| (l.to_string(), *p)))
            .collect();
        v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        v.truncate(8);
        Ok(v)
    }

    /// Detect the spoken language from the first ~30 s. Returns ISO-639-1 ("uz", "ar"…).
    pub fn detect_language(&self, model: &Path, wav: &Path) -> AppResult<Option<String>> {
        Ok(self.detect_language_probs(model, wav)?.into_iter().next().map(|(l, _)| l))
    }

    /// `lang`: "auto" | ISO-639-1 ("uz", "ar", …). Blocking — call from `spawn_blocking`.
    /// Set `cancel` to stop early (checked by whisper between compute steps).
    pub fn transcribe(
        &self,
        model: &Path,
        wav: &Path,
        lang: &str,
        cancel: Arc<AtomicBool>,
        on_progress: impl FnMut(i32) + Send + 'static,
    ) -> AppResult<SttResult> {
        let mut on_progress = on_progress;
        self.transcribe_with(model, wav, lang, true, 5, cancel, move |u: Update| on_progress((u.progress * 100.0) as i32))
    }

    /// Transcribe in windows of ~10 minutes (cut at the quietest moment near the
    /// boundary), so hours-long recordings use a bounded amount of memory, report
    /// real progress and deliver text as they go.
    ///
    /// `primer`: feed the in-language primer sentence (helps general models, not fine-tunes).
    /// `beam_size`: 1 = greedy, 5 = best quality (≈7× realtime on Apple Silicon for medium models).
    /// `on_update` receives every finished window with its segments and the overall progress.
    #[allow(clippy::too_many_arguments)]
    pub fn transcribe_with(
        &self,
        model: &Path,
        wav: &Path,
        lang: &str,
        primer: bool,
        beam_size: i32,
        cancel: Arc<AtomicBool>,
        on_update: impl FnMut(Update) + Send + 'static,
    ) -> AppResult<SttResult> {
        let ctx = self.context(model)?;
        let (total_frames, rate) = wav_frames(wav)?;
        if rate != 16_000 {
            return Err(AppError::Other(format!("expected a 16 kHz wav, got {rate} Hz")));
        }
        if total_frames < 1600 {
            return Err(AppError::Other("recording too short".into()));
        }
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let mut state = ctx
            .create_state()
            .map_err(|e| AppError::Other(format!("whisper state: {e:?}")))?;
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32;
        let on_update: Arc<Mutex<Box<dyn FnMut(Update) + Send>>> = Arc::new(Mutex::new(Box::new(on_update)));

        let mut lang_owned = if lang.is_empty() { "auto".to_string() } else { lang.to_string() };
        let mut segments: Vec<Segment> = Vec::new();
        let mut start: u64 = 0;
        let mut prev_tail = String::new();
        let mut first_window = true;

        while start < total_frames {
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::Cancelled);
            }
            let remaining = total_frames - start;
            let last = remaining <= WINDOW_FRAMES + SEARCH_FRAMES;
            let want = if last { remaining } else { WINDOW_FRAMES + SEARCH_FRAMES };
            let mut samples = read_wav_window(wav, start, want)?;
            if !last {
                let cut = quietest_cut(&samples, (WINDOW_FRAMES - SEARCH_FRAMES) as usize, samples.len());
                samples.truncate(cut);
            }
            let n = samples.len() as u64;
            if n < 1600 {
                break;
            }
            let window_ms = (start * 1000 / 16_000) as i64;

            let mut params = FullParams::new(if beam_size > 1 {
                SamplingStrategy::BeamSearch { beam_size, patience: -1.0 }
            } else {
                SamplingStrategy::Greedy { best_of: 1 }
            });
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
            params.set_n_threads(threads);
            // No temperature fallback. Measured on Uzbek (Kotib medium, M4): fallback re-decodes
            // every low-confidence 30 s up to five times at rising temperature — 1.8× realtime
            // instead of 7× — and the resampled retries hallucinate as often as they fix. Loops,
            // the one thing fallback reliably catches, are cut by `collapse_repeats` instead.
            params.set_temperature_inc(0.0);
            // Context across windows: whisper itself carries the previous 30 s of text; we do the
            // same across our cuts (and seed the first window with the primer when asked).
            if !prev_tail.is_empty() {
                params.set_initial_prompt(&prev_tail);
            } else if primer {
                if let Some(p) = initial_prompt(&lang_owned) {
                    params.set_initial_prompt(p);
                }
            }
            {
                let cb = Arc::clone(&on_update);
                let base = start as f64 / total_frames as f64;
                let span = n as f64 / total_frames as f64;
                let mut last_pct = -1i32;
                params.set_progress_callback_safe(move |p: i32| {
                    let overall = base + span * (p as f64 / 100.0);
                    let pct = (overall * 100.0) as i32;
                    if pct != last_pct {
                        last_pct = pct;
                        if let Ok(mut f) = cb.lock() {
                            f(Update { progress: overall, segments: Vec::new() });
                        }
                    }
                });
            }
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
            drop(samples);

            if first_window && lang_owned == "auto" {
                if let Some(l) = whisper_rs::get_lang_str(state.full_lang_id_from_state()) {
                    lang_owned = l.to_string();
                }
            }
            first_window = false;
            let forced = lang_owned != "auto";
            let mut fresh: Vec<Segment> = Vec::new();
            for i in 0..state.full_n_segments() {
                let Some(seg) = state.get_segment(i) else { continue };
                let text = seg.to_str_lossy().map(|c| c.into_owned()).unwrap_or_default();
                let text = collapse_repeats(text.trim());
                if text.is_empty() || (forced && !script_ok(&lang_owned, &text)) {
                    continue;
                }
                let end_ms = seg.end_timestamp() * 10 + window_ms;
                // Collapse the classic "same line repeated forever" hallucination (also across the cut).
                let dup = fresh.last().or(segments.last()).map(|s| s.text == text).unwrap_or(false);
                if dup {
                    if let Some(l) = fresh.last_mut().or(segments.last_mut()) {
                        l.end_ms = end_ms;
                    }
                    continue;
                }
                fresh.push(Segment { start_ms: seg.start_timestamp() * 10 + window_ms, end_ms, text });
            }
            prev_tail = tail_text(&fresh, 200);
            start += n;
            let progress = (start as f64 / total_frames as f64).min(1.0);
            if let Ok(mut f) = on_update.lock() {
                f(Update { progress, segments: fresh.clone() });
            }
            segments.extend(fresh);
        }

        let lang_detected = if lang_owned == "auto" { None } else { Some(lang_owned) };
        let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
        Ok(SttResult { lang_detected, segments, text })
    }

    /// Drop cached models (frees ~0.5–1 GB before the LLM loads, or when idle).
    pub fn unload_all(&self) {
        if let Ok(mut g) = self.ctx.lock() {
            g.clear();
        }
    }

    /// Drop cached models when nothing used them for `max_idle`.
    pub fn unload_idle(&self, max_idle: std::time::Duration) {
        let idle = self.last_used.lock().map(|t| t.elapsed() >= max_idle).unwrap_or(false);
        if idle {
            self.unload_all();
        }
    }

    fn touch(&self) {
        if let Ok(mut t) = self.last_used.lock() {
            *t = std::time::Instant::now();
        }
    }
}

/// Progress report from `transcribe_with`: overall 0..1 and the segments of a
/// window that just finished (empty for plain progress ticks).
#[derive(Clone, Debug, Default)]
pub struct Update {
    pub progress: f64,
    pub segments: Vec<Segment>,
}

/// 10-minute windows (38 MB of f32 each) …
const WINDOW_FRAMES: u64 = 600 * 16_000;
/// … cut at the quietest 200 ms inside the last 20 s of the window.
const SEARCH_FRAMES: u64 = 20 * 16_000;

/// Index to cut at: the centre of the lowest-energy 200 ms frame in `samples[from..to]`.
fn quietest_cut(samples: &[f32], from: usize, to: usize) -> usize {
    const FRAME: usize = 3200; // 200 ms
    let to = to.min(samples.len());
    if to <= from + FRAME {
        return to;
    }
    let mut best = (f32::MAX, to);
    let mut i = from;
    while i + FRAME <= to {
        let e: f32 = samples[i..i + FRAME].iter().map(|s| s * s).sum();
        if e < best.0 {
            best = (e, i + FRAME / 2);
        }
        i += FRAME / 2;
    }
    best.1
}

/// Cut a phrase that whisper got stuck repeating ("o'zbek tilida o'zbek tilida …"):
/// keep the first occurrence of an n-gram that repeats back to back — three
/// times for short ones (1–3 words, "yo'q yo'q" is normal speech), twice for
/// longer ones (nobody says the same 6-word sentence twice verbatim).
fn collapse_repeats(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let key = |w: &str| w.trim_end_matches([',', '.', ';', ':', '!', '?', '،', '؟']).to_lowercase();
    let keys: Vec<String> = words.iter().map(|w| key(w)).collect();
    let mut out: Vec<&str> = Vec::with_capacity(words.len());
    let mut i = 0;
    while i < words.len() {
        let mut cut = false;
        for n in 1..=20 {
            let need = if n <= 3 { 3 } else { 2 };
            if i + need * n > words.len() {
                break;
            }
            let g = &keys[i..i + n];
            let mut reps = 1;
            while i + (reps + 1) * n <= words.len() && &keys[i + reps * n..i + (reps + 1) * n] == g {
                reps += 1;
            }
            if reps >= need {
                out.extend_from_slice(&words[i..i + n]);
                i += reps * n;
                cut = true;
                break;
            }
        }
        if !cut {
            out.push(words[i]);
            i += 1;
        }
    }
    out.join(" ")
}

/// Last `max_chars` characters of a window's text, on a word boundary.
fn tail_text(segs: &[Segment], max_chars: usize) -> String {
    let joined = segs.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
    let n = joined.chars().count();
    if n <= max_chars {
        return joined;
    }
    let cut: String = joined.chars().skip(n - max_chars).collect();
    match cut.find(' ') {
        Some(i) => cut[i + 1..].to_string(),
        None => cut,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end smoke test: decode → resample → windowed whisper. Needs a model and an audio file:
    /// `PLAUDENOTE_TEST_MODEL=... PLAUDENOTE_TEST_AUDIO=... [PLAUDENOTE_TEST_LANG=uz] [PLAUDENOTE_TEST_BEAM=3]
    ///  cargo test transcribes_a_real_file -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn transcribes_a_real_file() {
        let model = std::env::var("PLAUDENOTE_TEST_MODEL").expect("PLAUDENOTE_TEST_MODEL");
        let audio = std::env::var("PLAUDENOTE_TEST_AUDIO").expect("PLAUDENOTE_TEST_AUDIO");
        let lang = std::env::var("PLAUDENOTE_TEST_LANG").unwrap_or_else(|_| "auto".into());
        let beam: i32 = std::env::var("PLAUDENOTE_TEST_BEAM").ok().and_then(|b| b.parse().ok()).unwrap_or(5);
        let wav = std::env::temp_dir().join("plaudenote_stt_test.wav");
        let t0 = std::time::Instant::now();
        let dur = crate::audio::decode::decode_to_wav(Path::new(&audio), &wav).expect("decode");
        println!("decoded: {dur} ms in {:?} → {}", t0.elapsed(), wav.display());
        assert!(dur > 1000, "decoded duration too short: {dur}");

        let stt = Stt::default();
        let t1 = std::time::Instant::now();
        let res = stt
            .transcribe_with(Path::new(&model), &wav, &lang, false, beam, Arc::new(AtomicBool::new(false)), move |u: Update| {
                if !u.segments.is_empty() {
                    println!(
                        "window done: +{} segments, progress {:.1}%, elapsed {:?}, last: {:?}",
                        u.segments.len(),
                        u.progress * 100.0,
                        t1.elapsed(),
                        u.segments.last().map(|s| s.text.chars().take(60).collect::<String>())
                    );
                }
            })
            .expect("transcribe");
        let secs = t1.elapsed().as_secs_f64();
        println!(
            "transcribed {} min in {:.0} s ({:.1}× realtime), beam {beam}, lang {:?}, {} segments",
            dur / 60_000,
            secs,
            (dur as f64 / 1000.0) / secs,
            res.lang_detected,
            res.segments.len()
        );
        for s in res.segments.iter().take(5).chain(res.segments.iter().rev().take(3).collect::<Vec<_>>().into_iter().rev()) {
            println!("[{:>8} → {:>8}] {}", s.start_ms, s.end_ms, s.text);
        }
        assert!(!res.segments.is_empty(), "no segments");
        // Timestamps must be monotonic across window boundaries.
        for w in res.segments.windows(2) {
            assert!(w[1].start_ms >= w[0].start_ms, "timestamps went backwards: {:?} → {:?}", w[0], w[1]);
        }
    }

    /// Print language probabilities for every wav in PLAUDENOTE_TEST_DIR.
    #[test]
    #[ignore]
    fn language_probs() {
        let model = std::env::var("PLAUDENOTE_TEST_MODEL").expect("PLAUDENOTE_TEST_MODEL");
        let dir = std::env::var("PLAUDENOTE_TEST_DIR").expect("PLAUDENOTE_TEST_DIR");
        let stt = Stt::default();
        let mut files: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.to_string_lossy().ends_with(".16k.wav")).collect();
        files.sort();
        for f in files {
            let probs = stt.detect_language_probs(Path::new(&model), &f).unwrap();
            let top: Vec<String> = probs.iter().take(5).map(|(l, p)| format!("{l}={p:.2}")).collect();
            println!("{}: {}", f.file_name().unwrap().to_string_lossy(), top.join(" "));
        }
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

    #[test]
    fn cut_lands_on_the_quietest_frame() {
        // Loud everywhere except a silent gap at 1.5–1.7 s inside the search range.
        let mut v = vec![0.5f32; 16_000 * 2];
        for s in &mut v[24_000..27_200] {
            *s = 0.0;
        }
        let cut = quietest_cut(&v, 16_000, v.len());
        assert!((24_000..=27_200).contains(&cut), "cut at {cut}");
        // Too short a range → cut at the end.
        assert_eq!(quietest_cut(&v, v.len() - 100, v.len()), v.len());
    }

    #[test]
    fn repeated_phrases_are_collapsed() {
        assert_eq!(
            collapse_repeats("chunki o'zbek tilida o'zbek tilida o'zbek tilida o'zbek tilida o'zbek tilida o'"),
            "chunki o'zbek tilida o'"
        );
        assert_eq!(collapse_repeats("o'qishlarni olamiz, o'qishlarni olamiz, o'qishlarni olamiz"), "o'qishlarni olamiz,");
        // Twice is normal speech for short phrases, not a loop.
        assert_eq!(collapse_repeats("yo'q yo'q bo'lmaydi"), "yo'q yo'q bo'lmaydi");
        assert_eq!(collapse_repeats("juda juda juda yaxshi"), "juda yaxshi");
        // A whole sentence repeated verbatim is whisper looping, even twice.
        assert_eq!(
            collapse_repeats("balkim eski darsdagi takrorlarni qilish uchun boshqa narsalar bo'ladi. balkim eski darsdagi takrorlarni qilish uchun boshqa narsalar bo'ladi. xo'p"),
            "balkim eski darsdagi takrorlarni qilish uchun boshqa narsalar bo'ladi. xo'p"
        );
    }

    #[test]
    fn tail_text_keeps_whole_words() {
        let segs = vec![
            Segment { start_ms: 0, end_ms: 1, text: "birinchi gap shu yerda".into() },
            Segment { start_ms: 1, end_ms: 2, text: "ikkinchi gap tugadi".into() },
        ];
        let t = tail_text(&segs, 12);
        assert_eq!(t, "gap tugadi");
        assert_eq!(tail_text(&segs, 500), "birinchi gap shu yerda ikkinchi gap tugadi");
    }

    /// Speed/quality bench of decoding settings on the first N seconds of a wav (default 180):
    /// `PLAUDENOTE_TEST_MODEL=... PLAUDENOTE_TEST_WAV=<16k wav> [PLAUDENOTE_TEST_SECONDS=180] cargo test bench_settings -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_settings() {
        let model = std::env::var("PLAUDENOTE_TEST_MODEL").expect("PLAUDENOTE_TEST_MODEL");
        let wav = std::env::var("PLAUDENOTE_TEST_WAV").expect("PLAUDENOTE_TEST_WAV");
        let secs: u64 = std::env::var("PLAUDENOTE_TEST_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(180);
        let samples = read_wav_window(Path::new(&wav), 0, secs * 16_000).unwrap();
        let ctx = Stt::default().context(Path::new(&model)).unwrap();
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8) as i32;
        let configs: Vec<(&str, i32, Option<f32>, Option<f32>, Option<f32>)> = vec![
            ("beam5 default", 5, None, None, None),
            ("beam5 tinc0.5", 5, Some(0.5), None, None),
            ("beam5 entropy2.0", 5, None, None, Some(2.0)),
            ("beam5 entropy1.5", 5, None, None, Some(1.5)),
            ("beam5 no-fallback", 5, Some(0.0), None, None),
        ];
        let mut reference = String::new();
        for (name, beam, tinc, logprob, entropy) in configs {
            let mut state = ctx.create_state().unwrap();
            let mut params = FullParams::new(if beam > 1 {
                SamplingStrategy::BeamSearch { beam_size: beam, patience: -1.0 }
            } else {
                SamplingStrategy::Greedy { best_of: 1 }
            });
            params.set_language(Some("uz"));
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_suppress_blank(true);
            params.set_suppress_nst(true);
            params.set_no_speech_thold(0.6);
            params.set_n_threads(threads);
            if let Some(t) = tinc {
                params.set_temperature_inc(t);
            }
            if let Some(l) = logprob {
                params.set_logprob_thold(l);
            }
            if let Some(e) = entropy {
                params.set_entropy_thold(e);
            }
            let t0 = std::time::Instant::now();
            state.full(params, &samples).unwrap();
            let el = t0.elapsed().as_secs_f64();
            let text: String = (0..state.full_n_segments())
                .filter_map(|i| state.get_segment(i).and_then(|s| s.to_str_lossy().ok().map(|c| c.into_owned())))
                .collect::<Vec<_>>()
                .join(" ");
            let words: Vec<&str> = text.split_whitespace().collect();
            let sim = if reference.is_empty() {
                reference = text.clone();
                1.0
            } else {
                let r: std::collections::HashSet<&str> = reference.split_whitespace().collect();
                let hit = words.iter().filter(|w| r.contains(*w)).count();
                hit as f64 / words.len().max(1) as f64
            };
            println!(
                "{name:<20} {el:6.1} s  {:4.1}× realtime  {} words  word-overlap vs beam5 {:.0}%",
                secs as f64 / el,
                words.len(),
                sim * 100.0
            );
            if let Ok(dir) = std::env::var("PLAUDENOTE_TEST_DUMP") {
                let _ = std::fs::write(format!("{dir}/{}.txt", name.replace(' ', "_")), &text);
            }
        }
    }
}
