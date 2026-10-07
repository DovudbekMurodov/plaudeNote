import type { JSONContent } from "@tiptap/react";

/** Plain text of a Tiptap JSON doc, one line per block (mirrors editor.getText). */
export function docToText(doc: JSONContent): string {
  const lines: string[] = [];
  const walk = (node: JSONContent, acc: string[]) => {
    if (node.type === "text") acc.push(node.text ?? "");
    else if (node.type === "hardBreak") acc.push("\n");
    for (const c of node.content ?? []) walk(c, acc);
  };
  for (const block of doc.content ?? []) {
    const acc: string[] = [];
    walk(block, acc);
    const t = acc.join("");
    if (block.type !== "audio" && block.type !== "transcript") lines.push(t);
  }
  return lines.join("\n");
}

export function deriveFromDoc(doc: JSONContent) {
  const plainText = docToText(doc);
  const lines = plainText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    title: (lines[0] ?? "").slice(0, 200),
    preview: lines.slice(1).join(" ").slice(0, 240),
    plainText,
  };
}

export function parseDoc(json: string): JSONContent {
  try {
    const d = JSON.parse(json);
    return d && d.type === "doc" ? d : { type: "doc", content: [{ type: "paragraph" }] };
  } catch {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
}
