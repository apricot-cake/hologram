import { hologramIpc } from './ipc.ts';
import { resolveLanguageSetting } from './locale.ts';
import { createTranslator } from './translation.ts';

export const hologramI18n = (async () => {
  let lang = 'auto';
  try {
    lang = (await hologramIpc.getPrefs()).language || 'auto';
  } catch {
    /* 設定が読めない場合はOSの言語を使う。 */
  }
  const resolved = resolveLanguageSetting(lang, navigator.language);
  const getMessage = await createTranslator(resolved);
  return { lang, resolved, getMessage };
})();
export type HologramI18nApi = Awaited<typeof hologramI18n>;
