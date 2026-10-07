import * as echarts from "echarts/core";
import { TreeChart, BarChart, LineChart, PieChart } from "echarts/charts";
import { TooltipComponent, GridComponent, TitleComponent, LegendComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([TreeChart, BarChart, LineChart, PieChart, TooltipComponent, GridComponent, TitleComponent, LegendComponent, CanvasRenderer]);

export { echarts };

export interface Tokens {
  text: string;
  text2: string;
  text3: string;
  accent: string;
  separator: string;
  surface: string;
  font: string;
  palette: string[];
}

/** Read the live CSS tokens so charts follow light/dark. */
export function tokens(): Tokens {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    text: v("--text"),
    text2: v("--text-2"),
    text3: v("--text-3"),
    accent: v("--accent"),
    separator: v("--separator"),
    surface: v("--surface"),
    font: v("--font-sans"),
    palette: [v("--blue"), v("--green"), v("--orange"), v("--purple"), v("--pink"), v("--teal"), v("--yellow"), v("--indigo")],
  };
}

/** Re-run `cb` whenever the theme flips (manual attribute or OS). */
export function onThemeChange(cb: () => void): () => void {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "dir"] });
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => {
    mo.disconnect();
    mq.removeEventListener("change", cb);
  };
}

export async function savePng(dataUrl: string, name: string) {
  const { isTauri } = await import("@/lib/platform");
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: name, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (!path) return;
    const bin = atob(dataUrl.split(",")[1] ?? "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await writeFile(path, bytes);
    return;
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  a.click();
}
