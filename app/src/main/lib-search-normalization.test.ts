import { expect, test } from 'vitest';
import { normalizeSearchText, originalSearchRange } from './lib-search-normalization.ts';

test('展開された互換文字の途中への一致も元の一文字を指す', () => {
  const text = '😀 ㍿ ガール';
  const normalized = normalizeSearchText(text);
  const start = Buffer.byteLength(normalized.slice(0, normalized.indexOf('会社')));
  const range = originalSearchRange(text, start, Buffer.byteLength('会社'));
  expect(text.slice(range.start, range.end)).toBe('㍿');
});

test('結合文字と半角濁点の合成後も一致の後続位置がずれない', () => {
  const text = 'カ\u3099 ｶﾞ ﬃ 😀 ＡＢＣ';
  const normalized = normalizeSearchText(text);
  const start = Buffer.byteLength(normalized.slice(0, normalized.indexOf('ABC')));
  const range = originalSearchRange(text, start, 3);
  expect(text.slice(range.start, range.end)).toBe('ＡＢＣ');
});
