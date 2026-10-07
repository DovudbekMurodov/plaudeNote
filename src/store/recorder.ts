import { create } from "zustand";
import { api, type JobEvent, type Recording } from "@/api";
import { useUI } from "./ui";
import { useNotes } from "./notes";
import { appendToNote, replaceInNote } from "@/features/notes/appendToNote";
import { useAi } from "./ai";

export type RecorderStatus = "idle" | "starting" | "recording" | "stopping";

interface JobState {
  status: JobEvent["status"];
  progress: number;
  error: string | null;
  noteId: string | null;
  stage: JobEvent["stage"];
}

interface RecorderState {
  status: RecorderStatus;
  elapsedMs: number;
  level: number;
  error: string | null;
  /** Active transcription jobs by recording id. */
  jobs: Record<string, JobState>;

  subscribe(): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  importFiles(): Promise<void>;
  dismissError(): void;
}

function audioNode(rec: Recording, title: string) {
  return { type: "audio", attrs: { path: rec.path, title, recordingId: rec.id, durationMs: rec.durationMs } };
}
function pendingTranscriptNode(rec: Recording, lang: string) {
  return { type: "transcript", attrs: { recordingId: rec.id, lang: lang === "auto" ? null : lang, segments: [], pending: true, progress: 0, error: null } };
}

async function ensureNote(): Promise<string> {
  const ui = useUI.getState();
  if (ui.selectedNoteId && useNotes.getState().current?.id === ui.selectedNoteId && !useNotes.getState().current?.deletedAt) {
    return ui.selectedNoteId;
  }
  await useNotes.getState().createNote();
  const id = useUI.getState().selectedNoteId;
  if (!id) throw new Error("could not create a note");
  return id;
}

function recordingTitle(rec: Recording, lang: string): string {
  const d = new Date(rec.createdAt);
  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  const mins = Math.round(rec.durationMs / 60_000);
  const len = mins >= 1 ? `${mins} min` : `${Math.round(rec.durationMs / 1000)} s`;
  return `${rec.source === "mic" ? "🎙" : "📁"} ${time} · ${len}${lang !== "auto" ? ` · ${lang.toUpperCase()}` : ""}`;
}

export const useRecorder = create<RecorderState>()((set, get) => ({
  status: "idle",
  elapsedMs: 0,
  level: 0,
  error: null,
  jobs: {},

  subscribe() {
    const unsubs: Array<() => void> = [];
    let cancelled = false;
    const add = (p: Promise<() => void>) =>
      void p.then((u) => (cancelled ? u() : unsubs.push(u))).catch(console.error);

    add(api.onRecordLevel((e) => set({ level: e.rms, elapsedMs: e.elapsedMs })));
    add(
      api.onJobUpdate((e) => {
        const key = e.stage === "summarize" ? `ai:${e.id}` : e.recordingId;
        set((s) => {
          const jobs = { ...s.jobs };
          if (e.status === "done" || (e.status === "failed" && e.stage === "summarize")) delete jobs[key];
          else jobs[key] = { status: e.status, progress: e.progress, error: e.error, noteId: e.noteId, stage: e.stage };
          return { jobs };
        });
        if (e.stage === "transcribe" && e.noteId && (e.status === "running" || e.status === "failed")) {
          // Keep the placeholder block in the note in sync.
          void replaceInNote(e.noteId, (n) => n.type === "transcript" && n.attrs?.recordingId === e.recordingId && n.attrs?.pending, [
            { type: "transcript", attrs: { recordingId: e.recordingId, lang: null, segments: [], pending: e.status !== "failed", progress: e.progress, error: e.error } },
          ]).catch(console.error);
        }
        if (e.status === "failed") set({ error: e.error ?? "transcription failed" });
      }),
    );
    add(
      api.onTranscriptReady(async (e) => {
        const node = {
          type: "transcript",
          attrs: { recordingId: e.recordingId, lang: e.transcript.langDetected, segments: e.transcript.segments, pending: false, progress: 1, error: null },
        };
        if (e.noteId) {
          await replaceInNote(e.noteId, (n) => n.type === "transcript" && n.attrs?.recordingId === e.recordingId, [node]).catch(console.error);
          if (e.transcript.langDetected) void useNotes.getState().setLang(e.noteId, e.transcript.langDetected);
          // Auto: transcript → structured note (only when the LLM stack is installed).
          if (useAi.getState().llmReady() && e.transcript.segments.length > 0) {
            void useAi.getState().noteFromRecording(e.noteId, e.recordingId);
          }
        }
        set((s) => {
          const jobs = { ...s.jobs };
          delete jobs[e.recordingId];
          return { jobs };
        });
      }),
    );
    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  },

  async start() {
    if (get().status !== "idle") return;
    set({ status: "starting", error: null, elapsedMs: 0, level: 0 });
    try {
      await ensureNote();
      await api.recordingStart();
      set({ status: "recording" });
    } catch (e) {
      set({ status: "idle", error: String(e) });
    }
  },

  async stop() {
    if (get().status !== "recording") return;
    set({ status: "stopping" });
    const lang = useUI.getState().speechLang;
    try {
      const noteId = await ensureNote();
      const rec = await api.recordingStop(noteId, lang);
      set({ status: "idle", elapsedMs: 0, level: 0 });
      if (rec.durationMs < 500) return;
      await appendToNote(noteId, [audioNode(rec, recordingTitle(rec, lang)), pendingTranscriptNode(rec, lang)]);
      set((s) => ({ jobs: { ...s.jobs, [rec.id]: { status: "queued", progress: 0, error: null, noteId, stage: "transcribe" } } }));
      await api.transcribeStart(rec.id, lang);
    } catch (e) {
      set({ status: "idle", error: String(e) });
    }
  },

  async cancel() {
    try {
      await api.recordingCancel();
    } finally {
      set({ status: "idle", elapsedMs: 0, level: 0 });
    }
  },

  async importFiles() {
    const lang = useUI.getState().speechLang;
    let paths: string[] = [];
    try {
      paths = await api.pickAudioFiles();
    } catch (e) {
      set({ error: String(e) });
      return;
    }
    if (!paths.length) return;
    try {
      const noteId = await ensureNote();
      for (const path of paths) {
        const rec = await api.recordingImport(path, noteId, lang);
        const name = path.split("/").pop() ?? "audio";
        await appendToNote(noteId, [audioNode(rec, `📁 ${name}`), pendingTranscriptNode(rec, lang)]);
        set((s) => ({ jobs: { ...s.jobs, [rec.id]: { status: "queued", progress: 0, error: null, noteId, stage: "transcribe" } } }));
        await api.transcribeStart(rec.id, lang);
      }
    } catch (e) {
      set({ error: String(e) });
    }
  },

  dismissError() {
    set({ error: null });
  },
}));
