import { describe, expect, test } from 'vitest';
import { useOrientedImage } from './use-oriented-image.ts';
import { orientedDimensions, orientedFrameLayout } from './oriented-image-frame.tsx';

describe('安全な asset 画像の回転・反転', () => {
  test.each(['png', 'gif', 'webp', 'avif', 'bin', 'mp4'])('拡張子 %s に関係なく表示の回転・反転を維持する', (extension) => {
    const result = useOrientedImage(`asset://img/items/id/image.${extension}`, 90, true);
    expect(result.src).toBe(`asset://img/items/id/image.${extension}`);
    expect(result.rotation).toBe(90);
    expect(result.flipped).toBe(true);
  });

  test('編集を解除すると古い回転・反転 query も消える', () => {
    expect(useOrientedImage('asset://img/image.png?rotate=90&flip=1', 0, false).src).toBe('asset://img/image.png');
  });

  test('既存 query とエンコード済みファイル名を保持する', () => {
    expect(useOrientedImage('asset://img/%E7%94%BB%E5%83%8F.png?version=1', 270, false).src).toBe('asset://img/%E7%94%BB%E5%83%8F.png?version=1');
  });

  test('AVIF は原本 asset を維持し、CSS 用の回転・反転を返す', () => {
    expect(useOrientedImage('asset://img/animation.AVIF', 90, true)).toEqual({ src: 'asset://img/animation.AVIF', rotation: 90, flipped: true, error: undefined });
  });

  test.each(['data:image/png;base64,owned', 'blob:https://example.com/id', 'https://example.com/image.avif', 'not a URL'])('asset 以外を画像として復号しない: %s', (src) => {
    expect(useOrientedImage(src, 90, true).src).toBeUndefined();
  });

  test.each([90, 270] as const)('%s 度の AVIF は回転後の box 寸法でフィットする', (rotation) => {
    expect(orientedDimensions(600, 400, rotation)).toEqual({ width: 400, height: 600 });
    const layout = orientedFrameLayout(600, 400, rotation, false, 200, 200);
    expect(layout.frame.width).toBeCloseTo(400 / 3);
    expect(layout.frame.height).toBe(200);
    expect(layout.image.width).toBe(200);
    expect(layout.image.height).toBeCloseTo(400 / 3);
  });

  test('AVIF のクロップは回転後の表示面の座標を使う', () => {
    const layout = orientedFrameLayout(600, 400, 90, true, 100, 100, { x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
    expect(layout.frame.width).toBeCloseTo((100 * 200) / 360);
    expect(layout.frame.height).toBe(100);
    expect(layout.plane.left).toBeCloseTo((-100 * 40) / 360);
    expect(layout.plane.top).toBeCloseTo((-100 * 120) / 360);
    expect(layout.image.transform).toBe('translate(-50%, -50%) scaleX(-1) rotate(90deg)');
  });
});
