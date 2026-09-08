/** @vitest-environment jsdom */

import { beforeEach, describe, expect, test } from 'vitest';
import { selectedMediaContextInPage } from './selected-media-context.ts';

describe('右クリックした媒体の補助情報', () => {
  beforeEach(() => {
    document.head.innerHTML = '<base href="https://example.com/">';
    document.body.innerHTML = '';
  });

  test('選んだ画像の URL を照合して alt を返す', () => {
    document.body.innerHTML = '<img src="https://cdn.example/other.png" alt="別"><img src="https://cdn.example/selected.png" alt=" 作品の説明 ">';
    expect(selectedMediaContextInPage('https://cdn.example/selected.png', document)).toEqual({ alt: '作品の説明' });
  });

  test('画像を囲むリンク先は出典として推測しない', () => {
    document.body.innerHTML = '<a href="https://shop.example/item"><img src="https://cdn.example/selected.png" alt="商品"></a>';
    expect(selectedMediaContextInPage('https://cdn.example/selected.png', document)).toEqual({ alt: '商品' });
  });

  test('動画は source の URL と aria-label を読める', () => {
    document.body.innerHTML = '<video aria-label="紹介動画"><source src="https://cdn.example/selected.mp4"></video>';
    expect(selectedMediaContextInPage('https://cdn.example/selected.mp4', document)).toEqual({ alt: '紹介動画' });
  });
});
