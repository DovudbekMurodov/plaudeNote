use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::stt::Segment;

use super::{new_id, now};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub note_id: Option<String>,
    pub path: String,
    pub duration_ms: i64,
    pub lang: Option<String>,
    pub source: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub id: String,
    pub recording_id: String,
    pub lang_detected: Option<String>,
    pub segments: Vec<Segment>,
    pub text: String,
    pub model: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub recording_id: String,
    pub stage: String,
    pub status: String,
    pub progress: f64,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn row_to_recording(r: &rusqlite::Row) -> rusqlite::Result<Recording> {
    Ok(Recording {
        id: r.get(0)?,
        note_id: r.get(1)?,
        path: r.get(2)?,
        duration_ms: r.get(3)?,
        lang: r.get(4)?,
        source: r.get(5)?,
        created_at: r.get(6)?,
    })
}

const REC_COLS: &str = "id, note_id, path, duration_ms, lang, source, created_at";

pub fn insert_recording(
    conn: &Connection,
    note_id: Option<&str>,
    path: &str,
    duration_ms: i64,
    lang: Option<&str>,
    source: &str,
) -> AppResult<Recording> {
    let rec = Recording {
        id: new_id(),
        note_id: note_id.map(str::to_string),
        path: path.to_string(),
        duration_ms,
        lang: lang.map(str::to_string),
        source: source.to_string(),
        created_at: now(),
    };
    conn.execute(
        "INSERT INTO recordings (id, note_id, path, duration_ms, lang, source, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![rec.id, rec.note_id, rec.path, rec.duration_ms, rec.lang, rec.source, rec.created_at],
    )?;
    Ok(rec)
}

pub fn get_recording(conn: &Connection, id: &str) -> AppResult<Recording> {
    conn.query_row(&format!("SELECT {REC_COLS} FROM recordings WHERE id = ?1"), params![id], row_to_recording)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("recording {id}")),
            other => other.into(),
        })
}

pub fn recordings_for_note(conn: &Connection, note_id: &str) -> AppResult<Vec<Recording>> {
    let mut stmt = conn.prepare(&format!("SELECT {REC_COLS} FROM recordings WHERE note_id = ?1 ORDER BY created_at"))?;
    let rows = stmt.query_map(params![note_id], row_to_recording)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn set_recording_lang(conn: &Connection, id: &str, lang: Option<&str>) -> AppResult<()> {
    conn.execute("UPDATE recordings SET lang = ?1 WHERE id = ?2", params![lang, id])?;
    Ok(())
}

pub fn insert_transcript(
    conn: &Connection,
    recording_id: &str,
    lang_detected: Option<&str>,
    segments: &[Segment],
    text: &str,
    model: Option<&str>,
) -> AppResult<Transcript> {
    let t = Transcript {
        id: new_id(),
        recording_id: recording_id.to_string(),
        lang_detected: lang_detected.map(str::to_string),
        segments: segments.to_vec(),
        text: text.to_string(),
        model: model.map(str::to_string),
        created_at: now(),
    };
    let segments_json = serde_json::to_string(&t.segments).map_err(|e| AppError::Other(e.to_string()))?;
    // One transcript per recording: replace any previous attempt.
    conn.execute("DELETE FROM transcripts WHERE recording_id = ?1", params![recording_id])?;
    conn.execute(
        "INSERT INTO transcripts (id, recording_id, lang_detected, segments_json, text, model, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![t.id, t.recording_id, t.lang_detected, segments_json, t.text, t.model, t.created_at],
    )?;
    Ok(t)
}

pub fn transcript_for_recording(conn: &Connection, recording_id: &str) -> AppResult<Option<Transcript>> {
    let row = conn
        .query_row(
            "SELECT id, recording_id, lang_detected, segments_json, text, model, created_at FROM transcripts WHERE recording_id = ?1",
            params![recording_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                ))
            },
        )
        .optional()?;
    Ok(row.map(|(id, recording_id, lang_detected, segments_json, text, model, created_at)| Transcript {
        id,
        recording_id,
        lang_detected,
        segments: serde_json::from_str(&segments_json).unwrap_or_default(),
        text,
        model,
        created_at,
    }))
}

pub fn insert_job(conn: &Connection, recording_id: &str, stage: &str) -> AppResult<Job> {
    let ts = now();
    let job = Job {
        id: new_id(),
        recording_id: recording_id.to_string(),
        stage: stage.to_string(),
        status: "queued".into(),
        progress: 0.0,
        error: None,
        created_at: ts.clone(),
        updated_at: ts,
    };
    conn.execute(
        "INSERT INTO jobs (id, recording_id, stage, status, progress, error, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![job.id, job.recording_id, job.stage, job.status, job.progress, job.error, job.created_at, job.updated_at],
    )?;
    Ok(job)
}

pub fn update_job(conn: &Connection, id: &str, status: &str, progress: f64, error: Option<&str>) -> AppResult<()> {
    conn.execute(
        "UPDATE jobs SET status = ?1, progress = ?2, error = ?3, updated_at = ?4 WHERE id = ?5",
        params![status, progress, error, now(), id],
    )?;
    Ok(())
}

/// Anything that was mid-flight when the app last quit is dead now.
pub fn fail_stale_jobs(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE jobs SET status = 'failed', error = 'interrupted', updated_at = ?1 WHERE status IN ('queued', 'running')",
        params![now()],
    )?)
}
