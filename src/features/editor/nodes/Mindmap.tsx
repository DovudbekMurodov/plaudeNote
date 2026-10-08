import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Download, GitBranch, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import type { MindNode } from "@/api";
import { echarts, onThemeChange, savePng, tokens } from "@/features/ai/chartTheme";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mindmap: {
      insertMindmap: (attrs: { tree: MindNode; lang?: string | null }) => ReturnType;
    };
  }
}

export function treeToOutline(n: MindNode, depth = 0): string {
  const line = `${"  ".repeat(depth)}- ${n.name}`;
  return [line, ...(n.children ?? []).map((c) => treeToOutline(c, depth + 1))].join("\n");
}

export function outlineToTree(text: string): MindNode | null {
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) return null;
  const stack: { depth: number; node: MindNode }[] = [];
  let root: MindNode | null = null;
  for (const raw of lines) {
    const m = /^(\s*)(?:[-*•]\s*)?(.*)$/.exec(raw);
    if (!m) continue;
    const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
    const node: MindNode = { name: m[2].trim(), children: [] };
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (!stack.length) {
      if (!root) root = node;
      else (root.children ??= []).push(node);
    } else {
      (stack[stack.length - 1].node.children ??= []).push(node);
    }
    stack.push({ depth, node });
  }
  return root;
}

function countNodes(n: MindNode): number {
  return 1 + (n.children ?? []).reduce((a, c) => a + countNodes(c), 0);
}

function maxLeafLen(n: MindNode): number {
  return n.children?.length ? Math.max(...n.children.map(maxLeafLen)) : n.name.length;
}
/** Pixel width a label needs (≈7.5px per char at 13px) so nothing is clipped at the edges. */
const labelPx = (chars: number) => Math.min(280, Math.max(48, chars * 7.5 + 24));

function leafCount(n: MindNode): number {
  return n.children?.length ? n.children.reduce((a, c) => a + leafCount(c), 0) : 1;
}

export const MindmapNode = Node.create({
  name: "mindmap",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      tree: { default: { name: "", children: [] } as MindNode },
      lang: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mindmap"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "mindmap" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MindmapView);
  },

  addCommands() {
    return {
      insertMindmap:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  renderMarkdown(node) {
    const tree = node.attrs?.tree as MindNode | undefined;
    return tree?.name ? `${treeToOutline(tree)}\n\n` : "";
  },
});

function MindmapView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const tree = node.attrs.tree as MindNode;
  const rtl = node.attrs.lang === "ar";
  const height = Math.min(640, Math.max(260, leafCount(tree) * 30 + 60));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = () => {
      const tk = tokens();
      if (!chart.current) chart.current = echarts.init(el, undefined, { renderer: "canvas" });
      chart.current.setOption(
        {
          backgroundColor: "transparent",
          tooltip: { show: false },
          series: [
            {
              type: "tree",
              data: [tree],
              orient: rtl ? "RL" : "LR",
              top: 16,
              bottom: 16,
              // root label sits outside the root node (towards the edge), leaves outside the far edge
              left: rtl ? labelPx(maxLeafLen(tree)) : labelPx(tree.name.length),
              right: rtl ? labelPx(tree.name.length) : labelPx(maxLeafLen(tree)),
              symbol: "circle",
              symbolSize: 9,
              initialTreeDepth: -1,
              expandAndCollapse: true,
              roam: countNodes(tree) > 40,
              edgeShape: "curve",
              edgeForkPosition: "60%",
              label: {
                position: rtl ? "right" : "left",
                verticalAlign: "middle",
                align: rtl ? "left" : "right",
                fontSize: 13,
                fontFamily: tk.font,
                color: tk.text,
                distance: 10,
              },
              leaves: { label: { position: rtl ? "left" : "right", align: rtl ? "right" : "left" } },
              lineStyle: { color: tk.separator, width: 1.5, curveness: 0.5 },
              itemStyle: { color: tk.accent, borderColor: tk.accent },
              emphasis: { focus: "descendant" },
              animationDuration: 300,
              animationDurationUpdate: 300,
            },
          ],
        },
        true,
      );
    };
    render();
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el);
    const off = onThemeChange(render);
    return () => {
      ro.disconnect();
      off();
      chart.current?.dispose();
      chart.current = null;
    };
  }, [tree, rtl]);

  const exportPng = () => {
    const url = chart.current?.getDataURL({ pixelRatio: 2, backgroundColor: tokens().surface });
    if (url) void savePng(url, `${tree.name || "mindmap"}.png`);
  };

  const startEdit = () => {
    setDraft(treeToOutline(tree));
    setEditing(true);
  };
  const commitEdit = () => {
    const next = outlineToTree(draft);
    if (next) updateAttributes({ tree: next });
    setEditing(false);
  };

  return (
    <NodeViewWrapper className={cn("ai-block", selected && "is-selected")} data-type="mindmap" contentEditable={false} dir={rtl ? "rtl" : "ltr"}>
      <div className="ai-head">
        <span className="ai-title">
          <GitBranch className="size-3.5" strokeWidth={2} />
          {t("ai.mindmap")}
        </span>
        <span className="ai-actions">
          {editor.isEditable && (
            <button type="button" onClick={editing ? commitEdit : startEdit}>
              <Pencil className="size-3" strokeWidth={2} />
              {editing ? t("ai.done") : t("ai.edit")}
            </button>
          )}
          <button type="button" onClick={exportPng}>
            <Download className="size-3" strokeWidth={2} />
            PNG
          </button>
        </span>
      </div>
      {editing ? (
        <textarea
          className="ai-outline"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          rows={Math.min(24, draft.split("\n").length + 1)}
          spellCheck={false}
        />
      ) : (
        <div ref={ref} className="ai-canvas" style={{ height }} />
      )}
    </NodeViewWrapper>
  );
}
