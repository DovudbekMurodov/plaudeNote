export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** ⌘ on Mac, Ctrl elsewhere — for shortcut hints. */
export const modKey = isMac ? "⌘" : "Ctrl";
