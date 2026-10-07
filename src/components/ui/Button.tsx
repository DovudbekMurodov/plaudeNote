import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110 active:brightness-95",
  secondary: "bg-control text-ink hover:bg-sel",
  ghost: "text-ink-2 hover:bg-sel hover:text-ink",
  danger: "bg-sys-red text-white hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-6 px-2 text-[12px] rounded-[5px]",
  md: "h-7 px-3 text-[13px] rounded-md",
  lg: "h-9 px-4 text-[14px] rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex select-none items-center justify-center gap-1.5 font-medium transition-[background-color,filter,transform] duration-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        sizes[size],
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
