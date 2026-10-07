import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Cpu, Loader2, Mic, Square, Upload, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SegmentedControl, IconButton, Button } from "@/components/ui";
import { useUI, type SpeechLang } from "@/store/ui";
import { useRecorder } from "@/store/recorder";
import { useNotes } from "@/store/notes";
import { useModels, readiness } from "@/store/models";
import { useAi } from "@/store/ai";
import { api } from "@/api";

function fmtClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function LevelMeter({ level }: { level: number }) {
  // 7 bars, symmetric, driven by RMS (speech sits around 0.05–0.3).
  const v = Math.min(1, level * 4);
  const heights = [0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35];
  return (
    <div className="flex h-5 items-center gap-[3px]" aria-hidden>
      {heights.map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-sys-red transition-[height] duration-100"
          style={{ height: `${Math.max(3, 20 * h * (0.25 + 0.75 * v))}px` }}
        />
      ))}
    </div>
  );
}

/** Floating capsule at the bottom of the editor: record / upload / language / progress. */
export function RecordBar() {
  const { t } = useTranslation();
  const speechLang = useUI((s) => s.speechLang);
  const setSpeechLang = useUI((s) => s.setSpeechLang);
  const status = useRecorder((s) => s.status);
  const elapsedMs = useRecorder((s) => s.elapsedMs);
  const level = useRecorder((s) => s.level);
  const error = useRecorder((s) => s.error);
  const jobs = useRecorder((s) => s.jobs);
  const start = useRecorder((s) => s.start);
  const stop = useRecorder((s) => s.stop);
  const cancel = useRecorder((s) => s.cancel);
  const importFiles = useRecorder((s) => s.importFiles);
  const dismissError = useRecorder((s) => s.dismissError);
  const subscribe = useRecorder((s) => s.subscribe);
  const currentNoteId = useNotes((s) => s.current?.id ?? null);
  const models = useModels((s) => s.models);
  const ready = readiness(models);
  const sttReady = ready.stt;
  const llmReady = ready.llm && ready.runtime;
  const aiError = useAi((s) => s.error);
  const dismissAiError = useAi((s) => s.dismissError);
  const subscribeAi = useAi((s) => s.subscribe);
  useEffect(() => subscribeAi(), [subscribeAi]);

  useEffect(() => subscribe(), [subscribe]);

  const options: { value: SpeechLang; label: string }[] = [
    { value: "auto", label: t("record.auto") },
    { value: "uz", label: t("record.uz") },
    { value: "ar", label: t("record.ar") },
  ];

  const active = Object.values(jobs).filter((j) => j.status === "queued" || j.status === "running");
  const forThisNote = active.find((j) => j.noteId === currentNoteId) ?? active[0];
  const recording = status === "recording" || status === "stopping" || status === "starting";

  return (
    <div className="record-bar pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-2">
      {error && (
        <div className="pointer-events-auto fade-in flex max-w-[520px] items-center gap-2 rounded-full bg-sys-red/15 px-3 py-1.5 text-[12px] text-ink shadow-float backdrop-blur-xl">
          <span className="truncate">{error}</span>
          {!sttReady && (
            <Button size="sm" variant="primary" className="h-5 px-2 text-[11px]" onClick={() => void api.openModelsWindow()}>
              {t("record.openModels")}
            </Button>
          )}
          <IconButton size="sm" onClick={dismissError} title={t("record.dismiss")}>
            <X />
          </IconButton>
        </div>
      )}
      {aiError && (
        <div className="pointer-events-auto fade-in flex max-w-[520px] items-center gap-2 rounded-full bg-sys-red/15 px-3 py-1.5 text-[12px] text-ink shadow-float backdrop-blur-xl">
          <span className="truncate">{aiError}</span>
          <IconButton size="sm" onClick={dismissAiError} title={t("record.dismiss")}>
            <X />
          </IconButton>
        </div>
      )}
      {!error && forThisNote && (
        <div className="pointer-events-auto fade-in flex items-center gap-2 rounded-full bg-surface/85 px-3 py-1.5 text-[12px] text-ink-2 shadow-float backdrop-blur-xl">
          <Loader2 className="size-3.5 animate-spin text-accent" strokeWidth={2} />
          <span>
            {forThisNote.stage === "summarize"
              ? t("record.summarizing")
              : t("record.transcribing", { pct: Math.round(forThisNote.progress * 100) })}
          </span>
        </div>
      )}
      {!error && sttReady && !llmReady && !recording && models.length > 0 && (
        <button
          type="button"
          onClick={() => void api.openModelsWindow()}
          className="pointer-events-auto fade-in flex items-center gap-2 rounded-full bg-surface/85 px-3 py-1.5 text-[12px] text-ink-2 shadow-float backdrop-blur-xl hover:text-ink"
        >
          <Cpu className="size-3.5 text-sys-purple" strokeWidth={2} />
          {t("record.noLlm")}
        </button>
      )}
      {!error && !sttReady && !recording && models.length > 0 && (
        <button
          type="button"
          onClick={() => void api.openModelsWindow()}
          className="pointer-events-auto fade-in flex items-center gap-2 rounded-full bg-sys-orange/15 px-3 py-1.5 text-[12px] text-ink shadow-float backdrop-blur-xl hover:bg-sys-orange/25"
        >
          <Cpu className="size-3.5 text-sys-orange" strokeWidth={2} />
          {t("record.noModel")}
        </button>
      )}

      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-surface/85 py-1.5 pe-2 ps-1.5 shadow-float backdrop-blur-2xl">
        {recording ? (
          <>
            <button
              type="button"
              title={t("record.stop")}
              disabled={status !== "recording"}
              onClick={() => void stop()}
              className={cn(
                "relative flex size-9 items-center justify-center rounded-full bg-sys-red text-white transition-transform duration-100 hover:scale-[1.04] active:scale-95 disabled:opacity-60",
                status === "recording" && "after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-sys-red/40",
              )}
            >
              {status === "recording" ? <Square className="size-4 fill-current" strokeWidth={2} /> : <Loader2 className="size-4 animate-spin" />}
            </button>
            <span className="min-w-[44px] text-[13px] font-semibold tabular-nums">{fmtClock(elapsedMs)}</span>
            <LevelMeter level={level} />
            <div className="h-5 w-px bg-line" />
            <IconButton title={t("record.cancel")} onClick={() => void cancel()} disabled={status !== "recording"}>
              <X />
            </IconButton>
          </>
        ) : (
          <>
            <button
              type="button"
              title={t("record.record")}
              onClick={() => void start()}
              className="flex size-9 items-center justify-center rounded-full bg-sys-red text-white shadow-[inset_0_0_0_2px_rgba(255,255,255,0.35)] transition-transform duration-100 hover:scale-[1.04] active:scale-95"
            >
              <Mic className="size-[18px]" strokeWidth={2.2} />
            </button>
            <span className="pe-1 text-[13px] font-medium">{t("record.record")}</span>
            <div className="h-5 w-px bg-line" />
            <SegmentedControl value={speechLang} options={options} onChange={setSpeechLang} size="md" />
            <div className="h-5 w-px bg-line" />
            <IconButton title={t("record.upload")} onClick={() => void importFiles()}>
              <Upload />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
