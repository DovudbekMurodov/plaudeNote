import { isTauri } from "@/lib/platform";
import { mockApi } from "./mock";
import { tauriApi } from "./tauri";
import type { Api } from "./types";

export type * from "./types";

/** Desktop → Tauri commands. Plain browser (`pnpm dev`) → in-memory mock. */
export const api: Api = isTauri() ? tauriApi : mockApi;
