import { describe, expect, test } from 'vitest';
import { posterAvatarThumbnailWidth } from './asset-src.ts';

describe('posterAvatarThumbnailWidth', () => {
  test('poster grid の表示幅と DPR に合わせ、固定 64px にしない', () => {
    expect(posterAvatarThumbnailWidth(200, 1)).toBe(200);
    expect(posterAvatarThumbnailWidth(340, 2)).toBe(680);
  });

  test('小さい表示は小さい要求のまま、protocol の範囲内に収める', () => {
    expect(posterAvatarThumbnailWidth(32, 1)).toBe(64);
    expect(posterAvatarThumbnailWidth(1_000, 3)).toBe(720);
  });
});
