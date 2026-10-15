import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (v: string) => void;
}

export function SearchField({ value, onChange, className, ...props }: Props) {
  const { t } = useTranslation();
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute start-2 size-[14px] text-ink-3" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-full appearance-none rounded-[7px] bg-control pe-7 ps-7 text-[13px] text-ink placeholder:text-ink-3 outline-none transition-[box-shadow] focus:ring-[3px] focus:ring-accent/35 [&::-webkit-search-cancel-button]:hidden"
        {...props}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute end-1.5 flex size-4 items-center justify-center rounded-full bg-ink-3 text-surface hover:bg-ink-2"
          aria-label={t("list.clearSearch")}
        >
          <X className="size-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}
