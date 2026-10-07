import type { JSONContent } from "@tiptap/react";
import type { AiActionItem, AiNoteResult, ChartSpec, MindNode } from "@/api";

const HEADINGS: Record<string, { summary: string; keyPoints: string; todos: string; decisions: string }> = {
  uz: { summary: "Xulosa", keyPoints: "Asosiy fikrlar", todos: "Vazifalar", decisions: "Qarorlar" },
  ar: { summary: "الملخص", keyPoints: "النقاط الرئيسية", todos: "المهام", decisions: "القرارات" },
  en: { summary: "Summary", keyPoints: "Key points", todos: "Action items", decisions: "Decisions" },
  ru: { summary: "Итоги", keyPoints: "Ключевые пункты", todos: "Задачи", decisions: "Решения" },
};

export function headings(lang: string) {
  return HEADINGS[lang] ?? HEADINGS.en;
}

const text = (s: string): JSONContent[] => (s ? [{ type: "text", text: s }] : []);
export const paragraph = (s: string): JSONContent => ({ type: "paragraph", content: text(s) });
export const heading = (s: string, level = 2): JSONContent => ({ type: "heading", attrs: { level }, content: text(s) });
export const bulletList = (items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.filter(Boolean).map((i) => ({ type: "listItem", content: [paragraph(i)] })),
});

export function todoList(items: AiActionItem[]): JSONContent {
  return {
    type: "taskList",
    content: items
      .filter((i) => i.text?.trim())
      .map((i) => {
        const meta = [i.owner?.trim(), i.due?.trim()].filter(Boolean).join(" · ");
        return {
          type: "taskItem",
          attrs: { checked: false },
          content: [
            {
              type: "paragraph",
              content: [...text(i.text.trim()), ...(meta ? [{ type: "text", text: `  ${meta}`, marks: [{ type: "italic" }] }] : [])],
            },
          ],
        };
      }),
  };
}

export const mindmapNode = (tree: MindNode, lang: string | null): JSONContent => ({ type: "mindmap", attrs: { tree, lang } });
export const chartNode = (spec: ChartSpec, lang: string | null): JSONContent => ({ type: "chart", attrs: { spec, lang } });

/** Multi-line plain text → paragraphs. */
export function textToNodes(s: string): JSONContent[] {
  return s
    .split(/\n{2,}|\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(paragraph);
}

export function isAiNoteResult(v: unknown): v is AiNoteResult {
  return !!v && typeof v === "object" && "summary" in v && "mindmap" in v;
}

/** The structured note, Apple-Notes-style sections. */
export function aiNoteToNodes(r: AiNoteResult, lang: string): JSONContent[] {
  const h = headings(lang);
  const out: JSONContent[] = [];
  if (r.summary?.trim()) out.push(heading(h.summary), paragraph(r.summary.trim()));
  if (r.key_points?.length) out.push(heading(h.keyPoints), bulletList(r.key_points));
  if (r.action_items?.some((i) => i.text?.trim())) out.push(heading(h.todos), todoList(r.action_items));
  if (r.decisions?.length) out.push(heading(h.decisions), bulletList(r.decisions));
  if (r.mindmap?.name) out.push(mindmapNode(r.mindmap, lang === "ar" ? "ar" : lang));
  if (r.chart && r.chart.kind !== "none" && r.chart.categories?.length) out.push(chartNode(r.chart, lang === "ar" ? "ar" : lang));
  return out;
}
