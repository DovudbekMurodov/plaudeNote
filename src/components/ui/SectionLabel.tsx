import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function SectionLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.02em] text-ink-3", className)}
      {...props}
    />
  );
}
