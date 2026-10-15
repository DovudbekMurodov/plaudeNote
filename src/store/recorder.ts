import { create } from "zustand";
import { api, type JobEvent, type Recording, type Segment } from "@/api";
import type { JSONContent } from "@tiptap/react";
import { useUI } from "./ui";
import i18n from "@/i18n";
import { useNotes } from "./notes";
import { appendToNote, replaceInNote, updateNodeAttrs } from "@/features/notes/appendToNote";
import { useAi } from "./ai";

export type RecorderStatus = "idle" | "starting" | "recording" | "stopping";

interface JobState {
  jobId: string;
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
  /** Import already-known paths (drag & drop). */
  importPaths(paths: string[]): Promise<void>;
  dismissError(): void;
}

function audioNode(rec: Recording, title: string) {
  return { type: "audio", attrs: { path: rec.path, title, recordingId: rec.id, durationMs: rec.durationMs } };
}
function pendingTranscriptNode(recordingId: string, lang: string, stage: "decode" | "queued" | "running") {
  return {
    type: "transcript",
    attrs: { recordingId, lang: lang === "auto" ? null : lang, segments: [], pending: true, stage, progress: 0, error: null, jobId: null },
  };
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const isPendingFor = (recordingId: string) => (n: { type?: string; attrs?: Record<string, unknown> }) =>
  n.type === "transcript" && n.attrs?.recordingId === recordingId && !!n.attrs?.pending;

/**
 * Jobs do not survive a restart (or a force-quit mid-way through a 3-hour file).
 * Any node still marked pending whose job is not live gets an "interrupted" error
 * instead of spinning forever. Returns the fixed doc, or null when nothing changed.
 */
export function reconcilePendingNodes(doc: JSONContent): JSONContent | null {
  const jobs = useRecorder.getState().jobs;
  const live = new Set<string>();
  for (const [key, j] of Object.entries(jobs)) {
    live.add(key);
    live.add(j.jobId);
  }
  let changed = false;
  const content = (doc.content ?? []).map((n) => {
    if (!n.attrs?.pending) return n;
    if (n.type === "transcript" && !live.has(String(n.attrs.recordingId)) && !live.has(String(n.attrs.jobId))) {
      changed = true;
      return { ...n, attrs: { ...n.attrs, pending: false, error: "interrupted", jobId: null } };
    }
    if (n.type === "aiSummary" && !live.has(`ai:${String(n.attrs.jobId)}`)) {
      changed = true;
      return { ...n, attrs: { ...n.attrs, pending: false, error: "interrupted", jobId: null } };
    }
    return n;
  });
  return changed ? { ...doc, content } : null;
}

async function ensureNote(): Promise<string> {
  const ui = useUI.getState();
  if (ui.selectedNoteId && useNotes.getState().current?.id === ui.selectedNoteId && !useNotes.getState().current?.deletedAt) {
    return ui.selectedNoteId;
  }
  await useNotes.getState().createNote();
  const id = useUI.getState().selectedNoteId;
  if (!id) throw new Error(i18n.t("record.errors.noteCreate"));
  return id;
}

function recordingTitle(rec: Recording, lang: string): string {
  const d = new Date(rec.createdAt);
  const time = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  const mins = Math.round(rec.durationMs / 60_000);
  const len = mins >= 1 ? `${mins} ${i18n.t("units.min")}` : `${Math.round(rec.durationMs / 1000)} ${i18n.t("units.sec")}`;
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
        if (e.stage === "summarize") {
          useAi.getState().onJob(e);
          set((s) => {
            const jobs = { ...s.jobs };
            const key = `ai:${e.id}`;
            if (e.status === "queued" || e.status === "running") jobs[key] = { jobId: e.id, status: e.status, progress: e.progress, error: e.error, noteId: e.noteId, stage: e.stage };
            else delete jobs[key];
            return { jobs };
          });
          return;
        }
        // decode + transcribe are keyed by recording id (decode uses the placeholder's temp id)
        set((s) => {
          const jobs = { ...s.jobs };
          if (e.status === "queued" || e.status === "running") jobs[e.recordingId] = { jobId: e.id, status: e.status, progress: e.progress, error: e.error, noteId: e.noteId, stage: e.stage };
          else delete jobs[e.recordingId];
          return { jobs };
        });
        if (!e.noteId) return;
        if (e.stage === "decode") {
          if (e.status === "failed") void updateNodeAttrs(e.noteId, isPendingFor(e.recordingId), { pending: false, error: e.error ?? i18n.t("record.errors.decodeFailed"), jobId: null });
          return;
        }
        if (e.status === "queued" || e.status === "running") {
          // Progress ticks are UI-only: no autosave, no undo step (a 3-hour file sends hundreds).
          void updateNodeAttrs(e.noteId, isPendingFor(e.recordingId), { stage: e.status, progress: e.progress, jobId: e.id }, true);
        } else if (e.status === "failed") {
          void updateNodeAttrs(e.noteId, isPendingFor(e.recordingId), { pending: false, error: e.error ?? i18n.t("record.errors.transcribeFailed"), jobId: null });
          set({ error: e.error ?? i18n.t("record.errors.transcribeFailed") });
        } else if (e.status === "cancelled") {
          void updateNodeAttrs(e.noteId, isPendingFor(e.recordingId), { pending: false, error: "cancelled", jobId: null });
        }
      }),
    );
    add(
      api.onTranscriptPartial((e) => {
        if (!e.noteId || !e.segments.length) return;
        // A window of a long recording finished: show its text right away.
        void updateNodeAttrs(e.noteId, isPendingFor(e.recordingId), (attrs) => ({
          segments: [...((attrs.segments as Segment[] | undefined) ?? []), ...e.segments],
          progress: e.progress,
          stage: "running",
        }));
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
      await appendToNote(noteId, [audioNode(rec, recordingTitle(rec, lang)), pendingTranscriptNode(rec.id, lang, "queued")]);
      const jobId = await api.transcribeStart(rec.id, lang);
      await updateNodeAttrs(noteId, isPendingFor(rec.id), { jobId });
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
    let paths: string[] = [];
    try {
      paths = await api.pickAudioFiles(i18n.t("record.pickPrompt"));
    } catch (e) {
      set({ error: String(e) });
      return;
    }
    await get().importPaths(paths);
  },

  async importPaths(paths) {
    const lang = useUI.getState().speechLang;
    if (!paths.length) return;
    let noteId: string;
    try {
      noteId = await ensureNote();
    } catch (e) {
      set({ error: String(e) });
      return;
    }
    for (const path of paths) {
      const name = path.split("/").pop() ?? "audio";
      const tempId = uid();
      // Placeholder goes in immediately — decoding a long file takes a moment.
      await appendToNote(noteId, [pendingTranscriptNode(tempId, lang, "decode")]);
      set((s) => ({ jobs: { ...s.jobs, [tempId]: { jobId: tempId, status: "running", progress: 0, error: null, noteId, stage: "decode" } } }));
      let rec: Recording;
      try {
        rec = await api.recordingImport(path, noteId, lang, tempId);
      } catch (e) {
        await updateNodeAttrs(noteId, isPendingFor(tempId), { pending: false, error: String(e), jobId: null });
        set((s) => {
          const jobs = { ...s.jobs };
          delete jobs[tempId];
          return { jobs, error: String(e) };
        });
        continue;
      }
      await replaceInNote(noteId, isPendingFor(tempId), [audioNode(rec, `📁 ${name}`), pendingTranscriptNode(rec.id, lang, "queued")]);
      try {
        const jobId = await api.transcribeStart(rec.id, lang);
        await updateNodeAttrs(noteId, isPendingFor(rec.id), { jobId });
      } catch (e) {
        await updateNodeAttrs(noteId, isPendingFor(rec.id), { pending: false, error: String(e), jobId: null });
        set({ error: String(e) });
      }
    }
  },

  dismissError() {
    set({ error: null });
  },
}));
