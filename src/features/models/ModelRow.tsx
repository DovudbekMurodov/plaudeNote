import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Download, Pause, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useModels } from "@/store/models";
import type { ModelInfo } from "@/api";
import { formatBytes, formatEta, formatSpeed } from "@/lib/format";
import { Badge, Button, IconButton, ProgressBar } from "@/components/ui";

interface Props {
  model: ModelInfo;
  recommended: boolean;
  ramGb: number | undefined;
  first: boolean;
}

export function ModelRow({ model: m, recommended, ramGb, first }: Props) {
  const { t } = useTranslation();
  const download = useModels((s) => s.download);
  const pause = useModels((s) => s.pause);
  const remove = useModels((s) => s.remove);

  const pct = m.size ? m.downloadedBytes / m.size : 0;
  const busy = m.status === "downloading" || m.status === "extracting";
  const tooBig = ramGb !== undefined && m.minRamGb > ramGb;

  return (
    <div className={cn("flex items-start gap-3 px-3 py-2.5", !first && "hairline-t")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">{m.name}</span>
          {recommended && <Badge tone="accent">{t("models.recommended")}</Badge>}
          {m.status === "ready" && (
            <Badge tone="green">
              <Check className="me-0.5 size-3" strokeWidth={3} />
              {t("models.status.ready")}
            </Badge>
          )}
          {tooBig && <Badge tone="orange">{t("models.needsRam", { gb: m.minRamGb })}</Badge>}
        </div>
        <div className="mt-0.5 text-[12px] text-ink-2">{m.description}</div>
        <div className="mt-0.5 text-[11px] text-ink-3">
          {formatBytes(m.size)}
          {m.langs && ` · ${m.langs}`}
          {m.minRamGb > 0 && ` · ${t("models.ram", { gb: m.minRamGb })}`}
        </div>

        {(busy || m.status === "paused") && (
          <div className="mt-2">
            <ProgressBar value={pct} indeterminate={m.status === "extracting"} />
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-3">
              <span>
                {m.status === "extracting"
                  ? t("models.status.extracting")
                  : `${formatBytes(m.downloadedBytes)} / ${formatBytes(m.size)} · ${Math.round(pct * 100)}%`}
              </span>
              {m.status === "downloading" && m.bytesPerSec > 0 && (
                <span>
                  {formatSpeed(m.bytesPerSec)}
                  {formatEta(m.size - m.downloadedBytes, m.bytesPerSec) ? ` · ${formatEta(m.size - m.downloadedBytes, m.bytesPerSec)}` : ""}
                </span>
              )}
              {m.status === "paused" && <span>{t("models.status.paused")}</span>}
            </div>
          </div>
        )}

        {m.status === "error" && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-sys-red">
            <AlertTriangle className="size-3.5" strokeWidth={2} />
            <span className="truncate">{m.error ?? t("models.status.error")}</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        {m.status === "missing" || m.status === "error" ? (
          <Button variant="primary" size="sm" onClick={() => void download(m.id)}>
            <Download className="size-3.5" strokeWidth={2.2} />
            {m.status === "error" ? t("models.retry") : t("models.download")}
          </Button>
        ) : m.status === "paused" ? (
          <>
            <Button variant="primary" size="sm" onClick={() => void download(m.id)}>
              <Play className="size-3.5" strokeWidth={2.2} />
              {t("models.resume")}
            </Button>
            <IconButton size="sm" title={t("models.delete")} onClick={() => void remove(m.id)}>
              <Trash2 />
            </IconButton>
          </>
        ) : m.status === "downloading" ? (
          <Button variant="secondary" size="sm" onClick={() => void pause(m.id)}>
            <Pause className="size-3.5" strokeWidth={2.2} />
            {t("models.pause")}
          </Button>
        ) : m.status === "ready" ? (
          <IconButton size="sm" title={t("models.delete")} onClick={() => void remove(m.id)}>
            <Trash2 />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
