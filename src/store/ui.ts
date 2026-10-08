import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { UiLang } from "@/i18n";

export type Theme = "system" | "light" | "dark";
export type SpeechLang = "auto" | "uz" | "ar";
/** Language the AI note is written in; "auto" = same as the recording. */
export type SummaryLang = "auto" | "uz" | "ar" | "en";

/** Built-in smart folders. User folders use their own ids. */
export type SmartFolder = "all" | "recent" | "pinned" | "trash";

interface UIState {
  lang: UiLang;
  theme: Theme;
  speechLang: SpeechLang;
  summaryLang: SummaryLang;
  /** Extra guidance for every AI request ("formal style", "only vocabulary"…). */
  aiInstruction: string;
  selectedFolder: string;
  selectedNoteId: string | null;
  search: string;

  setLang: (lang: UiLang) => void;
  setTheme: (theme: Theme) => void;
  setSpeechLang: (lang: SpeechLang) => void;
  setSummaryLang: (lang: SummaryLang) => void;
  setAiInstruction: (text: string) => void;
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
      summaryLang: "auto",
      aiInstruction: "",
      selectedFolder: "all",
      selectedNoteId: null,
      search: "",

      setLang: (lang) => set({ lang }),
      setTheme: (theme) => set({ theme }),
      setSpeechLang: (speechLang) => set({ speechLang }),
      setSummaryLang: (summaryLang) => set({ summaryLang }),
      setAiInstruction: (aiInstruction) => set({ aiInstruction }),
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
        summaryLang: s.summaryLang,
        aiInstruction: s.aiInstruction,
        selectedFolder: s.selectedFolder,
        selectedNoteId: s.selectedNoteId,
      }),
    },
  ),
);
