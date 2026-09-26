export type AspectRatio = 'portrait' | 'slightlyPortrait' | 'square' | 'slightlyLandscape' | 'landscape';
export const ASPECT_RATIOS = [
  { value: 'portrait', label: 'ratioPortrait' },
  { value: 'slightlyPortrait', label: 'ratioSlightlyPortrait' },
  { value: 'square', label: 'ratioSquare' },
  { value: 'slightlyLandscape', label: 'ratioSlightlyLandscape' },
  { value: 'landscape', label: 'ratioLandscape' },
] as const;

/** 各画像の保存寸法で判定する。別画像の最大幅と最大高さは組み合わせない。 */
export function aspectRatiosOf(post: Pick<HologramPost, 'media' | 'image' | 'shotW' | 'shotH'>): AspectRatio[] {
  const result = new Set<AspectRatio>();
  const add = (width: number | null | undefined, height: number | null | undefined) => {
    if (!width || !height || width <= 0 || height <= 0 || !Number.isFinite(width) || !Number.isFinite(height)) return;
    // 長辺が短辺の1.05倍以内なら正方形。整数比で境界の丸め誤差を避ける。
    const square = Math.max(width, height) * 20 <= Math.min(width, height) * 21;
    result.add(square ? 'square' : width * 3 <= height * 2 ? 'portrait' : width * 2 >= height * 3 ? 'landscape' : width < height ? 'slightlyPortrait' : 'slightlyLandscape');
  };
  const media = post.media || [];
  for (const item of media) add(item.width, item.height);
  // 古いデータでも、代表画像の寸法が分かればその画像は判定できる。
  if ((!media.length && post.image) || (media.length && !(media[0].width && media[0].height))) add(post.shotW, post.shotH);
  return [...result];
}
