import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Cpu, Folder, FolderPlus, Globe, Pencil, Pin, Settings, StickyNote, Trash2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUI } from "@/store/ui";
import { useNotes } from "@/store/notes";
import { useModels, summary } from "@/store/models";
import { api } from "@/api";
import type { Folder as FolderT } from "@/api";
import { SectionLabel, Toggle, IconButton, ProgressBar, ContextMenu, useContextMenu } from "@/components/ui";
import { SettingsMenu } from "@/features/settings/SettingsMenu";

interface ItemProps {
  id: string;
  icon: LucideIcon;
  label: string;
  count?: number;
  tint?: string;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function Item({ id, icon: Icon, label, count, tint, onContextMenu }: ItemProps) {
  const selected = useUI((s) => s.selectedFolder) === id;
  const select = useUI((s) => s.selectFolder);
  return (
    <button
      type="button"
      onClick={() => select(id)}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex h-7 w-full items-center gap-2 rounded-md px-2 text-start text-[13px] transition-colors duration-100",
        selected ? "bg-sel text-ink" : "text-ink hover:bg-sel/60",
      )}
    >
      <Icon className={cn("size-4 shrink-0", tint ?? "text-accent")} strokeWidth={1.9} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && <span className="text-[12px] tabular-nums text-ink-3">{count}</span>}
    </button>
  );
}

/** Inline text field used for new-folder and rename. Enter commits, Esc cancels, blur commits. */
function InlineInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const v = ref.current?.value.trim() ?? "";
    if (v) onCommit(v);
    else onCancel();
  };
  return (
    <div className="flex h-7 items-center gap-2 rounded-md bg-surface px-2 ring-[3px] ring-accent/35">
      <Folder className="size-4 shrink-0 text-sys-yellow" strokeWidth={1.9} />
      <input
        ref={ref}
        defaultValue={initial}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none"
      />
    </div>
  );
}

function ModelsPill() {
  const { t } = useTranslation();
  const models = useModels((s) => s.models);
  const sum = summary(models);
  const label = {
    ready: t("sidebar.modelsReady"),
    partial: t("sidebar.modelsPartial"),
    downloading: `${Math.round(sum.progress * 100)}%`,
    missing: t("sidebar.modelsMissing"),
  }[sum.state];
  return (
    <button
      type="button"
      onClick={() => void api.openModelsWindow()}
      className="w-full rounded-md bg-sel/60 px-2 py-1.5 text-start transition-colors hover:bg-sel"
      title={t("settings.openModels")}
    >
      <div className="flex items-center gap-2 text-[12px]">
        <Cpu className={cn("size-[14px]", sum.state === "ready" ? "text-sys-green" : "text-ink-2")} strokeWidth={1.9} />
        <span className="flex-1 text-ink">{t("sidebar.models")}</span>
        <span className={cn("tabular-nums", sum.state === "missing" ? "text-sys-orange" : "text-ink-3")}>{label}</span>
      </div>
      <ProgressBar value={sum.progress} className="mt-1.5" />
    </button>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const folders = useNotes((s) => s.folders);
  const counts = useNotes((s) => s.counts);
  const createFolder = useNotes((s) => s.createFolder);
  const renameFolder = useNotes((s) => s.renameFolder);
  const deleteFolder = useNotes((s) => s.deleteFolder);

  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const menu = useContextMenu<FolderT>();

  return (
    <aside className="sidebar-pane flex w-[220px] shrink-0 flex-col">
      {/* Title-bar strip: traffic lights live here on macOS. */}
      <div data-tauri-drag-region className="h-[52px] shrink-0" />

      <nav className="flex-1 overflow-y-auto px-2.5 pb-2">
        <SectionLabel className="pt-0">{t("app.name")}</SectionLabel>
        <Item id="all" icon={StickyNote} label={t("sidebar.allNotes")} count={counts.all} />
        <Item id="recent" icon={Clock} label={t("sidebar.recent")} />
        <Item id="pinned" icon={Pin} label={t("sidebar.pinned")} count={counts.pinned} />

        <SectionLabel>{t("sidebar.folders")}</SectionLabel>
        {folders.map((f) =>
          renaming === f.id ? (
            <InlineInput
              key={f.id}
              initial={f.name}
              onCommit={(v) => {
                setRenaming(null);
                void renameFolder(f.id, v);
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <Item
              key={f.id}
              id={f.id}
              icon={Folder}
              label={f.name}
              count={counts.byFolder[f.id] ?? 0}
              tint="text-sys-yellow"
              onContextMenu={(e) => menu.open(e, f)}
            />
          ),
        )}
        {creating && (
          <InlineInput
            initial=""
            onCommit={(v) => {
              setCreating(false);
              void createFolder(v);
            }}
            onCancel={() => setCreating(false)}
          />
        )}

        <div className="mt-3">
          <Item id="trash" icon={Trash2} label={t("sidebar.trash")} count={counts.trash} tint="text-sys-gray" />
        </div>
      </nav>

      <footer className="space-y-1.5 px-2.5 pb-2.5">
        <ModelsPill />

        {/* Global (LAN share) toggle — M6 */}
        <div className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px]">
          <Globe className="size-4 text-sys-green" strokeWidth={1.9} />
          <span className="flex-1">{t("sidebar.global")}</span>
          <Toggle checked={false} aria-label={t("sidebar.global")} />
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-sel hover:text-ink"
          >
            <FolderPlus className="size-4" strokeWidth={1.9} />
            {t("sidebar.newFolder")}
          </button>
          <SettingsMenu
            trigger={(open, toggle) => (
              <IconButton active={open} onClick={toggle} title={t("settings.title")}>
                <Settings />
              </IconButton>
            )}
          />
        </div>
      </footer>

      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          onClose={menu.close}
          entries={[
            { label: t("menu.rename"), icon: Pencil, onSelect: () => setRenaming(menu.state!.data.id) },
            { separator: true },
            { label: t("menu.deleteFolder"), icon: Trash2, danger: true, onSelect: () => void deleteFolder(menu.state!.data.id) },
          ]}
        />
      )}
    </aside>
  );
}
