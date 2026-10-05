import type { Rotation } from './image-edit.ts';

// 共通画像境界の出力を表示し、編集は CSS で適用する。
// 拡張子から復号形式を推測せず、アニメーションもそのまま保つ。
export function useOrientedImage(src: string, rotation: Rotation, flipped: boolean) {
  try {
    const url = new URL(src);
    if (url.protocol !== 'asset:') throw new Error('画像を表示できませんでした');
    url.searchParams.delete('rotate');
    url.searchParams.delete('flip');
    return { src: url.href, rotation, flipped, error: undefined };
  } catch {
    return { src: undefined, rotation: 0 as Rotation, flipped: false, error: '画像を表示できませんでした' };
  }
}
