import type { Rotation } from './image-edit.ts';

// AVIF は検証済みの asset を Chromium に表示し、画素を canvas に移さない。
// それ以外の回転・反転は main の共通画像境界に派生画像を要求する。
export function useOrientedImage(src: string, rotation: Rotation, flipped: boolean) {
  try {
    const url = new URL(src);
    if (url.protocol !== 'asset:') throw new Error('画像を表示できませんでした');
    const avif = /\.avif$/i.test(decodeURIComponent(url.pathname));
    url.searchParams.delete('rotate');
    url.searchParams.delete('flip');
    if (!avif) {
      if (rotation) url.searchParams.set('rotate', String(rotation));
      if (flipped) url.searchParams.set('flip', '1');
    }
    return { src: url.href, rotation: avif ? rotation : (0 as Rotation), flipped: avif && flipped, avif, error: undefined };
  } catch {
    return { src: undefined, rotation: 0 as Rotation, flipped: false, avif: false, error: '画像を表示できませんでした' };
  }
}
