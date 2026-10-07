import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "green" | "red" | "orange";

const tones: Record<Tone, string> = {
  neutral: "bg-control text-ink-2",
  accent: "bg-accent-soft text-accent",
  green: "bg-sys-green/15 text-sys-green",
  red: "bg-sys-red/15 text-sys-red",
  orange: "bg-sys-orange/15 text-sys-orange",
};

export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex h-[18px] items-center rounded-full px-1.5 text-[11px] font-medium leading-none", tones[tone], className)}
      {...props}
    />
  );
}
