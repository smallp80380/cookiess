import { en } from './locales/en';
import { ru } from './locales/ru';

export type MessageKey = keyof typeof ru;
export type Language = 'ru' | 'en';
export type LanguagePreference = Language | 'auto';

const catalogs: Record<Language, Record<MessageKey, string>> = { ru, en };
// Russian until the popup applies the viewer's preference; unit tests run in Russian.
let current: Language = 'ru';

export function browserLanguage(): Language {
  const ui =
    typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage
      ? chrome.i18n.getUILanguage()
      : 'ru';
  return ui.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function setLanguage(preference: LanguagePreference): Language {
  current = preference === 'auto' ? browserLanguage() : preference;
  return current;
}

export function language(): Language {
  return current;
}

export function locale(): string {
  return current === 'ru' ? 'ru-RU' : 'en-US';
}

export function applyDocumentLanguage(): void {
  document.documentElement.lang = current;
}

export function t(key: MessageKey, vars: Record<string, string | number> = {}): string {
  return catalogs[current][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
