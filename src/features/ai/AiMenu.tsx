import { useTranslation } from "react-i18next";
import { CheckSquare, FileText, GitBranch, Languages, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button, Popover } from "@/components/ui";
import { useEditorStore } from "@/features/editor/editorStore";
import { useAi, collectNoteText } from "@/store/ai";
import { useNotes } from "@/store/notes";
import { api, type AiTask } from "@/api";

const item = "flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-start text-[13px] hover:bg-accent hover:text-on-accent [&:hover_svg]:text-on-accent disabled:opacity-40";
const icon = "size-[15px] text-ink-2";

export function AiMenu({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const editor = useEditorStore((s) => s.editor);
  const note = useNotes((s) => s.current);
  const busy = useAi((s) => (note ? !!s.busy[note.id] : false));
  const runTask = useAi((s) => s.runTask);
  const noteFromRecording = useAi((s) => s.noteFromRecording);
  const llmReady = useAi((s) => s.llmReady)();

  const run = (task: AiTask, targetLang?: string) => async () => {
    if (!editor || !note) return;
    const { text } = collectNoteText(editor);
    await runTask(note.id, task, text, note.lang ?? "auto", targetLang);
  };

  const regenerate = async () => {
    if (!note) return;
    const recs = await api.recordingsList(note.id);
    const last = recs[recs.length - 1];
    if (last) await noteFromRecording(note.id, last.id);
  };

  return (
    <Popover
      align="end"
      className="w-[260px]"
      trigger={(open, toggle) => (
        <Button variant="secondary" size="sm" disabled={!enabled} className="gap-1 rounded-full px-2.5" onClick={toggle} aria-expanded={open}>
          {busy ? <Loader2 className="size-[14px] animate-spin text-sys-purple" strokeWidth={2} /> : <Sparkles className="size-[14px] text-sys-purple" strokeWidth={2} />}
          {t("editor.ai")}
        </Button>
      )}
    >
      {!llmReady && (
        <button type="button" className={item} onClick={() => void api.openModelsWindow()}>
          <Sparkles className={icon} strokeWidth={1.9} />
          {t("ai.needModels")}
        </button>
      )}
      <button type="button" className={item} disabled={!llmReady || busy} onClick={() => void regenerate()}>
        <RefreshCw className={icon} strokeWidth={1.9} />
        {t("ai.regenerate")}
      </button>
      <div className="hairline-t mx-2 my-1" />
      <button type="button" className={item} disabled={!llmReady || busy} onClick={run("summary")}>
        <FileText className={icon} strokeWidth={1.9} />
        {t("ai.summary")}
      </button>
      <button type="button" className={item} disabled={!llmReady || busy} onClick={run("todos")}>
        <CheckSquare className={icon} strokeWidth={1.9} />
        {t("ai.todos")}
      </button>
      <button type="button" className={item} disabled={!llmReady || busy} onClick={run("mindmap")}>
        <GitBranch className={icon} strokeWidth={1.9} />
        {t("ai.mindmap")}
      </button>
      <div className="hairline-t mx-2 my-1" />
      <div className="px-2 pb-0.5 pt-1 text-[11px] font-semibold text-ink-3">{t("ai.translate")}</div>
      {(["uz", "ar", "en"] as const).map((l) => (
        <button key={l} type="button" className={item} disabled={!llmReady || busy} onClick={run("translate", l)}>
          <Languages className={icon} strokeWidth={1.9} />
          {t(`record.${l}`)}
        </button>
      ))}
    </Popover>
  );
}
