import { cn } from "@/lib/cn";

interface Props {
  /** 0..1 */
  value: number;
  className?: string;
  indeterminate?: boolean;
}

export function ProgressBar({ value, className, indeterminate }: Props) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-control", className)}>
      <div
        className={cn("h-full rounded-full bg-accent transition-[width] duration-300", indeterminate && "animate-pulse w-1/3")}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
