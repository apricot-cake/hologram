import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), readFile: vi.fn() }));
vi.mock('./image-processing.ts', () => ({ getPreparedImage: mocks.prepare }));
vi.mock('node:fs', () => ({ default: { promises: { readFile: mocks.readFile } } }));
import { MAX_IMAGE_DATA_URL_BYTES, readBoundedImageDataUrl } from './lib-image-data-url.ts';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({ path: 'safe-output.png', mime: 'image/png' });
  mocks.readFile.mockResolvedValue(Buffer.from('derived-png'));
});

describe('readBoundedImageDataUrl', () => {
  it('原本の MIME にかかわらず共通境界が作った PNG を返す', async () => {
    await expect(readBoundedImageDataUrl('source.avif', 'image/avif')).resolves.toBe(`data:image/png;base64,${Buffer.from('derived-png').toString('base64')}`);
    expect(mocks.prepare).toHaveBeenCalledWith('source.avif', { kind: 'copy' });
    expect(mocks.readFile).toHaveBeenCalledWith('safe-output.png');
  });

  it('拒否された原本を読み込まない', async () => {
    mocks.prepare.mockResolvedValue(null);
    await expect(readBoundedImageDataUrl('source.png', 'image/png')).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('原本 AVIF が誤って返っても data URL として渡さない', async () => {
    mocks.prepare.mockResolvedValue({ path: 'source.avif', mime: 'image/avif' });
    await expect(readBoundedImageDataUrl('source.avif', 'image/avif')).resolves.toBeNull();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it('IPC の出力上限を超える派生 PNG を渡さない', async () => {
    mocks.readFile.mockResolvedValue(Buffer.alloc(MAX_IMAGE_DATA_URL_BYTES + 1));
    await expect(readBoundedImageDataUrl('source.png', 'image/png')).resolves.toBeNull();
  });
});
