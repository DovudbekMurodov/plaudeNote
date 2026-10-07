import { useEffect, useRef } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { AudioLines } from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/api";
import { SEEK_EVENT } from "./Transcript";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    audio: {
      insertAudio: (attrs: { path: string; title?: string; recordingId?: string | null; durationMs?: number }) => ReturnType;
    };
  }
}

/** Atom block holding a recording. `path` is resolved to a playable URL at render time. */
export const AudioNode = Node.create({
  name: "audio",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      path: { default: null },
      title: { default: "" },
      recordingId: { default: null },
      durationMs: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="audio"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "audio" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioView);
  },

  addCommands() {
    return {
      insertAudio:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  renderMarkdown(node) {
    const title = node.attrs?.title || "audio";
    return node.attrs?.path ? `[${title}](${node.attrs.path})\n\n` : "";
  },
});

function AudioView({ node, selected }: NodeViewProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const src = (node.attrs.path && api.audioSrc(node.attrs.path)) || undefined;

  useEffect(() => {
    const onSeek = (e: Event) => {
      const { recordingId, ms } = (e as CustomEvent<{ recordingId: string; ms: number }>).detail;
      if (recordingId !== node.attrs.recordingId || !ref.current) return;
      ref.current.currentTime = ms / 1000;
      void ref.current.play().catch(() => undefined);
    };
    window.addEventListener(SEEK_EVENT, onSeek);
    return () => window.removeEventListener(SEEK_EVENT, onSeek);
  }, [node.attrs.recordingId]);

  return (
    <NodeViewWrapper className={cn("audio-block", selected && "is-selected")} data-type="audio" contentEditable={false}>
      <AudioLines className="size-4 shrink-0 text-accent" strokeWidth={2} />
      {node.attrs.title && <span className="audio-title">{node.attrs.title}</span>}
      <audio ref={ref} controls preload="metadata" src={src} />
    </NodeViewWrapper>
  );
}
