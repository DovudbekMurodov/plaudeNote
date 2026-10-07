import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, FolderInput, Languages, Pin, PinOff, RotateCcw, SquarePen, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useUI } from "@/store/ui";
import { useNotes, type GroupKey } from "@/store/notes";
import { dateGroup, formatListDate } from "@/lib/dates";
import { isRtl } from "@/i18n";
import type { NoteSummary } from "@/api";
import { Button, ContextMenu, IconButton, SearchField, useContextMenu, type MenuEntry } from "@/components/ui";

const GROUP_ORDER: GroupKey[] = ["pinned", "today", "yesterday", "week", "earlier"];

function Row({ note, selected, onSelect, onContextMenu, hideDivider }: {
  note: NoteSummary;
  selected: boolean;
  onSelect: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  hideDivider: boolean;
}) {
  const { t } = useTranslation();
  const lang = useUI((s) => s.lang);
  const title = note.title || t("list.newNoteTitle");
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        onContextMenu={onContextMenu}
        dir={isRtl(note.lang) ? "rtl" : "ltr"}
        className={cn(
          "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-start transition-colors duration-75",
          selected ? "bg-accent text-on-accent" : "hover:bg-sel/70",
        )}
      >
        <div className="flex items-center gap-1.5">
          {note.pinned && <Pin className={cn("size-3 shrink-0", selected ? "text-on-accent/80" : "text-ink-2")} strokeWidth={2.2} />}
          <span className={cn("truncate text-[13px] font-semibold leading-[18px]", !note.title && "opacity-60")}>{title}</span>
        </div>
        <div className="flex items-center gap-2 text-[12px] leading-4">
          <span className={cn("shrink-0 tabular-nums", selected ? "text-on-accent/90" : "text-ink")}>
            {formatListDate(note.updatedAt, lang)}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", selected ? "text-on-accent/75" : "text-ink-2")}>{note.preview}</span>
          {note.hasAudio && <AudioLines className={cn("size-3 shrink-0", selected ? "text-on-accent/80" : "text-ink-3")} strokeWidth={2} />}
        </div>
      </button>
      {!hideDivider && <div className="hairline-b mx-3" />}
    </div>
  );
}

export function NotesList() {
  const { t } = useTranslation();
  const search = useUI((s) => s.search);
  const setSearch = useUI((s) => s.setSearch);
  const folder = useUI((s) => s.selectedFolder);
  const selectedId = useUI((s) => s.selectedNoteId);
  const selectNote = useUI((s) => s.selectNote);

  const notes = useNotes((s) => s.notes);
  const folders = useNotes((s) => s.folders);
  const createNote = useNotes((s) => s.createNote);
  const setPinned = useNotes((s) => s.setPinned);
  const setLang = useNotes((s) => s.setLang);
  const moveNote = useNotes((s) => s.moveNote);
  const trashNote = useNotes((s) => s.trashNote);
  const restoreNote = useNotes((s) => s.restoreNote);
  const deleteForever = useNotes((s) => s.deleteForever);
  const emptyTrash = useNotes((s) => s.emptyTrash);

  const menu = useContextMenu<NoteSummary>();
  const inTrash = folder === "trash";

  const groups = useMemo(() => {
    const buckets = new Map<GroupKey, NoteSummary[]>();
    for (const n of notes) {
      const key: GroupKey = n.pinned && !inTrash ? "pinned" : dateGroup(n.updatedAt);
      buckets.set(key, [...(buckets.get(key) ?? []), n]);
    }
    return GROUP_ORDER.filter((k) => buckets.has(k)).map((k) => ({ key: k, notes: buckets.get(k)! }));
  }, [notes, inTrash]);

  const groupLabel: Record<GroupKey, string> = {
    pinned: t("list.pinnedGroup"),
    today: t("list.today"),
    yesterday: t("list.yesterday"),
    week: t("list.week"),
    earlier: t("list.earlier"),
  };

  const menuEntries = (n: NoteSummary): MenuEntry[] => {
    if (n.deletedAt) {
      return [
        { label: t("menu.restore"), icon: RotateCcw, onSelect: () => void restoreNote(n.id) },
        { separator: true },
        { label: t("menu.deleteForever"), icon: Trash2, danger: true, onSelect: () => void deleteForever(n.id) },
      ];
    }
    return [
      n.pinned
        ? { label: t("menu.unpin"), icon: PinOff, onSelect: () => void setPinned(n.id, false) }
        : { label: t("menu.pin"), icon: Pin, onSelect: () => void setPinned(n.id, true) },
      { separator: true },
      { label: t("menu.moveTo"), header: true },
      { label: t("menu.noFolder"), icon: FolderInput, checked: n.folderId === null, onSelect: () => void moveNote(n.id, null) },
      ...folders.map((f) => ({ label: f.name, icon: FolderInput, checked: n.folderId === f.id, onSelect: () => void moveNote(n.id, f.id) })),
      { separator: true },
      { label: t("menu.language"), header: true },
      { label: t("record.uz"), icon: Languages, checked: n.lang === "uz", onSelect: () => void setLang(n.id, "uz") },
      { label: t("record.ar"), icon: Languages, checked: n.lang === "ar", onSelect: () => void setLang(n.id, "ar") },
      { separator: true },
      { label: t("menu.delete"), icon: Trash2, danger: true, onSelect: () => void trashNote(n.id) },
    ];
  };

  return (
    <section className="notes-list-pane hairline-s flex w-[300px] shrink-0 flex-col bg-surface">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-1.5 px-3">
        <SearchField value={search} onChange={setSearch} placeholder={t("list.search")} className="flex-1" />
        <IconButton title={`${t("list.newNote")} (⌘N)`} onClick={() => void createNote()} disabled={inTrash}>
          <SquarePen />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-[13px] text-ink-3">
            {search ? t("list.noResults") : t("list.noNotes")}
          </div>
        ) : (
          groups.map((g) => (
            <Fragment key={g.key}>
              <div className="px-3 pb-1 pt-3 text-[12px] font-semibold text-ink-2">{groupLabel[g.key]}</div>
              {g.notes.map((n, i) => {
                const next = g.notes[i + 1];
                const hide = n.id === selectedId || next?.id === selectedId || !next;
                return (
                  <Row
                    key={n.id}
                    note={n}
                    selected={n.id === selectedId}
                    onSelect={() => selectNote(n.id)}
                    onContextMenu={(e) => menu.open(e, n)}
                    hideDivider={hide}
                  />
                );
              })}
            </Fragment>
          ))
        )}
      </div>

      <div className="hairline-t flex h-7 shrink-0 items-center justify-center gap-2 text-[11px] text-ink-3">
        {t("list.count", { count: notes.length })}
        {inTrash && notes.length > 0 && (
          <Button variant="ghost" size="sm" className="h-5 text-[11px] text-sys-red hover:text-sys-red" onClick={() => void emptyTrash()}>
            {t("trash.empty")}
          </Button>
        )}
      </div>

      {menu.state && <ContextMenu x={menu.state.x} y={menu.state.y} onClose={menu.close} entries={menuEntries(menu.state.data)} />}
    </section>
  );
}
