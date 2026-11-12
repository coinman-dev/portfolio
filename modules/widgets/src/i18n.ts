/**
 * Minimal i18n shared by the Earn and Best Rate sections; each keeps its own
 * dictionary and its own saved language.
 *
 * Source strings are the English text itself: `tr('Vaults')`. Russian is
 * looked up in the dictionary; a missing key falls back to the English
 * text, so untranslated strings never break the UI.
 * Placeholders use `{name}`: `tr('{count} vaults', { count: 3 })`.
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

export type Lang = 'en' | 'ru';
export type TrVars = Record<string, string | number>;

export interface I18n {
  getLang(): Lang;
  setLang(lang: Lang): void;
  /** Translate outside React (uses the current language, does not re-render). */
  tr(text: string, vars?: TrVars): string;
  /**
   * Hook for components: re-renders on language change and returns `t`.
   * Every component that renders text must call it (or `useLang`).
   */
  useT(): (text: string, vars?: TrVars) => string;
  useLang(): Lang;
  /**
   * Keeps the language in the app's saved settings: the webview's storage is
   * wiped on exit, so localStorage alone forgets it. Call it first in the
   * section's root component: it restores `saved` on the first render and
   * calls `save` on every change.
   */
  useSavedLang(saved: unknown, save: (lang: Lang) => void): void;
  /** BCP-47 tag for Intl/date formatting. */
  intlLocale(): string;
}

export function createI18n(storageKey: string, ru: Record<string, string>, fallback: Lang = 'ru'): I18n {
  const detect = (): Lang => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'en' || saved === 'ru') return saved;
    } catch {
      /* storage unavailable */
    }
    return fallback;
  };

  let current: Lang = detect();
  const listeners = new Set<() => void>();
  const getLang = () => current;
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const tr = (text: string, vars?: TrVars): string => {
    const base = current === 'ru' ? ru[text] ?? text : text;
    if (!vars) return base;
    return base.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  };

  const useLang = () => useSyncExternalStore(subscribe, getLang, getLang);

  const setLang = (lang: Lang) => {
    if (lang === current) return;
    current = lang;
    try {
      localStorage.setItem(storageKey, lang);
    } catch {
      /* storage unavailable */
    }
    listeners.forEach((fn) => fn());
  };

  return {
    getLang,
    setLang,
    tr,
    useT() {
      const lang = useLang();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      return useCallback((text: string, vars?: TrVars) => tr(text, vars), [lang]);
    },
    useLang,
    useSavedLang(saved, save) {
      const restored = useRef(false);
      if (!restored.current) {
        restored.current = true;
        if (saved === 'en' || saved === 'ru') setLang(saved);
      }
      const lang = useLang();
      const saveRef = useRef(save);
      saveRef.current = save;
      useEffect(() => {
        if (lang !== saved) saveRef.current(lang);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [lang]);
    },
    intlLocale: () => (current === 'ru' ? 'ru-RU' : 'en-US'),
  };
}

/** Russian plural selection: 1,21 -> one; 2-4,22-24 -> few; else many. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n));
  const m10 = a % 10;
  const m100 = a % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
