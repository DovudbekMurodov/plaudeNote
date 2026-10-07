import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Image } from "@tiptap/extension-image";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { FileHandler } from "@tiptap/extension-file-handler";
import { Markdown } from "@tiptap/markdown";
import { Callout } from "./nodes/Callout";
import { AudioNode } from "./nodes/Audio";
import { TranscriptNode } from "./nodes/Transcript";
import { MindmapNode } from "./nodes/Mindmap";
import { ChartNode } from "./nodes/Chart";
import { SlashCommand } from "./slash/SlashCommand";

const lowlight = createLowlight(common);

interface Options {
  placeholder: (pos: number) => string;
  onFiles: (editor: Editor, files: File[], pos?: number) => void;
}

export function buildExtensions({ placeholder, onFiles }: Options) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true, lastColumnResizable: false } }),
    Image.configure({ allowBase64: true }),
    Highlight,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Details.configure({ persist: true, openClassName: "is-open" }),
    DetailsSummary,
    DetailsContent,
    Callout,
    AudioNode,
    TranscriptNode,
    MindmapNode,
    ChartNode,
    Placeholder.configure({
      placeholder: ({ pos }) => placeholder(pos),
      showOnlyCurrent: true,
      includeChildren: true,
    }),
    FileHandler.configure({
      allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
      onDrop: (editor, files, pos) => onFiles(editor as Editor, files, pos),
      onPaste: (editor, files) => onFiles(editor as Editor, files),
    }),
    Markdown,
    SlashCommand,
  ];
}
