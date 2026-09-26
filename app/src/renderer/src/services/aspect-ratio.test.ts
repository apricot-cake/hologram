import { describe, expect, test } from 'vitest';
import { postView } from '../../../../../tests/helpers/test-post-view.ts';
import { aspectRatiosOf } from './aspect-ratio.ts';
import { emptyTree, evalNode, facetAdd, makePostPredOf } from './query.ts';

const image = (width: number, height: number) => postView({ image: 'image.png', shotW: width, shotH: height });

describe('縦横比', () => {
  test.each([
    [400, 600, 'portrait'],
    [399, 600, 'portrait'],
    [401, 600, 'slightlyPortrait'],
    [400, 500, 'slightlyPortrait'],
    [999, 1000, 'square'],
    [1000, 1049, 'square'],
    [1000, 1050, 'square'],
    [1000, 1051, 'slightlyPortrait'],
    [1000, 1000, 'square'],
    [1001, 1000, 'square'],
    [1049, 1000, 'square'],
    [1050, 1000, 'square'],
    [1051, 1000, 'slightlyLandscape'],
    [599, 400, 'slightlyLandscape'],
    [500, 400, 'slightlyLandscape'],
    [600, 400, 'landscape'],
    [601, 400, 'landscape'],
  ])('%i × %i → %s', (w, h, expected) => expect(aspectRatiosOf(image(w, h))).toEqual([expected]));

  test.each([
    [0, 100],
    [100, 0],
    [-1, 100],
  ])('無効な寸法は分類しない: %i × %i', (w, h) => {
    expect(aspectRatiosOf({ media: [], image: 'image.png', shotW: w, shotH: h })).toEqual([]);
  });

  test('画像ごとに判定し、同じ分類は重複させない', () => {
    expect(
      aspectRatiosOf(
        postView({
          media: [
            { file: 'a.png', width: 400, height: 500 },
            { file: 'b.png', width: 800, height: 1000 },
            { file: 'c.png', width: 1500, height: 1000 },
          ],
          shotW: 400,
          shotH: 500,
        }),
      ),
    ).toEqual(['slightlyPortrait', 'landscape']);
  });

  test('代表画像の寸法は最初のメディアにのみ補完する', () => {
    expect(aspectRatiosOf(postView({ media: [{ file: 'a.png' }], shotW: 100, shotH: 100 }))).toEqual(['square']);
    expect(aspectRatiosOf(postView({ image: 'capture.png', media: [{ file: 'a.png', width: 400, height: 500 }], shotW: 100, shotH: 100 }))).toEqual(['slightlyPortrait']);
  });

  test('複数選択はOR、別カテゴリとはAND', () => {
    const tree = emptyTree();
    facetAdd(tree, { kind: 'cond', type: 'aspectRatio', value: 'portrait' }, {});
    facetAdd(tree, { kind: 'cond', type: 'aspectRatio', value: 'slightlyPortrait' }, {});
    facetAdd(tree, { kind: 'cond', type: 'platform', value: 'x' }, {});
    const predOf = makePostPredOf({ isInFolder: () => false });
    expect(evalNode(tree, postView({ ...image(400, 600), platform: 'x' }), predOf)).toBe(true);
    expect(evalNode(tree, postView({ ...image(450, 500), platform: 'x' }), predOf)).toBe(true);
    expect(evalNode(tree, postView({ ...image(500, 500), platform: 'x' }), predOf)).toBe(false);
    expect(evalNode(tree, postView({ ...image(400, 500), platform: 'pixiv' }), predOf)).toBe(false);
  });
});
