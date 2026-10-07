import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { AlignLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Segment } from "@/api";

export const SEEK_EVENT = "plaudenote:seek";

export function seekTo(recordingId: string, ms: number) {
  window.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: { recordingId, ms } }));
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * Atom block holding a transcript: `segments` with timestamps, `pending` while
 * transcription runs. Click a timestamp → the matching audio block seeks.
 */
export const TranscriptNode = Node.create({
  name: "transcript",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      recordingId: { default: null },
      lang: { default: null },
      segments: { default: [] as Segment[] },
      pending: { default: false },
      progress: { default: 0 },
      error: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="transcript"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "transcript" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TranscriptView);
  },

  renderMarkdown(node) {
    const segs = (node.attrs?.segments ?? []) as Segment[];
    return segs.map((s) => `**[${fmt(s.startMs)}]** ${s.text}`).join("\n\n") + "\n\n";
  },
});

function TranscriptView({ node, selected, editor, getPos }: NodeViewProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const segments = (node.attrs.segments ?? []) as Segment[];
  const dir = node.attrs.lang === "ar" ? "rtl" : "ltr";

  const toParagraphs = () => {
    const pos = getPos();
    if (pos === undefined) return;
    const paragraphs = segments.map((s) => ({ type: "paragraph", content: [{ type: "text", text: s.text }] }));
    editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, paragraphs).run();
  };

  return (
    <NodeViewWrapper className={cn("transcript-block", selected && "is-selected")} data-type="transcript" contentEditable={false} dir={dir}>
      <div className="transcript-head">
        <span className="transcript-title">
          <AlignLeft className="size-3.5" strokeWidth={2} />
          {t("transcript.title")}
          {node.attrs.lang && <span className="transcript-lang">{String(node.attrs.lang).toUpperCase()}</span>}
        </span>
        {!node.attrs.pending && segments.length > 0 && (
          <span className="transcript-actions">
            <button type="button" onClick={() => setExpanded((e) => !e)}>
              {expanded ? t("transcript.collapse") : t("transcript.expand")}
            </button>
            {editor.isEditable && (
              <button type="button" onClick={toParagraphs}>
                {t("transcript.toText")}
              </button>
            )}
          </span>
        )}
      </div>

      {node.attrs.pending ? (
        <div className="transcript-pending">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          <span>{t("transcript.pending", { pct: Math.round((node.attrs.progress ?? 0) * 100) })}</span>
        </div>
      ) : node.attrs.error ? (
        <div className="transcript-error">{String(node.attrs.error)}</div>
      ) : expanded ? (
        <div className="transcript-body">
          {segments.map((s, i) => (
            <p key={i} className="transcript-seg">
              <button type="button" className="transcript-ts" onClick={() => seekTo(node.attrs.recordingId, s.startMs)} tabIndex={-1}>
                {fmt(s.startMs)}
              </button>
              <span>{s.text}</span>
            </p>
          ))}
        </div>
      ) : (
        <div className="transcript-collapsed">{segments.map((s) => s.text).join(" ")}</div>
      )}
    </NodeViewWrapper>
  );
}
