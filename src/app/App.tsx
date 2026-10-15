import { useEffect } from "react";
import { useUI } from "@/store/ui";
import { useNotes } from "@/store/notes";
import { useModels } from "@/store/models";
import { useAppearance } from "./useAppearance";
import { useDragDrop } from "./useDragDrop";
import { AppShell } from "./AppShell";
import { scheduleUpdateCheck } from "@/features/update/updater";

/** Keeps the notes store in step with sidebar selection, search and the selected note. */
function useNotesSync() {
  const selectedFolder = useUI((s) => s.selectedFolder);
  const search = useUI((s) => s.search);
  const selectedNoteId = useUI((s) => s.selectedNoteId);
  const loadFolders = useNotes((s) => s.loadFolders);
  const refresh = useNotes((s) => s.refresh);
  const loadNotes = useNotes((s) => s.loadNotes);
  const openNote = useNotes((s) => s.openNote);

  useEffect(() => {
    void loadFolders();
    void refresh();
  }, [loadFolders, refresh]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes, selectedFolder, search]);

  useEffect(() => {
    void openNote(selectedNoteId);
  }, [openNote, selectedNoteId]);
}

function useShortcuts() {
  const createNote = useNotes((s) => s.createNote);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void createNote();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNote]);
}

export function App() {
  useAppearance();
  useNotesSync();
  useShortcuts();
  useDragDrop();

  const startModels = useModels((s) => s.start);
  useEffect(() => startModels(), [startModels]);
  useEffect(() => scheduleUpdateCheck(), []);

  return <AppShell />;
}
