import ICU from 'i18next-icu';
import { createInstance, type TOptions } from 'i18next';
import en from './locales/en.ts';
import ja from './locales/ja.ts';
export const resources = { en: { translation: en }, ja: { translation: ja } };
export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey, options?: TOptions) => string;

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
    enableSelector: false;
    strictKeyChecks: true;
    parseInterpolation: false;
  }
}

export async function createTranslator(language: 'ja' | 'en'): Promise<Translate> {
  const instance = createInstance().use(ICU);
  await instance.init({
    lng: language,
    supportedLngs: ['ja', 'en'],
    fallbackLng: 'en',
    resources,
    interpolation: { escapeValue: false },
    // 文言はReactのテキスト、またはtextContentとして描画する。
  });
  return instance.t.bind(instance);
}
