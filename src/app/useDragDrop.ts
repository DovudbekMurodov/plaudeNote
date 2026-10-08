import { useEffect, useState } from "react";
import { isTauri } from "@/lib/platform";
import { api } from "@/api";
import { useRecorder } from "@/store/recorder";
import { useNotes } from "@/store/notes";
import { useEditorStore } from "@/features/editor/editorStore";
import { appendToNote } from "@/features/notes/appendToNote";

const MEDIA = new Set(["m4a", "mp3", "wav", "flac", "aac", "ogg", "oga", "opus", "caf", "mp4", "m4v", "mov", "mkv", "webm", "weba"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const ext = (p: string) => (p.split(".").pop() ?? "").toLowerCase();

/**
 * Files dropped anywhere on the window: audio/video → import + transcribe,
 * images → attach to the open note. (Tauri intercepts OS drops before the DOM
 * sees them, so the editor's own drop handler never fires on macOS.)
 */
export function useDragDrop() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent(async (e) => {
        if (e.payload.type === "over" || e.payload.type === "enter") setOver(true);
        else if (e.payload.type === "leave") setOver(false);
        else if (e.payload.type === "drop") {
          setOver(false);
          const media = e.payload.paths.filter((p) => MEDIA.has(ext(p)));
          const images = e.payload.paths.filter((p) => IMAGE.has(ext(p)));
          if (media.length) void useRecorder.getState().importPaths(media);
          for (const img of images) {
            const noteId = useNotes.getState().current?.id;
            if (!noteId) break;
            try {
              const src = await api.attachmentImport(img);
              const editor = useEditorStore.getState().editor;
              const node = { type: "image", attrs: { src, alt: img.split("/").pop() ?? "image" } };
              if (editor && !editor.isDestroyed) editor.chain().focus().insertContent(node).run();
              else await appendToNote(noteId, [node]);
            } catch (err) {
              console.error(err);
            }
          }
        }
      }),
    ).then((u) => (cancelled ? u() : (unlisten = u))).catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("drag-over", over);
  }, [over]);
}
