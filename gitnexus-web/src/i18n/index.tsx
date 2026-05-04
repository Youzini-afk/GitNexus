import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Locale, Dictionary } from './types';
import { enDictionary } from './en';
import { zhDictionary } from './zh';

export type { Locale, Dictionary };
export { enDictionary, zhDictionary };

const STORAGE_KEY = 'gitnexus.locale';

export const LOCALE_STORAGE_KEY = STORAGE_KEY;

const DICTIONARIES: Record<Locale, Dictionary> = {
  en: enDictionary,
  zh: zhDictionary,
};

const VALID_LOCALES: Locale[] = ['en', 'zh'];

function isValidLocale(value: string): value is Locale {
  return VALID_LOCALES.includes(value as Locale);
}

export function resolveLocalePreference(
  storedLocale: string | null,
  browserLanguage = 'en',
): Locale {
  if (storedLocale && isValidLocale(storedLocale)) return storedLocale;
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function getDefaultLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[i18n] failed to read locale preference:', err);
    }
  }

  const navLang = typeof navigator !== 'undefined' ? navigator.language : 'en';
  return resolveLocalePreference(stored, navLang);
}

function setStoredLocale(locale: Locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[i18n] failed to persist locale preference:', err);
    }
  }
}

function setHtmlLang(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }
}

export type TranslationKey = keyof Dictionary extends infer K
  ? K extends keyof Dictionary
    ? Dictionary[K] extends Record<string, unknown>
      ? `${K & string}.${PathOf<Dictionary[K]>}` | (K & string)
      : K & string
    : never
  : never;

type PathOf<T> = {
  [K in keyof T]: K extends string
    ? T[K] extends Record<string, unknown>
      ? `${K}.${PathOf<T[K]>}` | K
      : K
    : never;
}[keyof T];

function getValueByPath(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

export function tp(
  dictionary: Dictionary,
  path: TranslationKey,
  params?: Record<string, string | number>,
): string {
  let value = getValueByPath(dictionary, path);

  if (typeof value !== 'string') {
    value = getValueByPath(enDictionary, path);
  }

  if (typeof value !== 'string') {
    return path;
  }

  if (!params) return value;

  return value.replace(/\{(\w+)\}/g, (_match, key) => {
    const replacement = params[key];
    return replacement !== undefined ? String(replacement) : `{${key}}`;
  });
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  dictionary: Dictionary;
  t: (path: TranslationKey, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>(() => getDefaultLocale());

  useEffect(() => {
    setHtmlLang(locale);
  }, [locale]);

  const setLocale = (next: Locale) => {
    if (isValidLocale(next)) {
      setStoredLocale(next);
      setLocaleState(next);
      setHtmlLang(next);
    }
  };

  const dictionary = DICTIONARIES[locale];

  const value: LocaleContextValue = {
    locale,
    setLocale,
    dictionary,
    t: (path, params) => tp(dictionary, path, params),
  };

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = (): LocaleContextValue => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
};

export const useT = (): LocaleContextValue['t'] => {
  const ctx = useLocale();
  return ctx.t;
};
