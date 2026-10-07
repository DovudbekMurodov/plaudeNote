//! Streaming windowed-sinc resampler (mono, f32). Good enough for speech;
//! avoids a native dependency. 32 taps per output sample.

use std::f32::consts::PI;

const HALF_TAPS: usize = 16;

pub struct Resampler {
    ratio: f64, // input frames per output frame
    cutoff: f32,
    history: Vec<f32>, // unconsumed input (with HALF_TAPS of lead-in)
    pos: f64,          // position of next output sample in `history` coordinates
}

impl Resampler {
    pub fn new(in_rate: u32, out_rate: u32) -> Self {
        let ratio = in_rate as f64 / out_rate as f64;
        // Low-pass at the lower of the two Nyquist frequencies, slightly below.
        let cutoff = if ratio > 1.0 { 0.9 / ratio as f32 } else { 0.9 };
        Self {
            ratio,
            cutoff,
            history: vec![0.0; HALF_TAPS],
            pos: HALF_TAPS as f64,
        }
    }

    pub fn is_identity(&self) -> bool {
        (self.ratio - 1.0).abs() < 1e-9
    }

    /// Feed mono input, get resampled output.
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if self.is_identity() {
            return input.to_vec();
        }
        self.history.extend_from_slice(input);
        let mut out = Vec::with_capacity((input.len() as f64 / self.ratio) as usize + 2);
        let limit = self.history.len().saturating_sub(HALF_TAPS) as f64;
        while self.pos < limit {
            out.push(self.sample_at(self.pos));
            self.pos += self.ratio;
        }
        // Drop consumed history, keep a HALF_TAPS lead-in before `pos`.
        let keep_from = (self.pos as usize).saturating_sub(HALF_TAPS);
        if keep_from > 0 {
            self.history.drain(..keep_from);
            self.pos -= keep_from as f64;
        }
        out
    }

    /// Flush the tail (pads with silence).
    pub fn finish(&mut self) -> Vec<f32> {
        if self.is_identity() {
            return Vec::new();
        }
        let pad = vec![0.0f32; HALF_TAPS];
        self.process(&pad)
    }

    fn sample_at(&self, pos: f64) -> f32 {
        let center = pos.floor() as isize;
        let frac = (pos - center as f64) as f32;
        let mut acc = 0.0f32;
        let mut norm = 0.0f32;
        for k in -(HALF_TAPS as isize) + 1..=(HALF_TAPS as isize) {
            let idx = center + k;
            if idx < 0 || idx as usize >= self.history.len() {
                continue;
            }
            let x = k as f32 - frac; // distance from the output sample
            let w = sinc(self.cutoff * x) * self.cutoff * hann(x / HALF_TAPS as f32);
            acc += self.history[idx as usize] * w;
            norm += w;
        }
        if norm.abs() > 1e-6 {
            acc / norm
        } else {
            acc
        }
    }
}

fn sinc(x: f32) -> f32 {
    if x.abs() < 1e-6 {
        1.0
    } else {
        (PI * x).sin() / (PI * x)
    }
}

fn hann(t: f32) -> f32 {
    if t.abs() >= 1.0 {
        0.0
    } else {
        0.5 * (1.0 + (PI * t).cos())
    }
}

/// Interleaved → mono by averaging channels.
pub fn downmix(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|f| f.iter().sum::<f32>() / channels as f32)
        .collect()
}

pub fn to_i16(x: f32) -> i16 {
    (x.clamp(-1.0, 1.0) * 32767.0) as i16
}
