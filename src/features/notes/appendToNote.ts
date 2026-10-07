import type { JSONContent } from "@tiptap/react";
import { api } from "@/api";
import { useNotes } from "@/store/notes";
import { useEditorStore } from "@/features/editor/editorStore";
import { deriveFromDoc, parseDoc } from "./docUtils";

/**
 * Append block nodes to a note. If that note is open in the editor, insert
 * live (so undo and autosave behave); otherwise patch the stored JSON.
 */
export async function appendToNote(noteId: string, nodes: JSONContent[]) {
  const editor = useEditorStore.getState().editor;
  const current = useNotes.getState().current;
  if (editor && !editor.isDestroyed && current?.id === noteId) {
    const end = editor.state.doc.content.size;
    editor.chain().insertContentAt(end, nodes).run();
    return;
  }
  const note = await api.noteGet(noteId);
  const doc = parseDoc(note.blocksJson);
  doc.content = [...(doc.content ?? []), ...nodes];
  await useNotes.getState().saveNote({ id: noteId, blocksJson: JSON.stringify(doc), ...deriveFromDoc(doc) });
}

/** Replace a block node whose attrs match the predicate (e.g. swap a placeholder for the transcript). */
export async function replaceInNote(noteId: string, match: (n: JSONContent) => boolean, replacement: JSONContent[]) {
  const editor = useEditorStore.getState().editor;
  const current = useNotes.getState().current;
  if (editor && !editor.isDestroyed && current?.id === noteId) {
    let found: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found) return false;
      if (match(node.toJSON() as JSONContent)) found = { from: pos, to: pos + node.nodeSize };
      return !found;
    });
    if (found) editor.chain().insertContentAt(found, replacement).run();
    else editor.chain().insertContentAt(editor.state.doc.content.size, replacement).run();
    return;
  }
  const note = await api.noteGet(noteId);
  const doc = parseDoc(note.blocksJson);
  const idx = (doc.content ?? []).findIndex(match);
  if (idx >= 0) doc.content!.splice(idx, 1, ...replacement);
  else doc.content = [...(doc.content ?? []), ...replacement];
  await useNotes.getState().saveNote({ id: noteId, blocksJson: JSON.stringify(doc), ...deriveFromDoc(doc) });
}

function hasTitle(doc: JSONContent): boolean {
  const first = doc.content?.[0];
  if (!first || (first.type !== "paragraph" && first.type !== "heading")) return false;
  return (first.content ?? []).some((c) => c.type === "text" && c.text?.trim());
}

/**
 * Insert AI sections at the top of the note (after the title line). If the note
 * has no title yet, `title` becomes the first line.
 */
export async function insertAtTop(noteId: string, nodes: JSONContent[], title?: string) {
  const editor = useEditorStore.getState().editor;
  const current = useNotes.getState().current;
  if (editor && !editor.isDestroyed && current?.id === noteId) {
    const doc = editor.getJSON();
    const titled = hasTitle(doc);
    const first = editor.state.doc.firstChild;
    const pos = titled && first ? first.nodeSize : 0;
    const content = titled || !title ? nodes : [{ type: "paragraph", content: [{ type: "text", text: title }] }, ...nodes];
    // Drop a leading empty paragraph so the AI title becomes line 1.
    if (!titled && first && first.type.name === "paragraph" && first.content.size === 0) {
      editor.chain().insertContentAt({ from: 0, to: first.nodeSize }, content).run();
    } else {
      editor.chain().insertContentAt(pos, content).run();
    }
    return;
  }
  const note = await api.noteGet(noteId);
  const doc = parseDoc(note.blocksJson);
  const titled = hasTitle(doc);
  const body = doc.content ?? [];
  const content = titled || !title ? nodes : [{ type: "paragraph", content: [{ type: "text", text: title }] }, ...nodes];
  if (!titled && body[0]?.type === "paragraph" && !(body[0].content?.length)) body.shift();
  doc.content = titled ? [body[0], ...content, ...body.slice(1)] : [...content, ...body];
  await useNotes.getState().saveNote({ id: noteId, blocksJson: JSON.stringify(doc), ...deriveFromDoc(doc) });
}

/** Insert at the cursor when the note is open, else append. */
export async function insertAtCursor(noteId: string, nodes: JSONContent[]) {
  const editor = useEditorStore.getState().editor;
  const current = useNotes.getState().current;
  if (editor && !editor.isDestroyed && current?.id === noteId) {
    editor.chain().focus().insertContent(nodes).run();
    return;
  }
  await appendToNote(noteId, nodes);
}
