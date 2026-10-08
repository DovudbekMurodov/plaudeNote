import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditorState } from "@tiptap/react";
import { Loader2, MessageCircleQuestion, Send, Sparkles } from "lucide-react";
import { Button, SegmentedControl } from "@/components/ui";
import { useEditorStore } from "@/features/editor/editorStore";
import { useAi, editorHasTranscript } from "@/store/ai";
import { useNotes } from "@/store/notes";
import { useUI, type SummaryLang } from "@/store/ui";
import { api } from "@/api";

/** Sits under the toolbar once a note has a transcript: make/redo the AI note in a chosen language. */
export function AiBar() {
  const { t } = useTranslation();
  const editor = useEditorStore((s) => s.editor);
  const note = useNotes((s) => s.current);
  const busy = useAi((s) => (note ? !!s.busy[note.id] : false));
  const regenerate = useAi((s) => s.regenerate);
  const llmReady = useAi((s) => s.llmReady)();
  const summaryLang = useUI((s) => s.summaryLang);
  const setSummaryLang = useUI((s) => s.setSummaryLang);
  const instruction = useUI((s) => s.aiInstruction);
  const setInstruction = useUI((s) => s.setAiInstruction);
  const ask = useAi((s) => s.ask);
  const [question, setQuestion] = useState("");

  const info = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            hasTranscript: editorHasTranscript(editor),
            hasSummary: editor.state.doc.content.content.some((n) => n.type.name === "aiSummary"),
          }
        : null,
  });

  if (!note || note.deletedAt || !info?.hasTranscript) return null;

  const options: { value: SummaryLang; label: string }[] = [
    { value: "auto", label: t("ai.langAuto") },
    { value: "uz", label: t("record.uz") },
    { value: "ar", label: t("record.ar") },
    { value: "en", label: t("record.en") },
  ];

  const submitQuestion = () => {
    const q = question.trim();
    if (!q || busy || !llmReady) return;
    setQuestion("");
    void ask(note.id, q);
  };

  const field =
    "h-7 min-w-0 flex-1 rounded-[7px] bg-control px-2.5 text-[12px] text-ink placeholder:text-ink-3 outline-none focus:ring-[3px] focus:ring-accent/35";

  return (
    <div className="ai-bar hairline-b flex flex-col gap-1.5 px-4 py-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        disabled={busy || !llmReady}
        onClick={() => (llmReady ? void regenerate(note.id) : void api.openModelsWindow())}
        className="gap-1.5 rounded-full px-3"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" strokeWidth={2} /> : <Sparkles className="size-3.5" strokeWidth={2.2} />}
        {busy ? t("ai.pendingShort") : info.hasSummary ? t("ai.regenerateShort") : t("ai.makeNote")}
      </Button>
      <span className="ms-1 text-ink-3">{t("ai.outLang")}</span>
      <SegmentedControl value={summaryLang} options={options} onChange={setSummaryLang} size="sm" />
      {!llmReady && (
        <button type="button" className="text-accent hover:underline" onClick={() => void api.openModelsWindow()}>
          {t("ai.needModels")}
        </button>
      )}
      <input
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        placeholder={t("ai.instructionPlaceholder")}
        className={field}
        title={t("ai.instructionHint")}
      />
      </div>
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-4 shrink-0 text-sys-purple" strokeWidth={2} />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitQuestion()}
          placeholder={t("ai.askPlaceholder")}
          className={field}
          disabled={!llmReady}
        />
        <Button variant="secondary" size="sm" disabled={busy || !llmReady || !question.trim()} onClick={submitQuestion} className="gap-1">
          <Send className="size-3.5" strokeWidth={2} />
          {t("ai.ask")}
        </Button>
      </div>
    </div>
  );
}
