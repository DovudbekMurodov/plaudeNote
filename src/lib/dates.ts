import { LOCALE, type UiLang } from "@/i18n";

export type DateGroup = "today" | "yesterday" | "week" | "earlier";

// Browsers ship patchy CLDR data for uz-Latn ("M10"), so Uzbek month names are hard-coded.
const UZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const UZ_MONTHS_LONG = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function dateGroup(iso: string, now = new Date()): DateGroup {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days <= 7) return "week";
  return "earlier";
}

function formatTime(d: Date, lang: UiLang): string {
  if (lang === "uz") return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return new Intl.DateTimeFormat(LOCALE[lang], { hour: "2-digit", minute: "2-digit" }).format(d);
}

/** Apple Notes list style: time for today, short date otherwise. */
export function formatListDate(iso: string, lang: UiLang, now = new Date()): string {
  const d = new Date(iso);
  if (dateGroup(iso, now) === "today") return formatTime(d, lang);

  const sameYear = d.getFullYear() === now.getFullYear();
  if (lang === "uz") {
    const base = `${d.getDate()}-${UZ_MONTHS_SHORT[d.getMonth()]}`;
    return sameYear ? base : `${base} ${d.getFullYear()}`;
  }
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  }).format(d);
}

export function formatFullDate(iso: string, lang: UiLang): string {
  const d = new Date(iso);
  if (lang === "uz") {
    return `${d.getDate()}-${UZ_MONTHS_LONG[d.getMonth()]}, ${d.getFullYear()} · ${formatTime(d, lang)}`;
  }
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
