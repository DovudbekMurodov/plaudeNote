import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import { api, type AiEvent, type AiNoteResult, type AiTask, type MindNode, type AiActionItem } from "@/api";
import { useNotes } from "./notes";
import { useModels, readiness } from "./models";
import { aiNoteToNodes, isAiNoteResult, mindmapNode, textToNodes, todoList, heading, headings } from "@/features/ai/aiNodes";
import { insertAtCursor, insertAtTop } from "@/features/notes/appendToNote";

interface AiState {
  /** Note ids with an AI job in flight. */
  busy: Record<string, true>;
  error: string | null;
  subscribe(): () => void;
  /** Transcript → structured note (auto after transcription, or from the menu). */
  noteFromRecording(noteId: string, recordingId: string): Promise<void>;
  runTask(noteId: string, task: AiTask, text: string, lang: string, targetLang?: string): Promise<void>;
  llmReady(): boolean;
  dismissError(): void;
}

export const useAi = create<AiState>()((set) => ({
  busy: {},
  error: null,

  subscribe() {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void api
      .onAiReady(async (e: AiEvent) => {
        if (e.noteId) {
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

  async noteFromRecording(noteId, recordingId) {
    set((s) => ({ busy: { ...s.busy, [noteId]: true }, error: null }));
    try {
      await api.aiNote(noteId, recordingId);
    } catch (e) {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[noteId];
        return { busy, error: String(e) };
      });
    }
  },

  async runTask(noteId, task, text, lang, targetLang) {
    if (!text.trim()) return;
    set((s) => ({ busy: { ...s.busy, [noteId]: true }, error: null }));
    try {
      await api.aiTask(noteId, task, text, lang, targetLang);
    } catch (e) {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[noteId];
        return { busy, error: String(e) };
      });
    }
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
      await insertAtTop(noteId, aiNoteToNodes(res, lang), res.title?.trim());
      if (lang === "ar" || lang === "uz") void useNotes.getState().setLang(noteId, lang);
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
  }
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
    if (node.isTextblock) {
      const t = node.textContent.trim();
      if (t) parts.push(t);
      return false;
    }
    return true;
  });
  return { text: parts.join("\n"), fromSelection: false };
}
