import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Cpu, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@/lib/platform";
import { useUpdater } from "@/features/update/updater";
import { Popover, SegmentedControl, Button } from "@/components/ui";
import { useUI, type Theme } from "@/store/ui";
import { UI_LANGS } from "@/i18n";
import { api } from "@/api";


interface Props {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
}

export function SettingsMenu({ trigger }: Props) {
  const { t } = useTranslation();
  const theme = useUI((s) => s.theme);
  const setTheme = useUI((s) => s.setTheme);
  const lang = useUI((s) => s.lang);
  const setLang = useUI((s) => s.setLang);

  const updStatus = useUpdater((s) => s.status);
  const checkUpdate = useUpdater((s) => s.check);
  const [version, setVersion] = useState<string>("");
  useEffect(() => {
    if (isTauri()) void getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);
  const updateLine =
    updStatus === "checking" ? t("update.checking")
    : updStatus === "upToDate" ? t("update.upToDate")
    : updStatus === "error" ? t("update.error")
    : updStatus === "available" ? t("update.available", { version: useUpdater.getState().version })
    : null;

  const themeOptions: { value: Theme; label: string }[] = [
    { value: "system", label: t("settings.system") },
    { value: "light", label: t("settings.light") },
    { value: "dark", label: t("settings.dark") },
  ];

  return (
    <Popover trigger={trigger} side="top" align="end" className="w-[260px] p-3">
      <Row label={t("settings.theme")}>
        <SegmentedControl value={theme} options={themeOptions} onChange={setTheme} size="sm" />
      </Row>
      <Row label={t("settings.language")} className="mt-3">
        <SegmentedControl
          value={lang}
          options={UI_LANGS.map((l) => ({ value: l, label: t(`record.${l}`) }))}
          onChange={setLang}
          size="sm"
        />
      </Row>
      <div className="hairline-t mt-3 pt-3">
        <Button variant="secondary" size="md" className="w-full justify-start" onClick={() => void api.openModelsWindow()}>
          <Cpu className="size-4" strokeWidth={1.9} />
          {t("settings.openModels")}
        </Button>
        {isTauri() && (
          <Button variant="secondary" size="md" className="mt-2 w-full justify-start" onClick={() => void checkUpdate(true)} disabled={updStatus === "checking"}>
            <RefreshCw className="size-4" strokeWidth={1.9} />
            {t("update.check")}
          </Button>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
          <span>{version ? t("update.version", { version }) : ""}</span>
          <span>{updateLine}</span>
        </div>
      </div>
    </Popover>
  );
}

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-ink-3">{label}</div>
      {children}
    </div>
  );
}
