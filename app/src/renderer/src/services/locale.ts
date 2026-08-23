export type SupportedLocale = 'ja' | 'en' | 'ko' | 'zh-CN' | 'zh-TW';

export const SUPPORTED_LOCALES = ['ja', 'en', 'ko', 'zh-CN', 'zh-TW'] as const;

export function resolveLocale(tag: string | null | undefined): SupportedLocale {
  const normalized = tag?.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return 'en';
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  if (normalized === 'ko' || normalized.startsWith('ko-')) return 'ko';
  if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/.test(normalized)) return 'zh-TW';
  if (normalized === 'zh' || /^zh-(?:hans|cn|sg)(?:-|$)/.test(normalized)) return 'zh-CN';
  return 'en';
}

export function resolveLanguageSetting(setting: string | null | undefined, systemLanguage: string | null | undefined): SupportedLocale {
  if (!setting || setting === 'auto') return resolveLocale(systemLanguage);
  return SUPPORTED_LOCALES.includes(setting as SupportedLocale) ? (setting as SupportedLocale) : 'en';
}
