export type SupportedLocale = 'ja' | 'en';

export const SUPPORTED_LOCALES = ['ja', 'en'] as const;

export function resolveLocale(tag: string | null | undefined): SupportedLocale {
  const normalized = tag?.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return 'en';
  if (normalized === 'ja' || normalized.startsWith('ja-')) return 'ja';
  return 'en';
}

export function resolveLanguageSetting(setting: string | null | undefined, systemLanguage: string | null | undefined): SupportedLocale {
  if (!setting || setting === 'auto') return resolveLocale(systemLanguage);
  return SUPPORTED_LOCALES.includes(setting as SupportedLocale) ? (setting as SupportedLocale) : 'en';
}
