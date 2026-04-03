import { en } from './en.js';
import { ptBr } from './pt-br.js';
import type { I18nStrings } from './en.js';

export type Locale = 'en' | 'pt-br';

const locales: Record<Locale, I18nStrings> = {
  'en': en,
  'pt-br': ptBr,
};

let currentLocale: Locale = 'en';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(): I18nStrings {
  return locales[currentLocale];
}

export type { I18nStrings };
