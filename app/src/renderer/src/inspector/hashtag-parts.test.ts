import { expect, test } from 'vitest';
import { hashtagParts } from './hashtag-parts';

test('保存されたハッシュタグを本文内で照合し、URLや単語途中は除外する', () => {
  const text = '朝 #猫 ＃風景\n#猫耳 https://example.com/#猫 abc#猫';
  const parts = hashtagParts(text, ['猫', '風景']);
  expect(parts.filter((p) => p.tag).map((p) => p.tag)).toEqual(['猫', '風景']);
  expect(parts.map((p) => p.text).join('')).toBe(text);
});

test('大量または極端に長いハッシュタグから巨大な正規表現を作らない', () => {
  const tags = Array.from({ length: 4_000 }, (_, index) => `tag-${index}-${'x'.repeat(index)}`);
  const text = '本文 #tag-1-x';
  const parts = hashtagParts(text, tags);

  expect(parts.filter((part) => part.tag).map((part) => part.tag)).toEqual(['tag-1-x']);
  expect(parts.map((part) => part.text).join('')).toBe(text);
});
