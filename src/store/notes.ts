import { create } from "zustand";
import { reconcilePendingNodes } from "./recorder";
import { deriveFromDoc, parseDoc } from "@/features/notes/docUtils";
import { api, type Counts, type Folder, type NoteFull, type NoteSummary, type SaveNoteInput } from "@/api";
import { useUI } from "./ui";

const EMPTY_COUNTS: Counts = { all: 0, pinned: 0, trash: 0, byFolder: {} };
const SMART = new Set(["all", "recent", "pinned", "trash"]);

function sortNotes(list: NoteSummary[]): NoteSummary[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

interface NotesState {
  folders: Folder[];
  counts: Counts;
  notes: NoteSummary[];
  current: NoteFull | null;
  error: string | null;

  loadFolders(): Promise<void>;
  loadNotes(): Promise<void>;
  loadCounts(): Promise<void>;
  /** notes + counts */
  refresh(): Promise<void>;

  openNote(id: string | null): Promise<void>;
  createNote(): Promise<void>;
  saveNote(input: SaveNoteInput): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setLang(id: string, lang: string): Promise<void>;
  moveNote(id: string, folderId: string | null): Promise<void>;
  trashNote(id: string): Promise<void>;
  restoreNote(id: string): Promise<void>;
  deleteForever(id: string): Promise<void>;
  emptyTrash(): Promise<void>;

  createFolder(name: string): Promise<void>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
}

async function guard<T>(set: (s: Partial<NotesState>) => void, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    set({ error: String(e) });
    return undefined;
  }
}

export const useNotes = create<NotesState>()((set, get) => ({
  folders: [],
  counts: EMPTY_COUNTS,
  notes: [],
  current: null,
  error: null,

  async loadFolders() {
    await guard(set, async () => set({ folders: await api.foldersList() }));
  },
  async loadNotes() {
    const { selectedFolder, search } = useUI.getState();
    await guard(set, async () => set({ notes: await api.notesList(selectedFolder, search) }));
  },
  async loadCounts() {
    await guard(set, async () => set({ counts: await api.notesCounts() }));
  },
  async refresh() {
    await Promise.all([get().loadNotes(), get().loadCounts()]);
  },

  async openNote(id) {
    if (!id) {
      set({ current: null });
      return;
    }
    if (get().current?.id === id) return;
    try {
      const note = await api.noteGet(id);
      // Spinners from a job that died with the previous app run → "interrupted".
      const fixed = reconcilePendingNodes(parseDoc(note.blocksJson));
      if (fixed) {
        note.blocksJson = JSON.stringify(fixed);
        void get().saveNote({ id, blocksJson: note.blocksJson, ...deriveFromDoc(fixed) });
      }
      // Ignore stale responses if the selection moved on meanwhile.
      if (useUI.getState().selectedNoteId === id) set({ current: note });
    } catch {
      // Stale id (note deleted elsewhere, or a persisted id from a previous run).
      if (useUI.getState().selectedNoteId === id) useUI.getState().selectNote(null);
      set({ current: null });
    }
  },

  async createNote() {
    const ui = useUI.getState();
    const folderId = SMART.has(ui.selectedFolder) ? null : ui.selectedFolder;
    const lang = ui.lang === "ar" ? "ar" : "uz";
    await guard(set, async () => {
      const note = await api.noteCreate(folderId, lang);
      if (ui.selectedFolder === "trash" || ui.selectedFolder === "pinned") ui.selectFolder("all");
      set({ current: note });
      ui.selectNote(note.id);
      await get().refresh();
    });
  },

  async saveNote(input) {
    // Optimistic: update list row + current immediately, then persist.
    const patch = { title: input.title, preview: input.preview, updatedAt: new Date().toISOString() };
    set((s) => ({
      notes: sortNotes(s.notes.map((n) => (n.id === input.id ? { ...n, ...patch } : n))),
      current: s.current?.id === input.id ? { ...s.current, ...patch, blocksJson: input.blocksJson } : s.current,
    }));
    await guard(set, async () => {
      const updatedAt = await api.noteSave(input);
      set((s) => ({
        notes: s.notes.map((n) => (n.id === input.id ? { ...n, updatedAt } : n)),
        current: s.current?.id === input.id ? { ...s.current, updatedAt } : s.current,
      }));
    });
  },

  async setPinned(id, pinned) {
    set((s) => ({
      notes: sortNotes(s.notes.map((n) => (n.id === id ? { ...n, pinned } : n))),
      current: s.current?.id === id ? { ...s.current, pinned } : s.current,
    }));
    await guard(set, () => api.noteSetPinned(id, pinned));
    await get().refresh();
  },
  async setLang(id, lang) {
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? { ...n, lang } : n)),
      current: s.current?.id === id ? { ...s.current, lang } : s.current,
    }));
    await guard(set, () => api.noteSetLang(id, lang));
  },
  async moveNote(id, folderId) {
    await guard(set, () => api.noteMove(id, folderId));
    set((s) => ({ current: s.current?.id === id ? { ...s.current, folderId } : s.current }));
    await get().refresh();
  },
  async trashNote(id) {
    await guard(set, () => api.noteTrash(id));
    if (useUI.getState().selectedNoteId === id) useUI.getState().selectNote(null);
    set((s) => ({ current: s.current?.id === id ? null : s.current }));
    await get().refresh();
  },
  async restoreNote(id) {
    await guard(set, () => api.noteRestore(id));
    if (useUI.getState().selectedNoteId === id) useUI.getState().selectNote(null);
    set((s) => ({ current: s.current?.id === id ? null : s.current }));
    await get().refresh();
  },
  async deleteForever(id) {
    await guard(set, () => api.noteDeleteForever(id));
    if (useUI.getState().selectedNoteId === id) useUI.getState().selectNote(null);
    set((s) => ({ current: s.current?.id === id ? null : s.current }));
    await get().refresh();
  },
  async emptyTrash() {
    await guard(set, () => api.trashEmpty());
    useUI.getState().selectNote(null);
    set({ current: null });
    await get().refresh();
  },

  async createFolder(name) {
    await guard(set, async () => {
      const f = await api.folderCreate(name);
      await get().loadFolders();
      useUI.getState().selectFolder(f.id);
    });
  },
  async renameFolder(id, name) {
    await guard(set, () => api.folderRename(id, name));
    await get().loadFolders();
  },
  async deleteFolder(id) {
    await guard(set, () => api.folderDelete(id));
    if (useUI.getState().selectedFolder === id) useUI.getState().selectFolder("all");
    await Promise.all([get().loadFolders(), get().refresh()]);
  },
}));

/** Group notes Apple-Notes style: Pinned, Today, Yesterday, Previous 7 Days, Earlier. */
export type GroupKey = "pinned" | "today" | "yesterday" | "week" | "earlier";
