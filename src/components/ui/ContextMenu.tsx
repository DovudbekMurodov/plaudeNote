import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect: () => void;
}
export type MenuEntry = MenuItem | { separator: true } | { label: string; header: true };

interface Props {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
}

/** macOS-style context menu, rendered in a portal and clamped to the viewport. */
export function ContextMenu({ x, y, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - width - 8);
    const top = Math.min(y, window.innerHeight - height - 8);
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={pos}
      className="fade-in fixed z-[100] min-w-[190px] rounded-lg bg-surface/95 p-1 text-[13px] shadow-pop backdrop-blur-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if ("separator" in entry) return <div key={i} className="hairline-t my-1 mx-2" />;
        if ("header" in entry)
          return (
            <div key={i} className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold text-ink-3">
              {entry.label}
            </div>
          );
        const Icon = entry.icon;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={cn(
              "flex h-[26px] w-full items-center gap-2 rounded-[5px] px-2 text-start text-ink disabled:opacity-40",
              "hover:bg-accent hover:text-on-accent [&:hover_svg]:text-on-accent",
              entry.danger && "text-sys-red",
            )}
          >
            {Icon && <Icon className={cn("size-[15px]", entry.danger ? "text-sys-red" : "text-ink-2")} strokeWidth={1.9} />}
            <span className="flex-1 truncate">{entry.label}</span>
            {entry.checked && <span className="text-[11px]">✓</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Tiny hook: `const menu = useContextMenu<T>()` → `onContextMenu={(e) => menu.open(e, data)}`. */
export function useContextMenu<T>() {
  const [state, setState] = useState<{ x: number; y: number; data: T } | null>(null);
  return {
    state,
    open: (e: ReactMouseEvent, data: T) => {
      e.preventDefault();
      e.stopPropagation();
      setState({ x: e.clientX, y: e.clientY, data });
    },
    close: () => setState(null),
  };
}
