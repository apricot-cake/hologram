// extension/utils/locale.ts の防ぎ＝言語タグがこちらのどのロケールを読むことに
// なるかを言う唯一の場所（#1057）。
//
// ここで捕まえる価値のある失敗は2つあり、どちらも実行時には見えない。
//   1. 対応表が Chrome の文書化された引き方と食い違い、ページがそこに書かれて
//      いない言語を名乗る
//   2. _locales/ にロケールを足してこの対応表を足さず、新しい言語が `lang` に
//      古い方を指したまま配られる
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { servedLocale } from './locale.ts';

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
    expect(servedLocale('ko-KR')).toBe('en');
    expect(servedLocale('zh-Hant')).toBe('en');
  });

  test('タグが無い・空でも必ずどちらかに落ちる', () => {
    expect(servedLocale(null)).toBe('en');
    expect(servedLocale(undefined)).toBe('en');
    expect(servedLocale('')).toBe('en');
  });
});

test('_locales のロケール集合と servedLocale の対応表がずれていない', () => {
  const dir = path.join(import.meta.dirname, '../public/_locales');
  const shipped = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, 'messages.json')))
    .map((entry) => entry.name)
    .sort();
  // 増やしたら extension/utils/locale.ts の servedLocale と、この一覧の両方を直す。
  expect(shipped, '_locales にロケールが増減した＝servedLocale の対応表も直すこと').toEqual(['en', 'ja']);
  // 対応表が返しうる値は、実際に配れるロケールだけであること。
  const shippedBcp47 = shipped.map((tag) => tag.replaceAll('_', '-'));
  for (const tag of shipped) expect(shippedBcp47).toContain(servedLocale(tag));
});
