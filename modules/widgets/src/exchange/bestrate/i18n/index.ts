/** i18n for the Best Rate tab; see ../../../i18n for how it works. */
import { createI18n } from '../../../i18n';
import { RU } from './ru';

export type { Lang, TrVars } from '../../../i18n';
import { plural } from '../../../i18n';

export { plural };

export const { getLang, setLang, tr, useT, useLang, useSavedLang, intlLocale } = createI18n('coinman.bestrate.lang', RU);

/** "20 sub-swaps" / "20 частей", with the Russian plural. */
export const subSwaps = (n: number) =>
  getLang() === 'ru' ? `${n} ${plural(n, 'часть', 'части', 'частей')}` : `${n} sub-swap${n === 1 ? '' : 's'}`;
