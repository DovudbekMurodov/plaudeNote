import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { cn } from "@/lib/cn";
import type { SlashItem } from "./items";

export type SlashKeyHandler = (p: SuggestionKeyDownProps) => boolean;

type Props = SuggestionProps<SlashItem, SlashItem> & {
  /** The extension hands us a slot to publish our keyboard handler into. */
  register: (handler: SlashKeyHandler | null) => void;
};

export function SlashMenuList({ items, command, register }: Props) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [items]);

  // Publish the key handler on every render so it always sees the latest items/index.
  useEffect(() => {
    register(({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowUp") {
        setIndex((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index];
        if (item) command(item);
        return true;
      }
      return false;
    });
    return () => register(null);
  }, [items, index, command, register]);

  return (
    <div className="slash-menu fade-in" role="listbox">
      {items.length === 0 ? (
        <div className="px-2 py-1.5 text-[12px] text-ink-3">{t("slash.empty")}</div>
      ) : (
        items.map((it, i) => {
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              type="button"
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(it)}
              className={cn("slash-item", i === index && "is-active")}
            >
              <span className="slash-icon">
                <Icon className="size-4" strokeWidth={1.9} />
              </span>
              <span className="truncate">{t(it.labelKey)}</span>
            </button>
          );
        })
      )}
    </div>
  );
}
