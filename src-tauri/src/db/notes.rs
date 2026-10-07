use std::collections::HashMap;

use rusqlite::{params, params_from_iter, types::Value, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::{new_id, now};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub folder_id: Option<String>,
    pub title: String,
    pub preview: String,
    pub pinned: bool,
    pub lang: String,
    pub has_audio: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteFull {
    #[serde(flatten)]
    pub summary: NoteSummary,
    pub blocks_json: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveNote {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub blocks_json: String,
    pub plain_text: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub all: i64,
    pub pinned: i64,
    pub trash: i64,
    pub by_folder: HashMap<String, i64>,
}

/// What the middle column shows.
pub enum Filter {
    All,
    Recent,
    Pinned,
    Trash,
    Folder(String),
}

impl Filter {
    pub fn parse(s: &str) -> Self {
        match s {
            "all" => Filter::All,
            "recent" => Filter::Recent,
            "pinned" => Filter::Pinned,
            "trash" => Filter::Trash,
            id => Filter::Folder(id.to_string()),
        }
    }
}

const SUMMARY_COLS: &str = "n.id, n.folder_id, n.title, n.preview, n.pinned, n.lang,
    EXISTS(SELECT 1 FROM recordings r WHERE r.note_id = n.id) AS has_audio,
    n.created_at, n.updated_at, n.deleted_at";

fn row_to_summary(r: &rusqlite::Row) -> rusqlite::Result<NoteSummary> {
    Ok(NoteSummary {
        id: r.get(0)?,
        folder_id: r.get(1)?,
        title: r.get(2)?,
        preview: r.get(3)?,
        pinned: r.get::<_, i64>(4)? != 0,
        lang: r.get(5)?,
        has_audio: r.get::<_, i64>(6)? != 0,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        deleted_at: r.get(9)?,
    })
}

/// Turn free text into an FTS5 prefix query: `hello wor` → `"hello"* "wor"*`.
fn fts_query(q: &str) -> Option<String> {
    let terms: Vec<String> = q
        .split_whitespace()
        .map(|t| t.replace('"', ""))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

pub fn list(conn: &Connection, filter: Filter, query: Option<&str>) -> AppResult<Vec<NoteSummary>> {
    let mut sql = format!("SELECT {SUMMARY_COLS} FROM notes n");
    let mut wheres: Vec<String> = Vec::new();
    let mut args: Vec<Value> = Vec::new();

    if let Some(fts) = query.and_then(fts_query) {
        sql.push_str(" JOIN notes_fts f ON f.rowid = n.rid");
        wheres.push("notes_fts MATCH ?".into());
        args.push(Value::Text(fts));
    }

    let mut limit = 500;
    match filter {
        Filter::Trash => wheres.push("n.deleted_at IS NOT NULL".into()),
        other => {
            wheres.push("n.deleted_at IS NULL".into());
            match other {
                Filter::Pinned => wheres.push("n.pinned = 1".into()),
                Filter::Recent => limit = 20,
                Filter::Folder(id) => {
                    wheres.push("n.folder_id = ?".into());
                    args.push(Value::Text(id));
                }
                _ => {}
            }
        }
    }

    if !wheres.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&wheres.join(" AND "));
    }
    sql.push_str(" ORDER BY n.pinned DESC, n.updated_at DESC LIMIT ");
    sql.push_str(&limit.to_string());

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), row_to_summary)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<NoteFull> {
    let sql = format!("SELECT {SUMMARY_COLS}, n.blocks_json FROM notes n WHERE n.id = ?1");
    conn.query_row(&sql, params![id], |r| {
        Ok(NoteFull {
            summary: row_to_summary(r)?,
            blocks_json: r.get(10)?,
        })
    })
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("note {id}")),
        other => other.into(),
    })
}

pub fn create(conn: &Connection, folder_id: Option<&str>, lang: &str) -> AppResult<NoteFull> {
    let id = new_id();
    let ts = now();
    conn.execute(
        "INSERT INTO notes (id, folder_id, lang, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, folder_id, lang, ts],
    )?;
    get(conn, &id)
}

/// Returns the new `updated_at`.
pub fn save(conn: &Connection, note: &SaveNote) -> AppResult<String> {
    let ts = now();
    let n = conn.execute(
        "UPDATE notes SET title = ?1, preview = ?2, blocks_json = ?3, plain_text = ?4, updated_at = ?5
         WHERE id = ?6 AND deleted_at IS NULL",
        params![note.title, note.preview, note.blocks_json, note.plain_text, ts, note.id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("note {}", note.id)));
    }
    Ok(ts)
}

pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> AppResult<()> {
    conn.execute("UPDATE notes SET pinned = ?1 WHERE id = ?2", params![pinned as i64, id])?;
    Ok(())
}

pub fn set_lang(conn: &Connection, id: &str, lang: &str) -> AppResult<()> {
    conn.execute("UPDATE notes SET lang = ?1 WHERE id = ?2", params![lang, id])?;
    Ok(())
}

pub fn move_to(conn: &Connection, id: &str, folder_id: Option<&str>) -> AppResult<()> {
    conn.execute("UPDATE notes SET folder_id = ?1 WHERE id = ?2", params![folder_id, id])?;
    Ok(())
}

pub fn trash(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE notes SET deleted_at = ?1, pinned = 0 WHERE id = ?2 AND deleted_at IS NULL",
        params![now(), id],
    )?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("UPDATE notes SET deleted_at = NULL WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_forever(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn empty_trash(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute("DELETE FROM notes WHERE deleted_at IS NOT NULL", [])?)
}

/// Apple Notes keeps deleted notes for 30 days; we do the same on startup.
pub fn purge_trash_older_than(conn: &Connection, days: i64) -> AppResult<usize> {
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(days))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    Ok(conn.execute(
        "DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )?)
}

pub fn counts(conn: &Connection) -> AppResult<Counts> {
    let mut c = Counts::default();
    c.all = conn.query_row("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL", [], |r| r.get(0))?;
    c.pinned = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL AND pinned = 1",
        [],
        |r| r.get(0),
    )?;
    c.trash = conn.query_row("SELECT COUNT(*) FROM notes WHERE deleted_at IS NOT NULL", [], |r| r.get(0))?;
    let mut stmt = conn.prepare(
        "SELECT folder_id, COUNT(*) FROM notes WHERE deleted_at IS NULL AND folder_id IS NOT NULL GROUP BY folder_id",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        let (id, n) = row?;
        c.by_folder.insert(id, n);
    }
    Ok(c)
}
