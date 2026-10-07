import { create } from "zustand";
import type { Editor } from "@tiptap/react";

interface EditorStore {
  editor: Editor | null;
  setEditor: (e: Editor | null) => void;
}

/** The live Tiptap instance, so the title-bar toolbar can drive it. */
export const useEditorStore = create<EditorStore>()((set) => ({
  editor: null,
  setEditor: (editor) => {
    if (import.meta.env.DEV) (window as unknown as { __editor?: Editor | null }).__editor = editor;
    set({ editor });
  },
}));
