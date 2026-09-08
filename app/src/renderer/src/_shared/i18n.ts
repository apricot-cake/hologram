import { hologramI18n, type HologramI18nApi } from '../services/i18n.ts';
import type { Translate } from '../services/translation.ts';

let api: HologramI18nApi | null = null;

export async function initI18n(): Promise<HologramI18nApi | null> {
  try {
    api = await hologramI18n;
  } catch {
    api = null; // i18n が使えない＝t() は生のキーへ退避する
  }
  return api;
}

export const t: Translate = (key, options) => {
  if (!api) return key;
  return api.getMessage(key, options);
};

export function lang(): string {
  return api ? api.lang : 'auto';
}
