// i18next setup: resources are bundled statically (no http backend) so init()
// completes synchronously and the first render already has translations.
import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import ru from './locales/ru.json';
import uk from './locales/uk.json';

export const SUPPORTED_LANGUAGES = ['en', 'ru', 'uk'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'tauri-monitor-lang';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ru: { translation: ru },
      uk: { translation: uk },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    // Browser locales like "ru-RU" or "uk-UA" collapse to our two-letter keys.
    load: 'languageOnly',
    interpolation: { escapeValue: false }, // React already escapes rendered text
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
  });

export default i18n;
