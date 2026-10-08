import { create } from "zustand";
import type { Editor, JSONContent } from "@tiptap/react";
import { api, type AiEvent, type AiNoteResult, type AiTask, type JobEvent, type MindNode, type AiActionItem } from "@/api";
import { useNotes } from "./notes";
import { useUI } from "./ui";
import { useModels, readiness } from "./models";
import { aiNoteToNodes, isAiNoteResult, mindmapNode, textToNodes, todoList, heading, headings } from "@/features/ai/aiNodes";
import { insertAtCursor, insertAtTop, replaceInNote, updateNodeAttrs, removeFromNote } from "@/features/notes/appendToNote";
import { useEditorStore } from "@/features/editor/editorStore";
import { parseDoc } from "@/features/notes/docUtils";

const isSummary = (n: JSONContent) => n.type === "aiSummary";
const isPendingSummary = (n: JSONContent) => n.type === "aiSummary" && !!n.attrs?.pending;

interface AiState {
  /** Note ids with an AI job in flight. */
  busy: Record<string, true>;
  error: string | null;
  subscribe(): () => void;
  /** Transcript → structured note. Auto after the first transcription in a note. */
  noteFromRecording(noteId: string, recordingId: string): Promise<void>;
  /** Rebuild the AI block from every transcript in the note. */
  regenerate(noteId: string): Promise<void>;
  runTask(noteId: string, task: AiTask, text: string, lang: string, opts?: { targetLang?: string; question?: string }): Promise<void>;
  /** Free-form question about the open note. */
  ask(noteId: string, question: string): Promise<void>;
  onJob(e: JobEvent): void;
  llmReady(): boolean;
  currentNoteId(): string | null;
  dismissError(): void;
}

function pendingBlock(lang: string | null, jobId: string | null = null): JSONContent {
  return { type: "aiSummary", attrs: { pending: true, progress: 0, error: null, jobId, model: null, createdAt: null, lang }, content: [] };
}

async function noteHasSummary(noteId: string): Promise<boolean> {
  const editor = useEditorStore.getState().editor;
  const current = useNotes.getState().current;
  if (editor && !editor.isDestroyed && current?.id === noteId) {
    let has = false;
    editor.state.doc.forEach((n) => {
      if (n.type.name === "aiSummary") has = true;
    });
    return has;
  }
  const note = await api.noteGet(noteId);
  return (parseDoc(note.blocksJson).content ?? []).some(isSummary);
}

/** Every transcript in the note, in order, as plain text. */
async function collectTranscripts(noteId: string): Promise<string> {
  const editor = useEditorStore.getState().editor;
  const current = useNotes.getState().current;
  let blocks: JSONContent[] = [];
  if (editor && !editor.isDestroyed && current?.id === noteId) blocks = editor.getJSON().content ?? [];
  else blocks = parseDoc((await api.noteGet(noteId)).blocksJson).content ?? [];
  return blocks
    .filter((b) => b.type === "transcript" && !b.attrs?.pending)
    .map((b) => ((b.attrs?.segments ?? []) as { text: string }[]).map((s) => s.text).join(" "))
    .filter(Boolean)
    .join("\n\n");
}

export const useAi = create<AiState>()((set) => ({
  busy: {},
  error: null,

  subscribe() {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void api
      .onAiReady(async (e: AiEvent) => {
        if (!e.noteId) return;
        set((s) => {
          const busy = { ...s.busy };
          delete busy[e.noteId!];
          return { busy };
        });
        try {
          await applyResult(e);
        } catch (err) {
          set({ error: String(err) });
        }
      })
      .then((u) => (cancelled ? u() : (unsub = u)))
      .catch(console.error);
    return () => {
      cancelled = true;
      unsub?.();
    };
  },

  llmReady() {
    const r = readiness(useModels.getState().models);
    return r.llm && r.runtime;
  },

  currentNoteId() {
    return useNotes.getState().current?.id ?? null;
  },

  onJob(e) {
    if (e.stage !== "summarize" || !e.noteId) return;
    const noteId = e.noteId;
    if (e.status === "queued" || e.status === "running") {
      void updateNodeAttrs(noteId, isPendingSummary, { progress: e.progress, jobId: e.id });
    } else if (e.status === "cancelled") {
      void removeFromNote(noteId, isPendingSummary);
      set((s) => {
        const busy = { ...s.busy };
        delete busy[noteId];
        return { busy };
      });
    } else if (e.status === "failed") {
      void updateNodeAttrs(noteId, isPendingSummary, { pending: false, error: e.error ?? "failed", jobId: null });
      set((s) => {
        const busy = { ...s.busy };
        delete busy[noteId];
        return { busy, error: e.error };
      });
    }
  },

  async noteFromRecording(noteId, recordingId) {
    if (await noteHasSummary(noteId)) return; // second recording in the same note → user decides (Regenerate)
    const chosen = useUI.getState().summaryLang;
    const lang = chosen !== "auto" ? chosen : useNotes.getState().current?.id === noteId ? useNotes.getState().current!.lang : null;
    set((s) => ({ busy: { ...s.busy, [noteId]: true }, error: null }));
    await insertAtTop(noteId, [pendingBlock(lang)]);
    try {
      const { summaryLang: target, aiInstruction } = useUI.getState();
      const jobId = await api.aiNote(noteId, recordingId, { targetLang: target === "auto" ? undefined : target, instruction: aiInstruction });
      await updateNodeAttrs(noteId, isPendingSummary, { jobId });
    } catch (e) {
      await removeFromNote(noteId, isPendingSummary);
      set((s) => {
        const busy = { ...s.busy };
        delete busy[noteId];
        return { busy, error: String(e) };
      });
    }
  },

  async regenerate(noteId) {
    const text = await collectTranscripts(noteId);
    if (!text.trim()) {
      set({ error: "no transcript in this note" });
      return;
    }
    const lang = useNotes.getState().current?.lang ?? useUI.getState().lang;
    const chosen = useUI.getState().summaryLang;
    const blockLang = chosen !== "auto" ? chosen : lang;
    set((s) => ({ busy: { ...s.busy, [noteId]: true }, error: null }));
    const existed = await noteHasSummary(noteId);
    if (existed) await replaceInNote(noteId, isSummary, [pendingBlock(blockLang)]);
    else await insertAtTop(noteId, [pendingBlock(blockLang)]);
    try {
      const { summaryLang: target, aiInstruction } = useUI.getState();
      const jobId = await api.aiTask(noteId, "note", text, lang, { targetLang: target === "auto" ? undefined : target, instruction: aiInstruction });
      await updateNodeAttrs(noteId, isPendingSummary, { jobId });
    } catch (e) {
      await removeFromNote(noteId, isPendingSummary);
      set((s) => {
        const busy = { ...s.busy };
        delete busy[noteId];
        return { busy, error: String(e) };
      });
    }
  },

  async runTask(noteId, task, text, lang, opts = {}) {
    if (!text.trim()) return;
    set((s) => ({ busy: { ...s.busy, [noteId]: true }, error: null }));
    try {
      await api.aiTask(noteId, task, text, lang, { ...opts, instruction: useUI.getState().aiInstruction });
    } catch (e) {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[noteId];
        return { busy, error: String(e) };
      });
    }
  },

  async ask(noteId, question) {
    const editor = useEditorStore.getState().editor;
    if (!editor || !question.trim()) return;
    const { text } = collectNoteText(editor);
    const lang = useUI.getState().summaryLang;
    const noteLang = useNotes.getState().current?.lang ?? "auto";
    await useAi.getState().runTask(noteId, "ask", text, noteLang, { question, targetLang: lang === "auto" ? undefined : lang });
  },

  dismissError() {
    set({ error: null });
  },
}));

async function applyResult(e: AiEvent) {
  const noteId = e.noteId!;
  const lang = e.lang === "auto" ? (useNotes.getState().current?.lang ?? "uz") : e.lang;
  const r = e.result as Record<string, unknown>;
  switch (e.task) {
    case "note": {
      if (!isAiNoteResult(e.result)) return;
      const res = e.result as AiNoteResult;
      const model = await api.llmStatus().then((s) => s.model).catch(() => null);
      const block: JSONContent = {
        type: "aiSummary",
        attrs: { pending: false, progress: 1, error: null, jobId: null, model, createdAt: new Date().toISOString(), lang: lang === "ar" ? "ar" : lang },
        content: aiNoteToNodes(res, lang),
      };
      const title = res.title?.trim();
      if (await noteHasSummary(noteId)) {
        await replaceInNote(noteId, isSummary, [block]);
        if (title) await ensureTitle(noteId, title);
      } else {
        await insertAtTop(noteId, [block], title);
      }
      if (lang === "ar" || lang === "uz" || lang === "en") void useNotes.getState().setLang(noteId, lang);
      return;
    }
    case "mindmap":
      await insertAtCursor(noteId, [mindmapNode(r as unknown as MindNode, lang === "ar" ? "ar" : lang)]);
      return;
    case "todos":
      await insertAtCursor(noteId, [heading(headings(lang).todos), todoList((r.action_items as AiActionItem[]) ?? [])]);
      return;
    case "summary":
      await insertAtCursor(noteId, [heading(headings(lang).summary), ...textToNodes(String(r.text ?? ""))]);
      return;
    case "translate":
      await insertAtCursor(noteId, textToNodes(String(r.text ?? "")));
      return;
    case "ask": {
      const q = String(r.question ?? e.question ?? "");
      const answer = textToNodes(String(r.text ?? ""));
      const header: JSONContent = {
        type: "callout",
        attrs: { emoji: "💬", tone: "purple" },
        content: [
          ...(q ? [{ type: "paragraph", content: [{ type: "text", text: q, marks: [{ type: "bold" }] }] }] : []),
          ...(answer.length ? answer : [{ type: "paragraph" }]),
        ],
      };
      await insertAtCursor(noteId, [header]);
      return;
    }
  }
}

/** Give an untitled note the AI title (first line), leaving existing titles alone. */
async function ensureTitle(noteId: string, title: string) {
  const editor = useEditorStore.getState().editor;
  const current = useNotes.getState().current;
  if (editor && !editor.isDestroyed && current?.id === noteId) {
    const first = editor.state.doc.firstChild;
    const hasText = !!first && first.isTextblock && first.textContent.trim().length > 0;
    if (hasText) return;
    const node = { type: "paragraph", content: [{ type: "text", text: title }] };
    if (first && first.type.name === "paragraph" && first.content.size === 0) editor.chain().insertContentAt({ from: 0, to: first.nodeSize }, node).run();
    else editor.chain().insertContentAt(0, node).run();
    return;
  }
  if (!current?.title?.trim()) await insertAtTop(noteId, [], title);
}

/** Text the AI menu works on: the selection, else the whole note incl. transcript segments. */
export function collectNoteText(editor: Editor): { text: string; fromSelection: boolean } {
  const { from, to, empty } = editor.state.selection;
  if (!empty) return { text: editor.state.doc.textBetween(from, to, "\n"), fromSelection: true };
  const parts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "transcript") {
      const segs = (node.attrs.segments ?? []) as { text: string }[];
      parts.push(segs.map((s) => s.text).join(" "));
      return false;
    }
    if (node.type.name === "aiSummary") return false; // don't feed the AI its own output
    if (node.isTextblock) {
      const t = node.textContent.trim();
      if (t) parts.push(t);
      return false;
    }
    return true;
  });
  return { text: parts.join("\n"), fromSelection: false };
}

/** True when the open editor holds at least one finished transcript. */
export function editorHasTranscript(editor: Editor): boolean {
  let has = false;
  editor.state.doc.forEach((n) => {
    if (n.type.name === "transcript" && !n.attrs.pending && (n.attrs.segments?.length ?? 0) > 0) has = true;
  });
  return has;
}
