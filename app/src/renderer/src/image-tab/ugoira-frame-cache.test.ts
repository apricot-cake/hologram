import { describe, expect, test, vi } from 'vitest';
import { UgoiraFrameCache, type ClosableBitmap } from './ugoira-frame-cache.ts';

function bitmap(width = 1, height = 1) {
  return { width, height, close: vi.fn<() => void>() };
}

describe('うごイラのフレームキャッシュ', () => {
  test('展開済み Blob とデコード結果を byte 予算内へ LRU で収める', async () => {
    const loaded: number[] = [];
    const decoded: ReturnType<typeof bitmap>[] = [];
    const cache = new UgoiraFrameCache(
      async (i) => {
        loaded.push(i);
        return new Uint8Array(4);
      },
      async () => {
        const value = bitmap();
        decoded.push(value);
        return value;
      },
      8,
      8,
    );

    await cache.getBitmap(0);
    await cache.getBitmap(1);
    await cache.getBitmap(2);

    expect(cache.blobBytes).toBe(8);
    expect(cache.decodedBytes).toBe(8);
    expect([...cache.blobs.keys()]).toEqual([1, 2]);
    expect([...cache.bitmaps.keys()]).toEqual([1, 2]);
    expect(decoded[0]?.close).toHaveBeenCalledOnce();

    // ループで追い出した先頭へ戻れば、元の zip から安全に再展開して再生を続ける。
    await cache.getBitmap(0);
    expect(loaded).toEqual([0, 1, 2, 0]);
    expect(cache.blobBytes).toBeLessThanOrEqual(8);
    expect(cache.decodedBytes).toBeLessThanOrEqual(8);
  });

  test('単体で予算を超える資源を保持しない', async () => {
    const tooLarge = bitmap(2, 2);
    const cache = new UgoiraFrameCache(
      async () => new Uint8Array(9),
      async () => tooLarge,
      8,
      8,
    );

    expect(await cache.getBitmap(0)).toBeNull();
    expect(cache.blobBytes).toBe(0);
    expect(cache.decodedBytes).toBe(0);
    expect(tooLarge.close).toHaveBeenCalledOnce();
  });

  test('破棄後に完了した非同期読込やデコードを再保持しない', async () => {
    let finishLoad!: (bytes: Uint8Array<ArrayBuffer>) => void;
    const lateLoad = new Promise<Uint8Array<ArrayBuffer>>((resolve) => (finishLoad = resolve));
    const decode = vi.fn(async () => bitmap());
    const cache = new UgoiraFrameCache(async () => lateLoad, decode, 8, 8);
    const pending = cache.getBitmap(0);

    cache.dispose();
    finishLoad(new Uint8Array(4));
    expect(await pending).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(cache.blobBytes).toBe(0);
    expect(cache.decodedBytes).toBe(0);

    let finishDecode!: (value: ClosableBitmap) => void;
    const lateDecode = new Promise<ClosableBitmap>((resolve) => (finishDecode = resolve));
    const second = new UgoiraFrameCache(
      async () => new Uint8Array(4),
      async () => lateDecode,
      8,
      8,
    );
    const decoding = second.getBitmap(0);
    await vi.waitFor(() => expect(second.blobBytes).toBe(4));
    second.dispose();
    const lateBitmap = bitmap();
    finishDecode(lateBitmap);
    expect(await decoding).toBeNull();
    expect(lateBitmap.close).toHaveBeenCalledOnce();
    expect(second.blobBytes).toBe(0);
    expect(second.decodedBytes).toBe(0);
  });
});
