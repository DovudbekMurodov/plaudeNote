import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: ReactNode;
  /** Where the panel anchors relative to the trigger. */
  align?: "start" | "end";
  side?: "top" | "bottom";
  className?: string;
}

const MARGIN = 8;

/** Minimal popover: closes on outside click and Escape; shifts to stay inside the window. */
export function Popover({ trigger, children, align = "start", side = "bottom", className }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Keep the panel inside the viewport (the sidebar is narrower than the panel).
  useLayoutEffect(() => {
    if (!open) {
      setShift({ x: 0, y: 0 });
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = 0;
    let y = 0;
    if (r.left < MARGIN) x = MARGIN - r.left;
    else if (r.right > window.innerWidth - MARGIN) x = window.innerWidth - MARGIN - r.right;
    if (r.top < MARGIN) y = MARGIN - r.top;
    else if (r.bottom > window.innerHeight - MARGIN) y = window.innerHeight - MARGIN - r.bottom;
    setShift({ x, y });
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div
          ref={panelRef}
          style={{ translate: `${shift.x}px ${shift.y}px` }}
          className={cn(
            "fade-in absolute z-50 min-w-[220px] rounded-lg bg-surface p-1.5 shadow-pop",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
            align === "start" ? "start-0" : "end-0",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
