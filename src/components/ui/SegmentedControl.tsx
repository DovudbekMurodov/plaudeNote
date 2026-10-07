import { cn } from "@/lib/cn";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}

export function SegmentedControl<T extends string>({ value, options, onChange, size = "md", className }: Props<T>) {
  return (
    <div
      role="radiogroup"
      className={cn("inline-flex shrink-0 rounded-[8px] bg-control p-0.5", className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-[6px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
              size === "md" ? "h-6 px-2.5 text-[12px]" : "h-5 px-2 text-[11px]",
              selected
                ? "bg-control-active text-ink shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.06)]"
                : "text-ink-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
