import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const LOCALE_STORAGE_KEY = "playground-locale";

export type Locale = "en" | "zh";

const stored = localStorage.getItem(LOCALE_STORAGE_KEY);

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: stored === "zh" ? "zh" : "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export function changeLocale(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  void i18n.changeLanguage(locale);
}

applyDocumentLang();

function applyDocumentLang() {
  document.documentElement.lang = i18n.language === "zh" ? "zh-CN" : "en";
}

export { i18n };
