/**
 * Minimal i18n for the Earn (Yearn) section.
 *
 * Source strings are the English text itself: `tr('Vaults')`. Russian is
 * looked up in the dictionary; a missing key falls back to the English
 * text, so untranslated strings never break the UI.
 * Placeholders use `{name}`: `tr('{count} vaults', { count: 3 })`.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { RU } from './ru';

export type Lang = 'en' | 'ru';

const STORAGE_KEY = 'coinman.earn.lang';

function detectInitial(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'ru';
}

let current: Lang = detectInitial();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type TrVars = Record<string, string | number>;

/** Translate outside React (uses the current language, does not re-render). */
export function tr(text: string, vars?: TrVars): string {
  const base = current === 'ru' ? RU[text] ?? text : text;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Hook for components: re-renders on language change and returns `t`.
 * Every component that renders text must call it (or `useLang`).
 */
export function useT(): (text: string, vars?: TrVars) => string {
  const lang = useSyncExternalStore(subscribe, getLang, getLang);
  return useCallback((text: string, vars?: TrVars) => tr(text, vars), [lang]);
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** BCP-47 tag for Intl/date formatting. */
export function intlLocale(): string {
  return current === 'ru' ? 'ru-RU' : 'en-US';
}
