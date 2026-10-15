import { useTranslation } from "react-i18next";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { Loader2, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/api";
import { useAi } from "@/store/ai";

/**
 * Container for everything the AI wrote from a recording. Shows a loader while
 * the job runs, then holds editable blocks. Regenerate replaces it wholesale.
 */
export const AiSummaryNode = Node.create({
  name: "aiSummary",
  group: "block",
  content: "block*",
  defining: true,
  draggable: true,

  addAttributes() {
    return {
      pending: { default: false },
      progress: { default: 0 },
      error: { default: null },
      jobId: { default: null },
      model: { default: null },
      createdAt: { default: null },
      lang: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="aiSummary"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "aiSummary", class: "ai-summary" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AiSummaryView);
  },

  renderMarkdown(node, h) {
    return `${h.renderChildren(node.content ?? [], "\n\n")}\n\n`;
  },
});

function AiSummaryView({ node, selected, editor, getPos }: NodeViewProps) {
  const { t } = useTranslation();
  const regenerate = useAi((s) => s.regenerate);
  const noteId = useAi((s) => s.currentNoteId)();
  const pending = !!node.attrs.pending;
  const rtl = node.attrs.lang === "ar";

  const remove = () => {
    const pos = getPos();
    if (pos === undefined) return;
    editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
  };

  const when = node.attrs.createdAt
    ? new Date(node.attrs.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <NodeViewWrapper className={cn("ai-summary", selected && "is-selected", pending && "is-pending")} data-type="aiSummary" dir={rtl ? "rtl" : "ltr"}>
      <div className="ai-summary-head" contentEditable={false}>
        <span className="ai-title">
          <Sparkles className="size-3.5 text-sys-purple" strokeWidth={2} />
          {t("ai.summaryTitle")}
          {node.attrs.model && <span className="ai-meta">{String(node.attrs.model).replace(/-Q\d.*$/i, "").replace(/\.gguf$/i, "")}</span>}
          {when && <span className="ai-meta">{when}</span>}
        </span>
        <span className="ai-actions">
          {pending ? (
            node.attrs.jobId && (
              <button type="button" onClick={() => void api.jobCancel(node.attrs.jobId)}>
                <X className="size-3" strokeWidth={2.2} />
                {t("ai.cancel")}
              </button>
            )
          ) : (
            editor.isEditable && (
              <>
                <button type="button" onClick={() => noteId && void regenerate(noteId)}>
                  <RefreshCw className="size-3" strokeWidth={2} />
                  {t("ai.regenerateShort")}
                </button>
                <button type="button" className="is-danger" onClick={remove}>
                  <Trash2 className="size-3" strokeWidth={2} />
                  {t("ai.remove")}
                </button>
              </>
            )
          )}
        </span>
      </div>
      {pending ? (
        <div className="ai-summary-pending" contentEditable={false}>
          <Loader2 className="size-3.5 animate-spin text-sys-purple" strokeWidth={2} />
          <span>{t("ai.pending")}</span>
        </div>
      ) : node.attrs.error ? (
        <div className="ai-summary-error" contentEditable={false}>
          {node.attrs.error === "interrupted" ? t("ai.interrupted") : node.attrs.error === "cancelled" ? t("ai.cancelled") : String(node.attrs.error)}
        </div>
      ) : (
        <NodeViewContent className="ai-summary-body" />
      )}
    </NodeViewWrapper>
  );
}
