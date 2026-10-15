//! Audio capture and decoding. Everything ends up as 16 kHz mono 16-bit WAV,
//! which is what whisper wants.

pub mod decode;
pub mod record;
pub mod resample;

use std::path::Path;

use crate::error::AppResult;

pub const TARGET_RATE: u32 = 16_000;

pub fn wav_spec() -> hound::WavSpec {
    hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    }
}

/// Load a 16 kHz mono WAV (as written by us) into f32 samples for whisper.
pub fn read_wav_f32(path: &Path) -> AppResult<Vec<f32>> {
    let mut reader = hound::WavReader::open(path).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let mut out = Vec::with_capacity(reader.len() as usize / channels);
    match spec.sample_format {
        hound::SampleFormat::Int => {
            let scale = 1.0 / ((1i64 << (spec.bits_per_sample - 1)) as f32);
            let mut frame = Vec::with_capacity(channels);
            for s in reader.samples::<i32>() {
                let s = s.map_err(|e| crate::error::AppError::Other(e.to_string()))?;
                frame.push(s as f32 * scale);
                if frame.len() == channels {
                    out.push(frame.iter().sum::<f32>() / channels as f32);
                    frame.clear();
                }
            }
        }
        hound::SampleFormat::Float => {
            let mut frame = Vec::with_capacity(channels);
            for s in reader.samples::<f32>() {
                let s = s.map_err(|e| crate::error::AppError::Other(e.to_string()))?;
                frame.push(s);
                if frame.len() == channels {
                    out.push(frame.iter().sum::<f32>() / channels as f32);
                    frame.clear();
                }
            }
        }
    }
    Ok(out)
}

/// Frame count and sample rate of a WAV without reading its samples.
pub fn wav_frames(path: &Path) -> AppResult<(u64, u32)> {
    let reader = hound::WavReader::open(path).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    let spec = reader.spec();
    Ok((reader.len() as u64 / spec.channels.max(1) as u64, spec.sample_rate))
}

/// Read `n_frames` mono f32 frames starting at `start_frame` (channels averaged).
/// Lets long recordings be processed in windows instead of loading hours of
/// audio into memory at once.
pub fn read_wav_window(path: &Path, start_frame: u64, n_frames: u64) -> AppResult<Vec<f32>> {
    let mut reader = hound::WavReader::open(path).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    let spec = reader.spec();
    let channels = spec.channels.max(1) as usize;
    let total = reader.len() as u64 / channels as u64;
    if start_frame >= total {
        return Ok(Vec::new());
    }
    let n = n_frames.min(total - start_frame) as usize;
    reader
        .seek(start_frame as u32)
        .map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    let mut out = Vec::with_capacity(n);
    let mut frame = Vec::with_capacity(channels);
    let want = n * channels;
    match spec.sample_format {
        hound::SampleFormat::Int => {
            let scale = 1.0 / ((1i64 << (spec.bits_per_sample - 1)) as f32);
            for s in reader.samples::<i32>().take(want) {
                let s = s.map_err(|e| crate::error::AppError::Other(e.to_string()))?;
                frame.push(s as f32 * scale);
                if frame.len() == channels {
                    out.push(frame.iter().sum::<f32>() / channels as f32);
                    frame.clear();
                }
            }
        }
        hound::SampleFormat::Float => {
            for s in reader.samples::<f32>().take(want) {
                let s = s.map_err(|e| crate::error::AppError::Other(e.to_string()))?;
                frame.push(s);
                if frame.len() == channels {
                    out.push(frame.iter().sum::<f32>() / channels as f32);
                    frame.clear();
                }
            }
        }
    }
    Ok(out)
}

pub fn duration_ms_of_wav(path: &Path) -> AppResult<i64> {
    let reader = hound::WavReader::open(path).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    let spec = reader.spec();
    let frames = reader.len() as i64 / spec.channels.max(1) as i64;
    Ok(frames * 1000 / spec.sample_rate as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_read_matches_full_read() {
        let path = std::env::temp_dir().join(format!("plaudenote_win_{}.wav", std::process::id()));
        let mut w = hound::WavWriter::create(&path, wav_spec()).unwrap();
        for i in 0..5000i32 {
            w.write_sample(((i * 7) % 2000 - 1000) as i16).unwrap();
        }
        w.finalize().unwrap();
        let all = read_wav_f32(&path).unwrap();
        assert_eq!(all.len(), 5000);
        assert_eq!(wav_frames(&path).unwrap(), (5000, TARGET_RATE));
        let a = read_wav_window(&path, 0, 1000).unwrap();
        let b = read_wav_window(&path, 1000, 1000).unwrap();
        let tail = read_wav_window(&path, 4500, 10_000).unwrap();
        assert_eq!(a, all[..1000]);
        assert_eq!(b, all[1000..2000]);
        assert_eq!(tail, all[4500..]);
        assert!(read_wav_window(&path, 5000, 10).unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }
}
