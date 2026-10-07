import { useTranslation } from "react-i18next";
import { useEditorState } from "@tiptap/react";
import {
  Bold, ClipboardCopy, FileDown, Image, Italic, List, ListChecks, ListOrdered, Printer, RotateCcw, Share2, StickyNote, Table, Trash2,
} from "lucide-react";
import { useUI } from "@/store/ui";
import { useNotes } from "@/store/notes";
import { formatFullDate } from "@/lib/dates";
import { IconButton, Button, Popover } from "@/components/ui";
import { RecordBar } from "@/features/recorder/RecordBar";
import { NoteEditor } from "@/features/editor/NoteEditor";
import { useEditorStore } from "@/features/editor/editorStore";
import { pickImage } from "@/features/editor/attachments";
import { copyMarkdown, exportMarkdown, printNote } from "@/features/editor/exportNote";
import { AiMenu } from "@/features/ai/AiMenu";

function Toolbar({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const editor = useEditorStore((s) => s.editor);
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            bold: editor.isActive("bold"),
            italic: editor.isActive("italic"),
            bullet: editor.isActive("bulletList"),
            ordered: editor.isActive("orderedList"),
            task: editor.isActive("taskList"),
            table: editor.isActive("table"),
          }
        : null,
  });
  const can = enabled && !!editor && editor.isEditable;
  const run = (fn: () => void) => () => {
    fn();
    editor?.commands.focus();
  };

  return (
    <div className="editor-toolbar flex items-center gap-0.5">
      <IconButton title={`${t("editor.bold")} (⌘B)`} disabled={!can} active={active?.bold} onClick={run(() => editor?.chain().toggleBold().run())}>
        <Bold />
      </IconButton>
      <IconButton title={`${t("editor.italic")} (⌘I)`} disabled={!can} active={active?.italic} onClick={run(() => editor?.chain().toggleItalic().run())}>
        <Italic />
      </IconButton>
      <div className="mx-1 h-4 w-px bg-line" />
      <IconButton title={t("editor.list")} disabled={!can} active={active?.bullet} onClick={run(() => editor?.chain().toggleBulletList().run())}>
        <List />
      </IconButton>
      <IconButton title={t("editor.orderedList")} disabled={!can} active={active?.ordered} onClick={run(() => editor?.chain().toggleOrderedList().run())}>
        <ListOrdered />
      </IconButton>
      <IconButton title={t("editor.checklist")} disabled={!can} active={active?.task} onClick={run(() => editor?.chain().toggleTaskList().run())}>
        <ListChecks />
      </IconButton>
      <div className="mx-1 h-4 w-px bg-line" />
      <IconButton
        title={t("editor.table")}
        disabled={!can || active?.table}
        onClick={run(() => editor?.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      >
        <Table />
      </IconButton>
      <IconButton title={t("editor.image")} disabled={!can} onClick={() => editor && pickImage(editor)}>
        <Image />
      </IconButton>
    </div>
  );
}

function ShareMenu({ title, enabled }: { title: string; enabled: boolean }) {
  const { t } = useTranslation();
  const editor = useEditorStore((s) => s.editor);
  const item = "flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-start text-[13px] hover:bg-accent hover:text-on-accent [&:hover_svg]:text-on-accent";
  const icon = "size-[15px] text-ink-2";
  return (
    <Popover
      align="end"
      trigger={(open, toggle) => (
        <IconButton title={t("editor.share")} disabled={!enabled} active={open} onClick={toggle}>
          <Share2 />
        </IconButton>
      )}
    >
      <button type="button" className={item} onClick={() => editor && void exportMarkdown(editor, title)}>
        <FileDown className={icon} strokeWidth={1.9} />
        {t("export.markdown")}
      </button>
      <button type="button" className={item} onClick={() => editor && void copyMarkdown(editor)}>
        <ClipboardCopy className={icon} strokeWidth={1.9} />
        {t("export.copyMarkdown")}
      </button>
      <div className="hairline-t mx-2 my-1" />
      <button type="button" className={item} onClick={printNote}>
        <Printer className={icon} strokeWidth={1.9} />
        {t("export.pdf")}
      </button>
    </Popover>
  );
}

export function EditorPane() {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const note = useNotes((s) => s.current);
  const restoreNote = useNotes((s) => s.restoreNote);
  const deleteForever = useNotes((s) => s.deleteForever);
  const inTrash = !!note?.deletedAt;

  return (
    <main className="editor-pane hairline-s relative flex min-w-0 flex-1 flex-col bg-surface">
      <div data-tauri-drag-region className="editor-toolbar flex h-[52px] shrink-0 items-center justify-between px-3 rtl:pl-[84px]">
        <Toolbar enabled={!!note && !inTrash} />
        <div className="flex items-center gap-1">
          <AiMenu enabled={!!note && !inTrash} />
          <ShareMenu title={note?.title ?? ""} enabled={!!note} />
        </div>
      </div>

      {note ? (
        <div key={note.id} className="fade-in editor-scroll flex-1 overflow-y-auto">
          {inTrash && (
            <div className="sticky top-0 z-10 flex items-center justify-center gap-3 bg-sys-orange/15 px-4 py-2 text-[12px] text-ink backdrop-blur-md">
              <span>{t("trash.banner")}</span>
              <Button size="sm" variant="primary" onClick={() => void restoreNote(note.id)}>
                <RotateCcw className="size-3.5" />
                {t("menu.restore")}
              </Button>
              <Button size="sm" variant="danger" onClick={() => void deleteForever(note.id)}>
                <Trash2 className="size-3.5" />
                {t("menu.deleteForever")}
              </Button>
            </div>
          )}
          <article className="note-article mx-auto w-full max-w-[720px] px-12 pb-36 pt-4">
            <p className="note-date text-center text-[11px] text-ink-3">{formatFullDate(note.updatedAt, lang)}</p>
            <div className="mt-4">
              <NoteEditor note={note} readOnly={inTrash} />
            </div>
          </article>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <StickyNote className="size-10 text-ink-3" strokeWidth={1.4} />
          <div className="text-[15px] font-semibold text-ink-2">{t("editor.empty")}</div>
          <div className="text-[12px] text-ink-3">{t("editor.emptyHint")}</div>
        </div>
      )}

      {!inTrash && <RecordBar />}
    </main>
  );
}
