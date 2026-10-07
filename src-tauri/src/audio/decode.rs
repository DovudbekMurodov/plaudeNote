//! Decode any supported audio file (m4a/aac, mp3, wav, flac, ogg/vorbis, alac)
//! into our 16 kHz mono WAV using symphonia. Returns duration in ms.

use std::fs::File;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::error::{AppError, AppResult};

use super::resample::{downmix, to_i16, Resampler};
use super::{wav_spec, TARGET_RATE};

pub fn decode_to_wav(src: &Path, dest: &Path) -> AppResult<i64> {
    let file = File::open(src)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = src.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| AppError::Other(format!("unsupported audio file: {e}")))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AppError::Other("no audio track".into()))?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AppError::Other(format!("unsupported codec: {e}")))?;

    let mut writer = hound::WavWriter::create(dest, wav_spec()).map_err(|e| AppError::Other(e.to_string()))?;
    let mut resampler: Option<Resampler> = None;
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut written: u64 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(AppError::Other(format!("read error: {e}"))),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymError::DecodeError(_)) => continue,
            Err(SymError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(AppError::Other(format!("decode error: {e}"))),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let rs = resampler.get_or_insert_with(|| Resampler::new(spec.rate, TARGET_RATE));
        let buf = sample_buf.get_or_insert_with(|| SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
        if buf.capacity() < decoded.capacity() * channels {
            *buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        }
        buf.copy_interleaved_ref(decoded);
        let mono = downmix(buf.samples(), channels);
        for s in rs.process(&mono) {
            writer.write_sample(to_i16(s)).map_err(|e| AppError::Other(e.to_string()))?;
            written += 1;
        }
    }
    if let Some(rs) = resampler.as_mut() {
        for s in rs.finish() {
            writer.write_sample(to_i16(s)).map_err(|e| AppError::Other(e.to_string()))?;
            written += 1;
        }
    }
    writer.finalize().map_err(|e| AppError::Other(e.to_string()))?;
    if written == 0 {
        return Err(AppError::Other("file contains no audio".into()));
    }
    Ok((written * 1000 / TARGET_RATE as u64) as i64)
}
