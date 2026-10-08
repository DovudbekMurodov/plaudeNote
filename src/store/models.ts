import { create } from "zustand";
import { api, type ModelInfo, type ModelKind, type ModelProgress, type SystemInfo } from "@/api";

interface ModelsState {
  models: ModelInfo[];
  system: SystemInfo | null;
  loaded: boolean;

  /** Load list + system info and subscribe to progress. Returns an unsubscribe. */
  start(): () => void;
  refresh(): Promise<void>;
  download(id: string): Promise<void>;
  pause(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useModels = create<ModelsState>()((set, get) => ({
  models: [],
  system: null,
  loaded: false,

  start() {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void get().refresh();
    void api.systemInfo().then((system) => set({ system })).catch(() => undefined);
    void api
      .onModelProgress((p: ModelProgress) => {
        set((s) => ({
          models: s.models.map((m) =>
            m.id === p.id
              ? { ...m, status: p.status, downloadedBytes: p.downloadedBytes, bytesPerSec: p.bytesPerSec, error: p.error }
              : m,
          ),
        }));
        // Only a finished download changes the on-disk truth; an error must stay visible.
        if (p.status === "ready") void get().refresh();
        if (p.status === "ready" || p.status === "error" || p.status === "paused") {
          void api.systemInfo().then((system) => set({ system })).catch(() => undefined);
        }
      })
      .then((u) => {
        if (cancelled) u();
        else unsub = u;
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  },

  async refresh() {
    try {
      set({ models: await api.modelsList(), loaded: true });
    } catch (e) {
      console.error(e);
    }
  },
  async download(id) {
    set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...m, status: "downloading", error: null } : m)) }));
    try {
      await api.modelDownload(id);
    } catch (e) {
      set((s) => ({ models: s.models.map((m) => (m.id === id ? { ...m, status: "error", error: String(e) } : m)) }));
    }
  },
  async pause(id) {
    await api.modelPause(id).catch(console.error);
  },
  async remove(id) {
    await api.modelDelete(id).catch(console.error);
    await get().refresh();
  },
}));

/** Which kinds have at least one ready model. */
export function readiness(models: ModelInfo[]): Record<ModelKind, boolean> {
  const r: Record<ModelKind, boolean> = { stt: false, llm: false, runtime: false };
  for (const m of models) if (m.status === "ready") r[m.kind] = true;
  return r;
}

/** Aggregate for the sidebar pill. */
export function summary(models: ModelInfo[]): { state: "ready" | "partial" | "downloading" | "missing"; progress: number } {
  const r = readiness(models);
  const active = models.filter((m) => m.status === "downloading" || m.status === "extracting");
  if (active.length) {
    const done = active.reduce((a, m) => a + m.downloadedBytes, 0);
    const total = active.reduce((a, m) => a + m.size, 0) || 1;
    return { state: "downloading", progress: done / total };
  }
  const n = Number(r.stt) + Number(r.llm) + Number(r.runtime);
  if (n === 3) return { state: "ready", progress: 1 };
  if (n === 0) return { state: "missing", progress: 0 };
  return { state: "partial", progress: n / 3 };
}

export function recommendedId(models: ModelInfo[], kind: ModelKind, ramGb: number | undefined): string | undefined {
  const big = (ramGb ?? 16) >= 16;
  return models.find((m) => m.kind === kind && (big ? m.defaultFor16gb : m.defaultFor8gb))?.id;
}
