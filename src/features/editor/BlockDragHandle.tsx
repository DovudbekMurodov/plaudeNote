import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { offset } from "@floating-ui/dom";
import { CheckSquare, ChevronRight, Copy, GripVertical, Heading1, Heading2, Heading3, Lightbulb, List, ListOrdered, Quote, Trash2, Type } from "lucide-react";
import { ContextMenu, useContextMenu, type MenuEntry } from "@/components/ui";

type Chain = ReturnType<Editor["chain"]>;

// Must be referentially stable: DragHandle re-registers its ProseMirror plugin whenever this
// object changes, and re-registering destroys every plugin view (slash menu, bubble menu…).
const POSITION_CONFIG = { placement: "left-start" as const, middleware: [offset({ mainAxis: 6, crossAxis: 2 })] };

/** Grip that appears beside the hovered block; click opens a block menu. */
export function BlockDragHandle({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<{ node: PMNode | null; pos: number }>({ node: null, pos: -1 });
  const menu = useContextMenu<null>();
  const onNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => setCurrent({ node, pos }), []);

  const withBlock = (fn: (c: Chain) => Chain) => () => {
    if (current.pos < 0) return;
    const inside = Math.min(current.pos + 1, editor.state.doc.content.size);
    fn(editor.chain().focus().setTextSelection(inside)).run();
  };

  const entries: MenuEntry[] = [
    { label: t("block.turnInto"), header: true },
    { label: t("slash.text"), icon: Type, onSelect: withBlock((c) => c.clearNodes().setParagraph()) },
    { label: t("slash.h1"), icon: Heading1, onSelect: withBlock((c) => c.clearNodes().setHeading({ level: 1 })) },
    { label: t("slash.h2"), icon: Heading2, onSelect: withBlock((c) => c.clearNodes().setHeading({ level: 2 })) },
    { label: t("slash.h3"), icon: Heading3, onSelect: withBlock((c) => c.clearNodes().setHeading({ level: 3 })) },
    { label: t("slash.bullet"), icon: List, onSelect: withBlock((c) => c.clearNodes().toggleBulletList()) },
    { label: t("slash.numbered"), icon: ListOrdered, onSelect: withBlock((c) => c.clearNodes().toggleOrderedList()) },
    { label: t("slash.task"), icon: CheckSquare, onSelect: withBlock((c) => c.clearNodes().toggleTaskList()) },
    { label: t("slash.quote"), icon: Quote, onSelect: withBlock((c) => c.clearNodes().toggleBlockquote()) },
    { label: t("slash.callout"), icon: Lightbulb, onSelect: withBlock((c) => c.clearNodes().toggleCallout()) },
    { label: t("slash.toggle"), icon: ChevronRight, onSelect: withBlock((c) => c.clearNodes().setDetails()) },
    { separator: true },
    {
      label: t("block.duplicate"),
      icon: Copy,
      onSelect: () => {
        const { node, pos } = current;
        if (!node || pos < 0) return;
        editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run();
      },
    },
    {
      label: t("block.delete"),
      icon: Trash2,
      danger: true,
      onSelect: () => {
        const { node, pos } = current;
        if (!node || pos < 0) return;
        editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
      },
    },
  ];

  return (
    <>
      <DragHandle
        editor={editor}
        className="drag-handle"
        computePositionConfig={POSITION_CONFIG}
        onNodeChange={onNodeChange}
      >
        <button type="button" className="drag-handle-btn" onClick={(e) => menu.open(e, null)} aria-label={t("block.menu")}>
          <GripVertical className="size-4" strokeWidth={2} />
        </button>
      </DragHandle>
      {menu.state && <ContextMenu x={menu.state.x} y={menu.state.y} onClose={menu.close} entries={entries} />}
    </>
  );
}
