import type { Editor, Range } from "@tiptap/core";
import {
  CheckSquare, ChevronRight, Code2, Heading1, Heading2, Heading3, Image as ImageIcon, Lightbulb, List, ListOrdered,
  Minus, Quote, Table, Type, type LucideIcon,
} from "lucide-react";
import i18n from "@/i18n";
import { pickImage } from "../attachments";

export interface SlashItem {
  id: string;
  labelKey: string;
  icon: LucideIcon;
  keywords: string[];
  run: (ctx: { editor: Editor; range: Range }) => void;
}

type Chain = ReturnType<Editor["chain"]>;
const block = (fn: (c: Chain) => Chain) => ({ editor, range }: { editor: Editor; range: Range }) =>
  fn(editor.chain().focus().deleteRange(range)).run();

export const SLASH_ITEMS: SlashItem[] = [
  { id: "text", labelKey: "slash.text", icon: Type, keywords: ["text", "paragraph", "matn", "نص"], run: block((c) => c.setParagraph()) },
  { id: "h1", labelKey: "slash.h1", icon: Heading1, keywords: ["heading", "h1", "sarlavha", "عنوان"], run: block((c) => c.setHeading({ level: 1 })) },
  { id: "h2", labelKey: "slash.h2", icon: Heading2, keywords: ["heading", "h2", "sarlavha", "عنوان"], run: block((c) => c.setHeading({ level: 2 })) },
  { id: "h3", labelKey: "slash.h3", icon: Heading3, keywords: ["heading", "h3", "sarlavha", "عنوان"], run: block((c) => c.setHeading({ level: 3 })) },
  { id: "bullet", labelKey: "slash.bullet", icon: List, keywords: ["list", "bullet", "royxat", "قائمة"], run: block((c) => c.toggleBulletList()) },
  { id: "numbered", labelKey: "slash.numbered", icon: ListOrdered, keywords: ["list", "numbered", "ordered", "raqam", "مرقمة"], run: block((c) => c.toggleOrderedList()) },
  { id: "task", labelKey: "slash.task", icon: CheckSquare, keywords: ["todo", "task", "check", "vazifa", "مهمة"], run: block((c) => c.toggleTaskList()) },
  { id: "toggle", labelKey: "slash.toggle", icon: ChevronRight, keywords: ["toggle", "details", "collapse", "yig", "طي"], run: block((c) => c.setDetails()) },
  { id: "callout", labelKey: "slash.callout", icon: Lightbulb, keywords: ["callout", "note", "info", "eslatma", "تنبيه"], run: block((c) => c.toggleCallout()) },
  { id: "quote", labelKey: "slash.quote", icon: Quote, keywords: ["quote", "blockquote", "iqtibos", "اقتباس"], run: block((c) => c.toggleBlockquote()) },
  { id: "code", labelKey: "slash.code", icon: Code2, keywords: ["code", "kod", "كود"], run: block((c) => c.toggleCodeBlock()) },
  { id: "table", labelKey: "slash.table", icon: Table, keywords: ["table", "jadval", "جدول"], run: block((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
  { id: "divider", labelKey: "slash.divider", icon: Minus, keywords: ["divider", "hr", "line", "chiziq", "فاصل"], run: block((c) => c.setHorizontalRule()) },
  {
    id: "image",
    labelKey: "slash.image",
    icon: ImageIcon,
    keywords: ["image", "photo", "rasm", "صورة"],
    run: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      pickImage(editor);
    },
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter(
    (it) => i18n.t(it.labelKey).toLowerCase().includes(q) || it.keywords.some((k) => k.startsWith(q)),
  );
}
