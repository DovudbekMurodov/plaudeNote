import { useTranslation } from "react-i18next";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useUpdater } from "./updater";

/** Slim bar at the bottom of the window while an update is available or installing. */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { status, version, progress, dismissed, install, dismiss } = useUpdater();
  if (dismissed && status === "available") return null;
  if (status !== "available" && status !== "downloading" && status !== "installing") return null;

  return (
    <div
      role="status"
      className="pointer-events-auto fade-in fixed inset-x-0 bottom-3 z-40 mx-auto flex w-fit max-w-[90vw] items-center gap-3 rounded-full bg-surface/85 py-1.5 pe-1.5 ps-3 text-[12px] text-ink shadow-float backdrop-blur-xl"
    >
      <Download className="size-3.5 text-accent" strokeWidth={2} />
      {status === "available" && (
        <>
          <span>{t("update.available", { version })}</span>
          <Button variant="primary" size="sm" onClick={() => void install()}>
            {t("update.install")}
          </Button>
          <button type="button" className="rounded-full p-1 text-ink-3 hover:text-ink" onClick={dismiss} aria-label={t("update.later")}>
            <X className="size-3.5" strokeWidth={2.2} />
          </button>
        </>
      )}
      {status === "downloading" && <span>{t("update.downloading", { pct: Math.round(progress * 100) })}</span>}
      {status === "installing" && <span>{t("update.installing")}</span>}
    </div>
  );
}
