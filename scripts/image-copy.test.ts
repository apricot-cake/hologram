import { beforeEach, expect, test, vi } from 'vitest';
const copy = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('../app/src/renderer/src/services/ipc.ts', () => ({ hologramIpc: { copyImage: copy } }));
vi.mock('../app/src/renderer/src/services/ui.ts', () => ({ notify: vi.fn() }));
vi.mock('../app/src/renderer/src/_shared/i18n.ts', () => ({ t: (key: string) => key }));
import { close, copyImage, get, requestImageCopy } from '../app/src/renderer/src/services/image-copy.ts';
beforeEach(() => {
  close();
  copy.mockClear();
});
test('画像が1枚なら動画や重複を除いて即コピーする', () => {
  requestImageCopy(['video.mp4', 'a.png', 'a.png']);
  expect(copy).toHaveBeenCalledWith('a.png');
  expect(get()).toBeNull();
});
test('スタックは選択するまでコピーせず、キャンセルで変更しない', () => {
  requestImageCopy(['a.png', 'b.webp']);
  expect(get()).toEqual(['a.png', 'b.webp']);
  expect(copy).not.toHaveBeenCalled();
  close();
  expect(get()).toBeNull();
  expect(copy).not.toHaveBeenCalled();
});
test('選んだ画像1枚だけをコピーする', async () => {
  requestImageCopy(['a.png', 'b.webp']);
  close();
  await copyImage('b.webp');
  expect(copy).toHaveBeenCalledExactlyOnceWith('b.webp');
});
test('動画だけならダイアログもコピーも実行しない', () => {
  requestImageCopy(['video.mp4', 'animation.zip']);
  expect(get()).toBeNull();
  expect(copy).not.toHaveBeenCalled();
});
