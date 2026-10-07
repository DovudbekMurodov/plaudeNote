import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import uz from "./uz.json";
import ar from "./ar.json";
import en from "./en.json";

export type UiLang = "uz" | "ar" | "en";
export const UI_LANGS: UiLang[] = ["uz", "ar", "en"];
export const RTL_LANGS = new Set<UiLang>(["ar"]);

/** BCP-47 locale per UI language, used for Intl formatting. */
export const LOCALE: Record<UiLang, string> = {
  uz: "uz-Latn-UZ",
  ar: "ar",
  en: "en-US",
};

i18n.use(initReactI18next).init({
  resources: {
    uz: { translation: uz },
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: "uz",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function applyLang(lang: UiLang) {
  void i18n.changeLanguage(lang);
  const el = document.documentElement;
  el.lang = lang;
  el.dir = RTL_LANGS.has(lang) ? "rtl" : "ltr";
}

export function isRtl(lang: string): boolean {
  return RTL_LANGS.has(lang as UiLang);
}

export default i18n;
