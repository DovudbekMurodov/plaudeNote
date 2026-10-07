import { useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { cn } from "@/lib/cn";

export const CALLOUT_EMOJIS = ["💡", "📌", "⚠️", "✅", "❓", "🔥", "📝", "🎯", "⭐️", "🧠"];
export const CALLOUT_TONES = ["blue", "yellow", "red", "green", "purple", "gray"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Wrap the current block in a callout, or lift out of one. */
      toggleCallout: (attrs?: { emoji?: string; tone?: CalloutTone }) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      emoji: { default: "💡", parseHTML: (el) => el.getAttribute("data-emoji") ?? "💡" },
      tone: { default: "blue", parseHTML: (el) => el.getAttribute("data-tone") ?? "blue" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "callout",
        "data-emoji": node.attrs.emoji,
        "data-tone": node.attrs.tone,
        class: `callout tone-${node.attrs.tone}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  /** Markdown has no callout — export as a blockquote led by the emoji. */
  renderMarkdown(node, h) {
    const body = h.renderChildren(node.content ?? [], "\n\n").trim();
    const quoted = `${node.attrs?.emoji ?? "💡"} ${body}`.split("\n").map((l) => `> ${l}`).join("\n");
    return `${quoted}\n\n`;
  },

  addCommands() {
    return {
      toggleCallout:
        (attrs) =>
        ({ commands, editor }) => {
          if (editor.isActive(this.name)) return commands.lift(this.name);
          return commands.wrapIn(this.name, attrs);
        },
    };
  },
});

function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(false);
  const tone = node.attrs.tone as CalloutTone;
  return (
    <NodeViewWrapper className={`callout tone-${tone}`} data-type="callout">
      <div className="callout-icon" contentEditable={false}>
        <button
          type="button"
          className="callout-emoji"
          onClick={() => editor.isEditable && setOpen((o) => !o)}
          aria-label="Change icon"
        >
          {node.attrs.emoji}
        </button>
        {open && (
          <div className="callout-picker fade-in" onMouseLeave={() => setOpen(false)}>
            <div className="callout-picker-row">
              {CALLOUT_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={cn("callout-pick", e === node.attrs.emoji && "is-active")}
                  onClick={() => {
                    updateAttributes({ emoji: e });
                    setOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="callout-picker-row">
              {CALLOUT_TONES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={cn("callout-swatch", `tone-${t}`, t === tone && "is-active")}
                  onClick={() => updateAttributes({ tone: t })}
                  aria-label={t}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}
