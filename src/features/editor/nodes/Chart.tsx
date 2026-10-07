import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { BarChart3, Download } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChartSpec } from "@/api";
import { echarts, onThemeChange, savePng, tokens } from "@/features/ai/chartTheme";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    chart: {
      insertChart: (attrs: { spec: ChartSpec; lang?: string | null }) => ReturnType;
    };
  }
}

export const ChartNode = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      spec: { default: { kind: "bar", title: "", categories: [], values: [] } as ChartSpec },
      lang: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="chart"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "chart" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartView);
  },

  addCommands() {
    return {
      insertChart:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  renderMarkdown(node) {
    const s = node.attrs?.spec as ChartSpec | undefined;
    if (!s || !s.categories?.length) return "";
    const rows = s.categories.map((c, i) => `| ${c} | ${s.values[i] ?? ""} |`).join("\n");
    return `**${s.title}**\n\n| | |\n|---|---|\n${rows}\n\n`;
  },
});

function ChartView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const spec = node.attrs.spec as ChartSpec;
  const rtl = node.attrs.lang === "ar";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const render = () => {
      const tk = tokens();
      if (!chart.current) chart.current = echarts.init(el, undefined, { renderer: "canvas" });
      const textStyle = { fontFamily: tk.font, color: tk.text2 };
      const common = {
        backgroundColor: "transparent",
        color: tk.palette,
        textStyle,
        title: { text: spec.title, left: rtl ? "right" : "left", textStyle: { fontSize: 13, fontWeight: 600, color: tk.text, fontFamily: tk.font } },
        tooltip: { trigger: spec.kind === "pie" ? "item" : "axis", backgroundColor: tk.surface, borderColor: tk.separator, textStyle: { color: tk.text, fontFamily: tk.font } },
      };
      const option =
        spec.kind === "pie"
          ? {
              ...common,
              series: [
                {
                  type: "pie",
                  radius: ["40%", "70%"],
                  center: ["50%", "56%"],
                  data: spec.categories.map((c, i) => ({ name: c, value: spec.values[i] ?? 0 })),
                  label: { color: tk.text, fontFamily: tk.font },
                  itemStyle: { borderColor: tk.surface, borderWidth: 2, borderRadius: 4 },
                },
              ],
            }
          : {
              ...common,
              grid: { left: 8, right: 8, top: 40, bottom: 8, containLabel: true },
              xAxis: {
                type: "category",
                data: spec.categories,
                inverse: rtl,
                axisLine: { lineStyle: { color: tk.separator } },
                axisTick: { show: false },
                axisLabel: { color: tk.text2, fontFamily: tk.font },
              },
              yAxis: {
                type: "value",
                position: rtl ? "right" : "left",
                splitLine: { lineStyle: { color: tk.separator } },
                axisLabel: { color: tk.text3, fontFamily: tk.font },
              },
              series: [
                {
                  type: spec.kind,
                  data: spec.values,
                  smooth: true,
                  itemStyle: { color: tk.accent, borderRadius: spec.kind === "bar" ? [5, 5, 0, 0] : 0 },
                  lineStyle: { width: 2.5 },
                  areaStyle: spec.kind === "line" ? { opacity: 0.12 } : undefined,
                  barMaxWidth: 36,
                },
              ],
            };
      chart.current.setOption(option, true);
    };
    render();
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(el);
    const off = onThemeChange(render);
    return () => {
      ro.disconnect();
      off();
      chart.current?.dispose();
      chart.current = null;
    };
  }, [spec, rtl]);

  const exportPng = () => {
    const url = chart.current?.getDataURL({ pixelRatio: 2, backgroundColor: tokens().surface });
    if (url) void savePng(url, `${spec.title || "chart"}.png`);
  };

  return (
    <NodeViewWrapper className={cn("ai-block", selected && "is-selected")} data-type="chart" contentEditable={false} dir={rtl ? "rtl" : "ltr"}>
      <div className="ai-head">
        <span className="ai-title">
          <BarChart3 className="size-3.5" strokeWidth={2} />
          {t("ai.chart")}
        </span>
        <span className="ai-actions">
          <button type="button" onClick={exportPng}>
            <Download className="size-3" strokeWidth={2} />
            PNG
          </button>
        </span>
      </div>
      <div ref={ref} className="ai-canvas" style={{ height: 280 }} />
    </NodeViewWrapper>
  );
}
