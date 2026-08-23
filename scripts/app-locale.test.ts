import { describe, expect, test } from 'vitest';
import { resolveLanguageSetting, resolveLocale } from '../app/src/renderer/src/services/locale.ts';

describe('app locale resolution', () => {
  test.each([
    ['ja-JP', 'ja'],
    ['en-GB', 'en'],
    ['ko-KR', 'ko'],
    ['zh', 'zh-CN'],
    ['zh-Hans-SG', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['fr-FR', 'en'],
  ])('%s を %s に解決する', (input, expected) => {
    expect(resolveLocale(input)).toBe(expected);
  });

  test('auto はシステム言語に従う', () => {
    expect(resolveLanguageSetting('auto', 'ko-KR')).toBe('ko');
  });

  test('明示設定を優先し、未知の保存値は英語へ退避する', () => {
    expect(resolveLanguageSetting('zh-TW', 'ja-JP')).toBe('zh-TW');
    expect(resolveLanguageSetting('fr', 'ja-JP')).toBe('en');
  });
});
