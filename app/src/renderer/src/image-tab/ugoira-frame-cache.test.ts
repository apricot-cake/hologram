import { describe, expect, test, vi } from 'vitest';
import { UgoiraFrameCache, UgoiraPrefetcher, type ClosableBitmap } from './ugoira-frame-cache.ts';

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
        return { bytes: new Uint8Array(4), width: 1, height: 1 };
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
      async () => ({ bytes: new Uint8Array(9), width: 1, height: 1 }),
      async () => tooLarge,
      8,
      8,
    );

    expect(await cache.getBitmap(0)).toBeNull();
    expect(cache.blobBytes).toBe(0);
    expect(cache.decodedBytes).toBe(0);
    expect(tooLarge.close).toHaveBeenCalledOnce();
  });

  test('ヘッダー寸法が予算を超えるフレームをデコード前に拒否する', async () => {
    const decode = vi.fn(async () => bitmap(3, 1));
    const cache = new UgoiraFrameCache(async () => ({ bytes: new Uint8Array(4), width: 3, height: 1 }), decode, 8, 8);

    expect(await cache.getBitmap(0)).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(cache.blobBytes).toBe(0);
    expect(cache.decodedBytes).toBe(0);
  });

  test('予算に割り切れない長いループでも有限窓で止まり、先頭へ戻れる', async () => {
    const loaded: number[] = [];
    const cache = new UgoiraFrameCache(
      async (i) => {
        loaded.push(i);
        return { bytes: new Uint8Array(1), width: 2, height: 1 };
      },
      async () => bitmap(2, 1),
      100,
      20,
    );
    await cache.getBitmap(0);
    const prefetcher = new UgoiraPrefetcher(cache, 8);

    prefetcher.request(1, 0, 100);
    await vi.waitFor(() => expect(loaded).toEqual([0, 1, 2]));
    expect(cache.decodedBytes).toBe(16);
    expect(cache.bitmaps.has(0)).toBe(true);
    expect(loaded).not.toContain(3);

    // 終端からの窓は modulo で先頭へ戻るが、全100枚を走査しない。
    prefetcher.request(99, 98, 100);
    await vi.waitFor(() => expect(loaded).toContain(99));
    await vi.waitFor(() => expect(cache.bitmaps.has(0)).toBe(true));
    expect(loaded.length).toBeLessThan(10);
    prefetcher.dispose();
  });

  test('再生位置が更新されても先読みを重複実行しない', async () => {
    let finish!: () => void;
    const first = new Promise<void>((resolve) => (finish = resolve));
    let active = 0;
    let maxActive = 0;
    const requested: number[] = [];
    const getBitmap = vi.fn(async (index: number) => {
      requested.push(index);
      active++;
      maxActive = Math.max(maxActive, active);
      if (requested.length === 1) await first;
      active--;
      return bitmap();
    });
    const prefetcher = new UgoiraPrefetcher({ getBitmap }, 2);

    prefetcher.request(1, 0, 100);
    prefetcher.request(11, 10, 100);
    prefetcher.request(21, 20, 100);
    expect(requested).toEqual([1]);
    finish();
    await vi.waitFor(() => expect(requested).toEqual([1, 2, 21, 22]));
    expect(maxActive).toBe(1);
    prefetcher.dispose();
  });

  test('破棄後に完了した非同期読込やデコードを再保持しない', async () => {
    let finishLoad!: (frame: { bytes: Uint8Array<ArrayBuffer>; width: number; height: number }) => void;
    const lateLoad = new Promise<{ bytes: Uint8Array<ArrayBuffer>; width: number; height: number }>((resolve) => (finishLoad = resolve));
    const decode = vi.fn(async () => bitmap());
    const cache = new UgoiraFrameCache(async () => lateLoad, decode, 8, 8);
    const pending = cache.getBitmap(0);

    cache.dispose();
    finishLoad({ bytes: new Uint8Array(4), width: 1, height: 1 });
    expect(await pending).toBeNull();
    expect(decode).not.toHaveBeenCalled();
    expect(cache.blobBytes).toBe(0);
    expect(cache.decodedBytes).toBe(0);

    let finishDecode!: (value: ClosableBitmap) => void;
    const lateDecode = new Promise<ClosableBitmap>((resolve) => (finishDecode = resolve));
    const second = new UgoiraFrameCache(
      async () => ({ bytes: new Uint8Array(4), width: 1, height: 1 }),
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
