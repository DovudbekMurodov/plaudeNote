import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, FolderOpen, HardDrive } from "lucide-react";
import { useAppearance } from "@/app/useAppearance";
import { useModels, recommendedId } from "@/store/models";
import { api, type ModelKind } from "@/api";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui";
import { ModelRow } from "./ModelRow";

const KINDS: ModelKind[] = ["stt", "llm", "runtime"];

export function ModelsWindow() {
  const { t } = useTranslation();
  useAppearance();
  const start = useModels((s) => s.start);
  const models = useModels((s) => s.models);
  const system = useModels((s) => s.system);

  useEffect(() => start(), [start]);

  const readyBytes = models.filter((m) => m.status === "ready").reduce((a, m) => a + m.size, 0);

  return (
    <div className="flex h-full flex-col bg-surface text-ink">
      <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center justify-center hairline-b">
        <span className="text-[13px] font-semibold">{t("models.title")}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-8 pt-4">
        <p className="text-[13px] text-ink-2">{t("models.subtitle")}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <Cpu className="size-3.5" strokeWidth={2} />
            {system ? `${system.cpu || system.arch} · ${t("models.ram", { gb: system.ramGb })}` : "…"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <HardDrive className="size-3.5" strokeWidth={2} />
            {t("models.diskUsed", { size: formatBytes(readyBytes) })}
            {system?.diskFreeBytes != null && (
              <span className={system.diskFreeBytes < 3_000_000_000 ? "font-semibold text-sys-orange" : ""}>
                · {t("models.diskFree", { size: formatBytes(system.diskFreeBytes) })}
              </span>
            )}
          </span>
          <Button variant="ghost" size="sm" className="ms-auto" onClick={() => void api.revealModelsDir()}>
            <FolderOpen className="size-3.5" strokeWidth={2} />
            {t("models.folder")}
          </Button>
        </div>

        {KINDS.map((kind) => {
          const rec = recommendedId(models, kind, system?.ramGb);
          return (
            <section key={kind} className="mt-6">
              <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-ink-3">{t(`models.kind.${kind}`)}</h2>
              <div className="overflow-hidden rounded-lg bg-surface-2 shadow-[0_0_0_0.5px_var(--separator)]">
                {models
                  .filter((m) => m.kind === kind)
                  .map((m, i) => (
                    <ModelRow key={m.id} model={m} recommended={m.id === rec} ramGb={system?.ramGb} diskFree={system?.diskFreeBytes ?? null} first={i === 0} />
                  ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
