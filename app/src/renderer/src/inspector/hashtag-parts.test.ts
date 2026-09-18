import { expect, test } from 'vitest';
import { hashtagParts } from './hashtag-parts';

test('保存されたハッシュタグを本文内で照合し、URLや単語途中は除外する', () => {
  const text = '朝 #猫 ＃風景\n#猫耳 https://example.com/#猫 abc#猫';
  const parts = hashtagParts(text, ['猫', '風景']);
  expect(parts.filter((p) => p.tag).map((p) => p.tag)).toEqual(['猫', '風景']);
  expect(parts.map((p) => p.text).join('')).toBe(text);
});
