//! Prompt + JSON-schema per AI task. Schemas are deliberately non-recursive
//! (explicit depth) so llama.cpp's grammar conversion stays simple and fast.

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Task {
    /// Full structured note from a transcript.
    Note,
    Mindmap,
    Todos,
    Summary,
    Translate,
}

pub fn language_name(code: &str) -> &'static str {
    match code {
        "uz" => "Uzbek (Latin script)",
        "ar" => "Arabic",
        "en" => "English",
        "ru" => "Russian",
        "tr" => "Turkish",
        _ => "the same language as the input",
    }
}

fn node_schema(depth: u8) -> Value {
    if depth == 0 {
        json!({ "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] })
    } else {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "children": { "type": "array", "items": node_schema(depth - 1), "maxItems": 8 }
            },
            "required": ["name", "children"]
        })
    }
}

pub fn mindmap_schema() -> Value {
    node_schema(3)
}

pub fn chart_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "kind": { "type": "string", "enum": ["none", "bar", "line", "pie"] },
            "title": { "type": "string" },
            "categories": { "type": "array", "items": { "type": "string" }, "maxItems": 12 },
            "values": { "type": "array", "items": { "type": "number" }, "maxItems": 12 }
        },
        "required": ["kind", "title", "categories", "values"]
    })
}

pub fn note_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "title": { "type": "string" },
            "summary": { "type": "string" },
            "key_points": { "type": "array", "items": { "type": "string" }, "maxItems": 10 },
            "action_items": {
                "type": "array",
                "maxItems": 12,
                "items": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string" },
                        "owner": { "type": "string" },
                        "due": { "type": "string" }
                    },
                    "required": ["text", "owner", "due"]
                }
            },
            "decisions": { "type": "array", "items": { "type": "string" }, "maxItems": 8 },
            "mindmap": mindmap_schema(),
            "chart": chart_schema()
        },
        "required": ["title", "summary", "key_points", "action_items", "decisions", "mindmap", "chart"]
    })
}

pub fn todos_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "action_items": {
                "type": "array",
                "maxItems": 20,
                "items": {
                    "type": "object",
                    "properties": { "text": { "type": "string" }, "owner": { "type": "string" }, "due": { "type": "string" } },
                    "required": ["text", "owner", "due"]
                }
            }
        },
        "required": ["action_items"]
    })
}

pub fn text_schema() -> Value {
    json!({ "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] })
}

pub struct Prompt {
    pub system: String,
    pub user: String,
    pub schema: Value,
    pub max_tokens: u32,
}

/// `lang` is the language of the input (and of the output), ISO-639-1 or "auto".
pub fn build(task: Task, input: &str, lang: &str, target_lang: Option<&str>) -> Prompt {
    let out_lang = language_name(lang);
    let base = format!(
        "You are a meticulous note-taking assistant inside a notes app. The input is a transcript of a voice recording \
         (it may contain speech-recognition mistakes; silently fix obvious ones). Write ALL output text in {out_lang}. \
         Never add facts that are not in the input. Be concise and concrete. Respond with JSON only."
    );
    match task {
        Task::Note => Prompt {
            system: format!(
                "{base} Produce: a short title (max 8 words); a summary (2–4 sentences); key points; action items \
                 (owner and due may be empty strings when unknown); decisions (empty array if none); a mind map \
                 (root = the topic, 3–6 branches, each with 2–5 short leaves, names ≤ 6 words); and a chart ONLY if \
                 the input contains comparable numbers (otherwise kind = \"none\" with empty arrays)."
            ),
            user: input.to_string(),
            schema: note_schema(),
            max_tokens: 3000,
        },
        Task::Mindmap => Prompt {
            system: format!("{base} Produce a mind map: root = the topic, 3–7 branches, each with 2–6 short leaves (names ≤ 6 words)."),
            user: input.to_string(),
            schema: mindmap_schema(),
            max_tokens: 1500,
        },
        Task::Todos => Prompt {
            system: format!("{base} Extract every task, commitment or follow-up as action items. Owner/due are empty strings when unknown."),
            user: input.to_string(),
            schema: todos_schema(),
            max_tokens: 1200,
        },
        Task::Summary => Prompt {
            system: format!("{base} Write a tight summary of the input in 3–6 sentences as plain text (field `text`)."),
            user: input.to_string(),
            schema: text_schema(),
            max_tokens: 800,
        },
        Task::Translate => {
            let to = language_name(target_lang.unwrap_or("en"));
            Prompt {
                system: format!(
                    "You are a professional translator. Translate the input into {to}, preserving meaning, tone and paragraph breaks. \
                     Respond with JSON only: {{\"text\": \"<translation>\"}}."
                ),
                user: input.to_string(),
                schema: text_schema(),
                max_tokens: 4000,
            }
        }
    }
}
