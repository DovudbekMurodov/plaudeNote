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

pub fn duration_ms_of_wav(path: &Path) -> AppResult<i64> {
    let reader = hound::WavReader::open(path).map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    let spec = reader.spec();
    let frames = reader.len() as i64 / spec.channels.max(1) as i64;
    Ok(frames * 1000 / spec.sample_rate as i64)
}
