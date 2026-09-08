import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ write: vi.fn(), decode: vi.fn(), image: { isEmpty: () => false } }));
vi.mock('electron', () => ({
  clipboard: { write: mocks.write },
  ClipboardItem: class {
    constructor(public data: Record<string, Blob>) {}
  },
  nativeImage: { createFromBuffer: () => mocks.image },
}));
vi.mock('../app/src/main/lib-thumbnails.ts', () => ({ getDelegatedThumbnail: mocks.decode }));
import { copyLibraryImage } from '../app/src/main/image-clipboard.ts';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.decode.mockResolvedValue(Buffer.from('png'));
});
test('原寸のPNGをデコードしてから画像を書き込む', async () => {
  expect(await copyLibraryImage('image.webp', 'C:/library')).toBe(true);
  expect(mocks.decode).toHaveBeenCalledWith(expect.stringContaining('image.webp'), Number.MAX_SAFE_INTEGER, 'image/png');
  const payload = mocks.write.mock.calls[0][0][0].data['image/png'] as Blob;
  expect(payload.type).toBe('image/png');
  expect(await payload.text()).toBe('png');
});
test('動画、範囲外、配列、不正入力はクリップボードへ渡さない', async () => {
  for (const file of ['video.mp4', '../image.png', 'avatars/image.png', '.trash/image.png', ['image.png'], '', null]) expect(await copyLibraryImage(file, 'C:/library')).toBe(false);
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
test('欠落や壊れた画像のデコードに失敗してもクリップボードを保持する', async () => {
  mocks.decode.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('decode'));
  expect(await copyLibraryImage('missing.png', 'C:/library')).toBe(false);
  expect(await copyLibraryImage('broken.png', 'C:/library')).toBe(false);
  expect(mocks.write).not.toHaveBeenCalled();
});

test('書き込みの完了を待ち、非同期の失敗を成功として返さない', async () => {
  mocks.write.mockRejectedValueOnce(new Error('clipboard busy'));
  expect(await copyLibraryImage('image.png', 'C:/library')).toBe(false);
});
