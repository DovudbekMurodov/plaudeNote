import { useEffect } from "react";
import { useUI } from "@/store/ui";
import { applyLang } from "@/i18n";
import { isTauri } from "@/lib/platform";

async function syncWindowTheme(theme: "system" | "light" | "dark") {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(theme === "system" ? null : theme);
  } catch {
    /* permission missing or not supported — CSS theme still applies */
  }
}

/** Applies UI language (incl. RTL) and theme from the persisted UI store. Shared by every window. */
export function useAppearance() {
  const lang = useUI((s) => s.lang);
  const theme = useUI((s) => s.theme);

  useEffect(() => {
    if (!isTauri()) document.documentElement.classList.add("no-vibrancy");
  }, []);

  useEffect(() => {
    applyLang(lang);
  }, [lang]);

  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
    void syncWindowTheme(theme);
  }, [theme]);

  // Other windows (or tabs) may change the persisted store — pick it up.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "plaudenote.ui") void useUI.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
}
