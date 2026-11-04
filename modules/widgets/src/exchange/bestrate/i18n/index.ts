/** i18n for the Best Rate tab; see ../../../i18n for how it works. */
import { createI18n } from '../../../i18n';
import { RU } from './ru';

export type { Lang, TrVars } from '../../../i18n';
export { plural } from '../../../i18n';

export const { getLang, setLang, tr, useT, useLang, useSavedLang, intlLocale } = createI18n('coinman.bestrate.lang', RU);
