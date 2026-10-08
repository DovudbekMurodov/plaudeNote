export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
  createdAt: string;
}

export interface NoteSummary {
  id: string;
  folderId: string | null;
  title: string;
  preview: string;
  pinned: boolean;
  lang: string;
  hasAudio: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteFull extends NoteSummary {
  /** Tiptap document JSON, serialised. */
  blocksJson: string;
}

export interface Counts {
  all: number;
  pinned: number;
  trash: number;
  byFolder: Record<string, number>;
}

export interface SaveNoteInput {
  id: string;
  title: string;
  preview: string;
  blocksJson: string;
  plainText: string;
}

/** Smart folder ids understood by `notesList`; anything else is a folder id. */
export type FolderFilter = "all" | "recent" | "pinned" | "trash" | (string & {});

export interface Api extends AttachmentApi, ModelsApi, RecorderApi, AiApi {
  foldersList(): Promise<Folder[]>;
  folderCreate(name: string): Promise<Folder>;
  folderRename(id: string, name: string): Promise<void>;
  folderDelete(id: string): Promise<void>;

  notesList(folder: FolderFilter, query?: string): Promise<NoteSummary[]>;
  notesCounts(): Promise<Counts>;
  noteGet(id: string): Promise<NoteFull>;
  noteCreate(folderId: string | null, lang: string): Promise<NoteFull>;
  /** Returns the new updatedAt. */
  noteSave(note: SaveNoteInput): Promise<string>;
  noteSetPinned(id: string, pinned: boolean): Promise<void>;
  noteSetLang(id: string, lang: string): Promise<void>;
  noteMove(id: string, folderId: string | null): Promise<void>;
  noteTrash(id: string): Promise<void>;
  noteRestore(id: string): Promise<void>;
  noteDeleteForever(id: string): Promise<void>;
  trashEmpty(): Promise<number>;
}

export interface AttachmentApi {
  /** Persist a file and return a URL the webview can load (asset:// in Tauri, data: in browser). */
  attachmentSave(file: File): Promise<string>;
}

export type ModelKind = "stt" | "llm" | "runtime";
export type ModelStatus = "missing" | "downloading" | "paused" | "extracting" | "ready" | "error";

export interface ModelInfo {
  id: string;
  kind: ModelKind;
  name: string;
  description: string;
  file: string;
  url: string;
  size: number;
  minRamGb: number;
  langs: string;
  archive: boolean;
  defaultFor16gb: boolean;
  defaultFor8gb: boolean;
  status: ModelStatus;
  downloadedBytes: number;
  bytesPerSec: number;
  error: string | null;
  path: string | null;
}

export interface ModelProgress {
  id: string;
  status: ModelStatus;
  downloadedBytes: number;
  totalBytes: number;
  bytesPerSec: number;
  error: string | null;
}

export interface SystemInfo {
  ramGb: number;
  arch: string;
  os: string;
  cpu: string;
  diskFreeBytes: number | null;
}

export interface ModelsApi {
  modelsList(): Promise<ModelInfo[]>;
  modelDownload(id: string): Promise<void>;
  modelPause(id: string): Promise<void>;
  modelDelete(id: string): Promise<void>;
  systemInfo(): Promise<SystemInfo>;
  openModelsWindow(): Promise<void>;
  revealModelsDir(): Promise<void>;
  /** Subscribe to download progress; returns an unsubscribe function. */
  onModelProgress(cb: (p: ModelProgress) => void): Promise<() => void>;
}

export interface Recording {
  id: string;
  noteId: string | null;
  path: string;
  durationMs: number;
  lang: string | null;
  source: "mic" | "upload";
  createdAt: string;
}

export interface Segment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface Transcript {
  id: string;
  recordingId: string;
  langDetected: string | null;
  segments: Segment[];
  text: string;
  model: string | null;
  createdAt: string;
}

export interface JobEvent {
  id: string;
  recordingId: string;
  noteId: string | null;
  stage: "decode" | "transcribe" | "summarize";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  error: string | null;
}

export interface TranscriptEvent {
  recordingId: string;
  noteId: string | null;
  transcript: Transcript;
}

export interface LevelEvent {
  rms: number;
  peak: number;
  elapsedMs: number;
}

export interface RecorderApi {
  recordingStart(): Promise<{ id: string; path: string }>;
  recordingStop(noteId: string | null, lang: string): Promise<Recording>;
  recordingCancel(): Promise<void>;
  /** Native file picker for audio/video; returns absolute paths (empty if cancelled). */
  pickAudioFiles(prompt: string): Promise<string[]>;
  /** Copy a dropped image into the attachments folder; returns a URL the webview can load. */
  attachmentImport(path: string): Promise<string>;
  /** `tempId` is echoed back in `decode` job events so the UI can match its placeholder. */
  recordingImport(path: string, noteId: string | null, lang: string, tempId?: string): Promise<Recording>;
  /** Cancel a queued/running transcription or AI job. */
  jobCancel(jobId: string): Promise<boolean>;
  recordingsList(noteId: string): Promise<Recording[]>;
  transcribeStart(recordingId: string, lang: string): Promise<string>;
  transcriptGet(recordingId: string): Promise<Transcript | null>;
  /** URL the webview can play for a recording path. */
  audioSrc(path: string): string;
  onRecordLevel(cb: (e: LevelEvent) => void): Promise<() => void>;
  onJobUpdate(cb: (e: JobEvent) => void): Promise<() => void>;
  onTranscriptReady(cb: (e: TranscriptEvent) => void): Promise<() => void>;
}

export type AiTask = "note" | "mindmap" | "todos" | "summary" | "translate" | "ask";

export interface AiOptions {
  targetLang?: string;
  /** Extra guidance appended to the system prompt. */
  instruction?: string;
  /** For the `ask` task. */
  question?: string;
}

export interface MindNode {
  name: string;
  children?: MindNode[];
}

export interface ChartSpec {
  kind: "none" | "bar" | "line" | "pie";
  title: string;
  categories: string[];
  values: number[];
}

export interface AiActionItem {
  text: string;
  owner: string;
  due: string;
}

export interface AiNoteResult {
  title: string;
  summary: string;
  key_points: string[];
  action_items: AiActionItem[];
  decisions: string[];
  mindmap: MindNode;
  chart: ChartSpec;
}

export interface AiEvent {
  jobId: string;
  noteId: string | null;
  recordingId: string | null;
  task: AiTask;
  lang: string;
  result: unknown;
  /** Echoed for `ask`. */
  question?: string | null;
}

export interface LlmStatus {
  running: boolean;
  model: string | null;
  port: number | null;
}

export interface AiApi {
  /** Structured note from a recording's transcript. Returns job id; result via onAiReady. */
  aiNote(noteId: string, recordingId: string, opts?: AiOptions): Promise<string>;
  aiTask(noteId: string | null, task: AiTask, text: string, lang: string, opts?: AiOptions): Promise<string>;
  llmStatus(): Promise<LlmStatus>;
  onAiReady(cb: (e: AiEvent) => void): Promise<() => void>;
}
