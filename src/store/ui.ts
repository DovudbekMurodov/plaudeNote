import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UiLang } from "@/i18n";

export type Theme = "system" | "light" | "dark";
export type SpeechLang = "auto" | "uz" | "ar";

/** Built-in smart folders. User folders use their own ids. */
export type SmartFolder = "all" | "recent" | "pinned" | "trash";

interface UIState {
  lang: UiLang;
  theme: Theme;
  speechLang: SpeechLang;
  selectedFolder: string;
  selectedNoteId: string | null;
  search: string;

  setLang: (lang: UiLang) => void;
  setTheme: (theme: Theme) => void;
  setSpeechLang: (lang: SpeechLang) => void;
  selectFolder: (id: string) => void;
  selectNote: (id: string | null) => void;
  setSearch: (q: string) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      lang: "uz",
      theme: "system",
      speechLang: "auto",
      selectedFolder: "all",
      selectedNoteId: null,
      search: "",

      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      setSpeechLang: (speechLang) => set({ speechLang }),
      selectFolder: (selectedFolder) => set({ selectedFolder, search: "" }),
      selectNote: (selectedNoteId) => set({ selectedNoteId }),
      setSearch: (search) => set({ search }),
    }),
    {
      name: "plaudenote.ui",
      partialize: (s) => ({
        lang: s.lang,
        theme: s.theme,
        speechLang: s.speechLang,
        selectedFolder: s.selectedFolder,
        selectedNoteId: s.selectedNoteId,
      }),
    },
  ),
);
