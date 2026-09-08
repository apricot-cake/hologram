import { expect, test } from 'vitest';
import { selectPostMedia } from './select-post-media.ts';
import { mediaKeyOf } from './extractor/index.ts';

const media = [
  { type: 'image' as const, alt: null, width: null, height: null, url: 'https://pbs.twimg.com/media/AAA?format=jpg&name=orig' },
  { type: 'image' as const, alt: null, width: null, height: null, url: 'https://pbs.twimg.com/media/BBB?format=jpg&name=orig' },
];

test('個別保存はサムネイルと同じ画像だけを選ぶ', () => {
  const key = mediaKeyOf('x', 'https://pbs.twimg.com/media/BBB.jpg')!;
  expect(selectPostMedia(media, 'x', [key])).toEqual([media[1]]);
});

test('一括保存はすべての画像を選ぶ', () => {
  expect(selectPostMedia(media, 'x')).toBe(media);
});

test('不明な画像の指定を全体保存へ切り替えない', () => {
  expect(() => selectPostMedia(media, 'x', [])).toThrow();
  expect(() => selectPostMedia(media, 'x', ['unknown'])).toThrow();
  expect(() =>
    selectPostMedia(
      media,
      'x',
      media.map((item) => mediaKeyOf('x', item.url)!),
    ),
  ).toThrow();
});
