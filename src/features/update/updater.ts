import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauri } from "@/lib/platform";

export type UpdateStatus = "idle" | "checking" | "available" | "downloading" | "installing" | "upToDate" | "error";

interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  progress: number;
  error: string | null;
  dismissed: boolean;
  /** Check GitHub Releases. `manual` shows "up to date" / errors (the launch check stays quiet). */
  check(manual?: boolean): Promise<void>;
  install(): Promise<void>;
  dismiss(): void;
}

let pending: Update | null = null;

/**
 * In-app updates: `latest.json` on GitHub Releases (see tauri.conf.json → plugins.updater).
 * Checked once ~8 s after launch, and on demand from Settings. Installing downloads the
 * signed .app.tar.gz, swaps the bundle and relaunches — notes, recordings and models live
 * in Application Support, so nothing is lost.
 */
export const useUpdater = create<UpdateState>()((set, get) => ({
  status: "idle",
  version: null,
  notes: null,
  progress: 0,
  error: null,
  dismissed: false,

  async check(manual = false) {
    if (!isTauri()) return;
    if (get().status === "downloading" || get().status === "installing") return;
    set({ status: "checking", error: null });
    try {
      const update = await check({ timeout: 15_000 });
      if (update) {
        pending = update;
        set({ status: "available", version: update.version, notes: update.body ?? null, dismissed: false });
      } else {
        pending = null;
        set({ status: manual ? "upToDate" : "idle" });
      }
    } catch (e) {
      pending = null;
      set({ status: manual ? "error" : "idle", error: String(e) });
    }
  },

  async install() {
    const update = pending;
    if (!update) return;
    set({ status: "downloading", progress: 0 });
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          if (total > 0) set({ progress: got / total });
        } else if (ev.event === "Finished") set({ status: "installing", progress: 1 });
      });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  dismiss() {
    set({ dismissed: true });
  },
}));

/** Call once at startup: quiet check a few seconds after the window is up. */
export function scheduleUpdateCheck() {
  if (!isTauri()) return;
  window.setTimeout(() => void useUpdater.getState().check(false), 8_000);
}
