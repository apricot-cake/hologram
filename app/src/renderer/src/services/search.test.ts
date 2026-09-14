import { describe, expect, test } from 'vitest';
import * as S from './search';

describe('表記ゆれと部分一致', () => {
  test.each([
    ['ＡB１２', 'ab12'],
    ['ﾈｺ', 'ねこ'],
    ['ネコ', 'ねこ'],
    ['ﾊﾞｯｸﾞ', 'ばっぐ'],
    ['パン', 'ぱん'],
    ['ヴ', 'ゔ'],
    ['か\u3099', 'が'],
    ['café', 'café'],
  ])('%sを%sへ正規化する', (raw, expected) => expect(S.normalize(raw)).toBe(expected));
  test('候補の部分一致にも濁点とローマ字の区別が適用される', () => {
    expect(S.includesNormalized('ﾊﾞｯｸﾞ一覧', 'ばっぐ')).toBe(true);
    expect(S.includesNormalized('ﾊﾞｯｸﾞ一覧', 'はっく')).toBe(false);
    expect(S.includesNormalized('ねこの写真', 'neko')).toBe(false);
    expect(S.includesNormalized('ねこの写真', 'ね写')).toBe(false);
  });
});
