import { koMessages } from './ko.ts';
import { zhCNMessages } from './zh-CN.ts';
import { zhTWMessages } from './zh-TW.ts';

export const EXTRA_MESSAGES: Record<string, Record<string, string>> = {
  ko: koMessages,
  'zh-CN': zhCNMessages,
  'zh-TW': zhTWMessages,
};
