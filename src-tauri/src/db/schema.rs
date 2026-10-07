use rusqlite::Connection;

use crate::error::AppResult;

/// Append-only list. Index + 1 == resulting `PRAGMA user_version`.
const MIGRATIONS: &[&str] = &[V1];

pub fn migrate(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        conn.execute_batch(&format!(
            "BEGIN;\n{sql}\nPRAGMA user_version = {};\nCOMMIT;",
            i + 1
        ))?;
    }
    Ok(())
}

const V1: &str = r#"
CREATE TABLE folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
    sort       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

-- `rid` is an explicit INTEGER PRIMARY KEY so the FTS external-content rowid
-- stays stable across VACUUM. `id` is the public UUID.
CREATE TABLE notes (
    rid         INTEGER PRIMARY KEY AUTOINCREMENT,
    id          TEXT NOT NULL UNIQUE,
    folder_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
    title       TEXT NOT NULL DEFAULT '',
    preview     TEXT NOT NULL DEFAULT '',
    blocks_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
    plain_text  TEXT NOT NULL DEFAULT '',
    pinned      INTEGER NOT NULL DEFAULT 0,
    lang        TEXT NOT NULL DEFAULT 'uz',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX idx_notes_folder  ON notes(folder_id);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX idx_notes_deleted ON notes(deleted_at);

CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, plain_text,
    content = 'notes', content_rowid = 'rid',
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, plain_text) VALUES (new.rid, new.title, new.plain_text);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, plain_text) VALUES ('delete', old.rid, old.title, old.plain_text);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, plain_text ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, plain_text) VALUES ('delete', old.rid, old.title, old.plain_text);
    INSERT INTO notes_fts(rowid, title, plain_text) VALUES (new.rid, new.title, new.plain_text);
END;

CREATE TABLE tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);
CREATE TABLE note_tags (
    note_id TEXT    NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE recordings (
    id          TEXT PRIMARY KEY,
    note_id     TEXT REFERENCES notes(id) ON DELETE CASCADE,
    path        TEXT NOT NULL,
    duration_ms INTEGER,
    lang        TEXT,
    source      TEXT NOT NULL,            -- 'mic' | 'upload'
    created_at  TEXT NOT NULL
);
CREATE INDEX idx_recordings_note ON recordings(note_id);

CREATE TABLE transcripts (
    id            TEXT PRIMARY KEY,
    recording_id  TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    lang_detected TEXT,
    segments_json TEXT NOT NULL,
    text          TEXT NOT NULL,
    model         TEXT,
    created_at    TEXT NOT NULL
);

CREATE TABLE jobs (
    id           TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    stage        TEXT NOT NULL,           -- decode | transcribe | summarize
    status       TEXT NOT NULL,           -- queued | running | done | failed
    progress     REAL NOT NULL DEFAULT 0,
    error        TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE models (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,       -- stt | llm | runtime
    file             TEXT NOT NULL,
    size             INTEGER,
    sha256           TEXT,
    status           TEXT NOT NULL DEFAULT 'missing',
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT
);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;
