import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { bytesToBase64, fileExt } from "./base64";
import type { AiEvent, JobEvent, LevelEvent, ModelProgress, TranscriptEvent, TranscriptPartialEvent } from "./types";
import type { Api } from "./types";

export const tauriApi: Api = {
  foldersList: () => invoke("folders_list"),
  folderCreate: (name) => invoke("folder_create", { name }),
  folderRename: (id, name) => invoke("folder_rename", { id, name }),
  folderDelete: (id) => invoke("folder_delete", { id }),

  notesList: (folder, query) => invoke("notes_list", { folder, query: query?.trim() || null }),
  notesCounts: () => invoke("notes_counts"),
  noteGet: (id) => invoke("note_get", { id }),
  noteCreate: (folderId, lang) => invoke("note_create", { folderId, lang }),
  noteSave: (note) => invoke("note_save", { note }),
  noteSetPinned: (id, pinned) => invoke("note_set_pinned", { id, pinned }),
  noteSetLang: (id, lang) => invoke("note_set_lang", { id, lang }),
  noteMove: (id, folderId) => invoke("note_move", { id, folderId }),
  noteTrash: (id) => invoke("note_trash", { id }),
  noteRestore: (id) => invoke("note_restore", { id }),
  noteDeleteForever: (id) => invoke("note_delete_forever", { id }),
  trashEmpty: () => invoke("trash_empty"),

  async attachmentSave(file) {
    const data = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    const path = await invoke<string>("attachment_save", { data, ext: fileExt(file) });
    return convertFileSrc(path);
  },

  modelsList: () => invoke("models_list"),
  modelDownload: (id) => invoke("model_download", { id }),
  modelPause: (id) => invoke("model_pause", { id }),
  modelDelete: (id) => invoke("model_delete", { id }),
  modelImportFile: (id) => invoke("model_import_file", { id }),
  systemInfo: () => invoke("system_info"),
  openModelsWindow: () => invoke("open_models_window"),
  revealModelsDir: () => invoke("reveal_models_dir"),
  onModelProgress: (cb) => listen<ModelProgress>("model:progress", (e) => cb(e.payload)),

  recordingStart: () => invoke("recording_start"),
  recordingStop: (noteId, lang) => invoke("recording_stop", { noteId, lang }),
  recordingCancel: () => invoke("recording_cancel"),
  pickAudioFiles: (prompt) => invoke("pick_media_files", { prompt }),
  attachmentImport: (path) => invoke<string>("attachment_import", { path }).then(convertFileSrc),
  recordingImport: (path, noteId, lang, tempId) => invoke("recording_import", { path, noteId, lang, tempId: tempId ?? null }),
  jobCancel: (jobId) => invoke("job_cancel", { jobId }),
  recordingsList: (noteId) => invoke("recordings_list", { noteId }),
  transcribeStart: (recordingId, lang) => invoke("transcribe_start", { recordingId, lang }),
  transcriptGet: (recordingId) => invoke("transcript_get", { recordingId }),
  audioSrc: (path) => convertFileSrc(path),
  onRecordLevel: (cb) => listen<LevelEvent>("record:level", (e) => cb(e.payload)),
  onJobUpdate: (cb) => listen<JobEvent>("job:update", (e) => cb(e.payload)),
  onTranscriptReady: (cb) => listen<TranscriptEvent>("transcript:ready", (e) => cb(e.payload)),
  onTranscriptPartial: (cb) => listen<TranscriptPartialEvent>("transcript:partial", (e) => cb(e.payload)),

  aiNote: (noteId, recordingId, o = {}) =>
    invoke("ai_note", { noteId, recordingId, targetLang: o.targetLang ?? null, instruction: o.instruction?.trim() || null }),
  aiTask: (noteId, task, text, lang, o = {}) =>
    invoke("ai_task", {
      noteId,
      task,
      text,
      lang,
      targetLang: o.targetLang ?? null,
      instruction: o.instruction?.trim() || null,
      question: o.question?.trim() || null,
    }),
  llmStatus: () => invoke("llm_status"),
  onAiReady: (cb) => listen<AiEvent>("ai:ready", (e) => cb(e.payload)),
};
