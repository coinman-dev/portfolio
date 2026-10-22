import { RU_SHELL } from './shell';
import { RU_LIST } from './list';
import { RU_DETAIL } from './detail';
import { RU_PORTFOLIO } from './portfolio';
import { RU_WIDGET } from './widget';
import { RU_MISC } from './misc';

/** English source text -> Russian. Merged from per-area files. */
export const RU: Record<string, string> = {
  ...RU_SHELL,
  ...RU_LIST,
  ...RU_DETAIL,
  ...RU_PORTFOLIO,
  ...RU_WIDGET,
  ...RU_MISC,
};
