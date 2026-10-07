import type { Editor } from "@tiptap/react";
import { isTauri } from "@/lib/platform";

function safeName(title: string, ext: string) {
  const base = (title || "note").replace(/[\\/:*?"<>|\n]+/g, "-").trim().slice(0, 80) || "note";
  return `${base}.${ext}`;
}

export function toMarkdown(editor: Editor): string {
  return editor.getMarkdown();
}

export async function copyMarkdown(editor: Editor) {
  await navigator.clipboard.writeText(toMarkdown(editor));
}

export async function exportMarkdown(editor: Editor, title: string) {
  const md = toMarkdown(editor);
  const name = safeName(title, "md");
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: name, filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (path) await writeTextFile(path, md);
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** PDF = the system print dialog; print CSS hides everything but the note. */
export function printNote() {
  window.print();
}
