import type { Editor } from "@tiptap/react";
import { api } from "@/api";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Persist dropped/pasted/picked images and insert them as image nodes. */
export async function insertFiles(editor: Editor, files: File[], pos?: number) {
  for (const file of files) {
    if (!IMAGE_TYPES.has(file.type)) continue;
    const src = await api.attachmentSave(file);
    const node = { type: "image", attrs: { src, alt: file.name } };
    if (pos !== undefined) editor.chain().focus().insertContentAt(pos, node).run();
    else editor.chain().focus().insertContent(node).run();
  }
}

export function pickImage(editor: Editor) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.multiple = true;
  input.onchange = () => void insertFiles(editor, Array.from(input.files ?? []));
  input.click();
}
