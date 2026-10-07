import { cn } from "@/lib/cn";

interface Props {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Toggle({ checked, onChange, disabled, className, ...rest }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={cn(
        "relative inline-flex h-[20px] w-[34px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        checked ? "bg-sys-green" : "bg-control-active shadow-[inset_0_0_0_1px_var(--separator)]",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "absolute top-[2px] start-[2px] size-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-200",
          checked && "translate-x-[14px] rtl:-translate-x-[14px]",
        )}
      />
    </button>
  );
}
