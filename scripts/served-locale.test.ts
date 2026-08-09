// Guard for extension/utils/locale.ts — the one place that says which of OUR
// locales a language tag ends up reading (#1057).
//
// Two failures are worth catching here, and both are invisible at runtime:
//   1. the mapping stops agreeing with Chrome's documented lookup, so a page
//      declares a language it is not written in
//   2. a locale is added under _locales/ and this mapping is not, so the new
//      language ships with `lang` pointing at the old one (#222 adds five)
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { servedLocale } from '../extension/utils/locale.ts';

describe('servedLocale', () => {
  test('ja 系のタグは ja を読む', () => {
    expect(servedLocale('ja')).toBe('ja');
    expect(servedLocale('ja-JP')).toBe('ja');
    // getUILanguage() の返す形は実装依存＝大文字や _ 区切りで来ても取りこぼさない
    expect(servedLocale('JA-JP')).toBe('ja');
    expect(servedLocale('ja_JP')).toBe('ja');
  });

  test('en 系のタグは en を読む', () => {
    expect(servedLocale('en')).toBe('en');
    expect(servedLocale('en-US')).toBe('en');
    expect(servedLocale('en-GB')).toBe('en');
  });

  // ここが getUILanguage() の生値を書けない理由そのもの＝_locales に無い言語は
  // default_locale の en が配られるので、名乗るのも en でなければならない。
  test('_locales に無い言語は default_locale の en を読む', () => {
    expect(servedLocale('fr-FR')).toBe('en');
    expect(servedLocale('ko')).toBe('en');
    expect(servedLocale('zh-TW')).toBe('en');
  });

  test('タグが無い・空でも必ずどちらかに落ちる', () => {
    expect(servedLocale(null)).toBe('en');
    expect(servedLocale(undefined)).toBe('en');
    expect(servedLocale('')).toBe('en');
  });
});

test('_locales のロケール集合と servedLocale の対応表がずれていない', () => {
  const dir = path.join(import.meta.dirname, '..', 'extension', 'public', '_locales');
  const shipped = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  // 増やしたら extension/utils/locale.ts の servedLocale と、この一覧の両方を直す。
  expect(shipped, '_locales にロケールが増減した＝servedLocale の対応表も直すこと').toEqual(['en', 'ja']);
  // 対応表が返しうる値は、実際に配れるロケールだけであること。
  for (const tag of shipped) expect(shipped).toContain(servedLocale(tag));
});
