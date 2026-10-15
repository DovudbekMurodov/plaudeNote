//! Static catalogue of downloadable models. Sizes are exact (HEAD-checked 2026-10-07).

use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Stt,
    Llm,
    Runtime,
}

impl ModelKind {
    pub fn dir_name(self) -> &'static str {
        match self {
            ModelKind::Stt => "stt",
            ModelKind::Llm => "llm",
            ModelKind::Runtime => "runtime",
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: &'static str,
    pub kind: ModelKind,
    pub name: &'static str,
    pub description: &'static str,
    /// File name on disk (for archives: the directory the archive is unpacked into).
    pub file: &'static str,
    pub url: &'static str,
    pub size: u64,
    pub min_ram_gb: u8,
    pub langs: &'static str,
    /// Specialised model: only use for these ISO-639-1 languages (None = general).
    pub langs_only: Option<&'static [&'static str]>,
    /// `.tar.gz` that must be unpacked after download.
    pub archive: bool,
    /// Preferred default of its kind on a 16 GB machine.
    pub default_for_16gb: bool,
    /// Preferred default of its kind on an 8 GB machine.
    pub default_for_8gb: bool,
}

pub const REGISTRY: &[ModelSpec] = &[
    ModelSpec {
        id: "whisper-large-v3-turbo-q5",
        kind: ModelKind::Stt,
        name: "Whisper large-v3 turbo",
        description: "Best quality for Uzbek and Arabic. Q5_0 quantised.",
        file: "ggml-large-v3-turbo-q5_0.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        size: 574_041_195,
        min_ram_gb: 8,
        langs: "ar, en +95",
        langs_only: None,
        archive: false,
        default_for_16gb: true,
        default_for_8gb: true,
    },
    ModelSpec {
        id: "whisper-uzbek-kotib-medium",
        kind: ModelKind::Stt,
        name: "Whisper Uzbek (Kotib, medium)",
        description: "Fine-tuned on 1,600 h of Uzbek speech. Dramatically better Uzbek than turbo; Uzbek only.",
        file: "ggml-uzbek-kotib-medium-q5_0.bin",
        url: "https://huggingface.co/dovudbekm/plaudenote-models/resolve/main/ggml-uzbek-kotib-medium-q5_0.bin",
        size: 539_212_484,
        min_ram_gb: 8,
        langs: "uz",
        langs_only: Some(&["uz"]),
        archive: false,
        default_for_16gb: true,
        default_for_8gb: true,
    },
    ModelSpec {
        id: "whisper-uzbek-rubai-medium",
        kind: ModelKind::Stt,
        name: "Whisper Uzbek (rubaiSTT v2, medium)",
        description: "Fine-tuned on Tashkent-dialect podcasts and news (475 h). Alternative to Kotib; Uzbek only.",
        file: "ggml-uzbek-rubai-medium-q5_0.bin",
        url: "https://huggingface.co/dovudbekm/plaudenote-models/resolve/main/ggml-uzbek-rubai-medium-q5_0.bin",
        size: 539212484,
        min_ram_gb: 8,
        langs: "uz",
        langs_only: Some(&["uz"]),
        archive: false,
        default_for_16gb: false,
        default_for_8gb: false,
    },
    ModelSpec {
        id: "whisper-small-q5",
        kind: ModelKind::Stt,
        name: "Whisper small",
        description: "Fast, lower accuracy. Good for quick drafts.",
        file: "ggml-small-q5_1.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
        size: 190_085_487,
        min_ram_gb: 4,
        langs: "ar, en +95",
        langs_only: None,
        archive: false,
        default_for_16gb: false,
        default_for_8gb: false,
    },
    ModelSpec {
        id: "qwen3.5-4b-q4",
        kind: ModelKind::Llm,
        name: "Qwen3.5 4B",
        description: "Summaries, to-dos and mind maps. 201 languages. Fits 8 GB Macs.",
        file: "Qwen3.5-4B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
        size: 2_740_937_888,
        min_ram_gb: 8,
        langs: "uz, ar, en +198",
        langs_only: None,
        archive: false,
        default_for_16gb: false,
        default_for_8gb: true,
    },
    ModelSpec {
        id: "qwen3.5-9b-q4",
        kind: ModelKind::Llm,
        name: "Qwen3.5 9B",
        description: "Noticeably better Uzbek. Needs 16 GB.",
        file: "Qwen3.5-9B-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
        size: 5_680_522_464,
        min_ram_gb: 16,
        langs: "uz, ar, en +198",
        langs_only: None,
        archive: false,
        default_for_16gb: true,
        default_for_8gb: false,
    },
    ModelSpec {
        id: "gemma-4-e4b-q4",
        kind: ModelKind::Llm,
        name: "Gemma 4 E4B",
        description: "Google's small multilingual model. Alternative to Qwen.",
        file: "gemma-4-E4B-it-Q4_K_M.gguf",
        url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
        size: 4_977_171_584,
        min_ram_gb: 12,
        langs: "uz, ar, en +137",
        langs_only: None,
        archive: false,
        default_for_16gb: false,
        default_for_8gb: false,
    },
    ModelSpec {
        id: "llama-server",
        kind: ModelKind::Runtime,
        name: "llama.cpp server",
        description: "Runs the language model on the GPU (Metal). Required once.",
        file: "llama-cpp",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b11476/llama-b11476-bin-macos-arm64.tar.gz",
        size: 12_012_019,
        min_ram_gb: 0,
        langs: "",
        langs_only: None,
        archive: true,
        default_for_16gb: true,
        default_for_8gb: true,
    },
];

pub fn find(id: &str) -> Option<&'static ModelSpec> {
    REGISTRY.iter().find(|m| m.id == id)
}
