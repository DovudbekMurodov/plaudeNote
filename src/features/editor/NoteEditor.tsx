import { useCallback, useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import type { NoteFull, SaveNoteInput } from "@/api";
import { useNotes } from "@/store/notes";
import i18n, { isRtl } from "@/i18n";
import { useEditorStore } from "./editorStore";
import { buildExtensions } from "./extensions";
import { insertFiles } from "./attachments";
import { EditorBubbleMenu } from "./EditorBubbleMenu";
import { BlockDragHandle } from "./BlockDragHandle";

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };
const SAVE_DELAY_MS = 500;

function parseDoc(json: string): JSONContent {
  try {
    const d = JSON.parse(json);
    return d && d.type === "doc" ? d : EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

/** Apple Notes rule: first non-empty line is the title, the rest is the preview. */
function derive(editor: Editor, id: string): SaveNoteInput {
  const plainText = editor.getText({ blockSeparator: "\n" });
  const lines = plainText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    id,
    title: (lines[0] ?? "").slice(0, 200),
    preview: lines.slice(1).join(" ").slice(0, 240),
    plainText,
    blocksJson: JSON.stringify(editor.getJSON()),
  };
}

interface Props {
  note: NoteFull;
  readOnly?: boolean;
}

export function NoteEditor({ note, readOnly = false }: Props) {
  const saveNote = useNotes((s) => s.saveNote);
  const setEditor = useEditorStore((s) => s.setEditor);

  const pending = useRef<SaveNoteInput | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    const p = pending.current;
    if (p) {
      pending.current = null;
      void saveNote(p);
    }
  }, [saveNote]);

  // Built once per mount. The placeholder reads i18n lazily, so a language switch
  // still shows up without recreating the editor (recreating it mid-typing kills
  // the slash menu, selection and undo history).
  const extensions = useMemo(
    () =>
      buildExtensions({
        placeholder: (pos) => (pos === 0 ? i18n.t("editor.titlePlaceholder") : i18n.t("editor.bodyPlaceholder")),
        onFiles: (editor, files, pos) => void insertFiles(editor as Editor, files, pos),
      }),
    [],
  );

  const editor = useEditor(
    {
      extensions,
      content: parseDoc(note.blocksJson),
      editable: !readOnly,
      autofocus: !readOnly && note.title === "" ? "end" : false,
      editorProps: {
        attributes: { class: "note-editor", spellcheck: "true" },
      },
      onUpdate: ({ editor }) => {
        pending.current = derive(editor, note.id);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
      },
    },
    [note.id, readOnly],
  );

  // Expose the instance to the toolbar; flush unsaved edits when the note (or editor) goes away.
  useEffect(() => {
    setEditor(editor);
    return () => {
      flush();
      setEditor(null);
    };
  }, [editor, setEditor, flush]);

  // Don't lose the last keystrokes if the window hides or loses focus.
  useEffect(() => {
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [flush]);

  return (
    <>
      <EditorContent editor={editor} dir={isRtl(note.lang) ? "rtl" : "ltr"} className="note-editor-host" />
      {editor && !readOnly && (
        <>
          <EditorBubbleMenu editor={editor} />
          <BlockDragHandle editor={editor} />
        </>
      )}
    </>
  );
}
