import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  size?: "sm" | "md";
}

/** Toolbar-style icon button. Pass `title` for the tooltip. */
export function IconButton({ active, size = "md", className, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors duration-100 hover:bg-sel hover:text-ink active:bg-control disabled:pointer-events-none disabled:opacity-40",
        size === "md" ? "size-7 [&>svg]:size-[17px]" : "size-6 [&>svg]:size-[15px]",
        active && "bg-sel text-accent hover:text-accent",
        className,
      )}
      {...props}
    />
  );
}
