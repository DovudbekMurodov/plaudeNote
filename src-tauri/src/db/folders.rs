use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::{new_id, now};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort: i64,
    pub created_at: String,
}

fn row_to_folder(r: &rusqlite::Row) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: r.get(0)?,
        name: r.get(1)?,
        parent_id: r.get(2)?,
        sort: r.get(3)?,
        created_at: r.get(4)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, parent_id, sort, created_at FROM folders ORDER BY sort, name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], row_to_folder)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn create(conn: &Connection, name: &str) -> AppResult<Folder> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Other("folder name is empty".into()));
    }
    let sort: i64 = conn.query_row("SELECT COALESCE(MAX(sort), 0) + 1 FROM folders", [], |r| r.get(0))?;
    let folder = Folder {
        id: new_id(),
        name: name.to_string(),
        parent_id: None,
        sort,
        created_at: now(),
    };
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, sort, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![folder.id, folder.name, folder.parent_id, folder.sort, folder.created_at],
    )?;
    Ok(folder)
}

pub fn rename(conn: &Connection, id: &str, name: &str) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Other("folder name is empty".into()));
    }
    let n = conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("folder {id}")));
    }
    Ok(())
}

/// Notes inside keep existing with `folder_id = NULL` (they stay in All Notes).
pub fn delete(conn: &Connection, id: &str) -> AppResult<()> {
    let n = conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("folder {id}")));
    }
    Ok(())
}
