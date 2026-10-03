export const UGOIRA_BLOB_BUDGET_BYTES = 64 * 1024 * 1024;
export const UGOIRA_DECODED_BUDGET_BYTES = 96 * 1024 * 1024;

export interface ClosableBitmap {
  width: number;
  height: number;
  close(): void;
}

// 展開済みデータとデコード済み画像を、互いに独立した byte 単位の LRU にする。
// zip 自体は main 側のファイルに残るため、追い出したフレームは必要になった時だけ再読込する。
export class UgoiraFrameCache<T extends ClosableBitmap> {
  readonly blobs = new Map<number, Blob>();
  readonly bitmaps = new Map<number, T>();
  private readonly blobJobs = new Map<number, Promise<Blob | null>>();
  private readonly bitmapJobs = new Map<number, Promise<T | null>>();
  blobBytes = 0;
  decodedBytes = 0;
  private disposed = false;

  constructor(
    private readonly load: (index: number) => Promise<Uint8Array<ArrayBuffer> | null>,
    private readonly decode: (blob: Blob) => Promise<T>,
    private readonly blobBudget = UGOIRA_BLOB_BUDGET_BYTES,
    private readonly decodedBudget = UGOIRA_DECODED_BUDGET_BYTES,
  ) {}

  private touch<V>(cache: Map<number, V>, index: number, value: V) {
    cache.delete(index);
    cache.set(index, value);
  }

  private dropBlob(index: number) {
    const blob = this.blobs.get(index);
    if (!blob) return;
    this.blobs.delete(index);
    this.blobBytes -= blob.size;
  }

  dropBitmap(index: number) {
    const bitmap = this.bitmaps.get(index);
    if (!bitmap) return;
    this.bitmaps.delete(index);
    this.decodedBytes -= bitmap.width * bitmap.height * 4;
    bitmap.close();
  }

  private admitBlob(index: number, blob: Blob) {
    if (this.disposed || blob.size > this.blobBudget) return;
    while (this.blobBytes + blob.size > this.blobBudget) {
      const oldest = this.blobs.keys().next().value;
      if (oldest === undefined) break;
      this.dropBlob(oldest);
    }
    this.blobs.set(index, blob);
    this.blobBytes += blob.size;
  }

  private async blobFor(index: number): Promise<Blob | null> {
    const held = this.blobs.get(index);
    if (held) {
      this.touch(this.blobs, index, held);
      return held;
    }
    const running = this.blobJobs.get(index);
    if (running) return running;
    const job = this.load(index)
      .then((bytes) => {
        if (!bytes || this.disposed) return null;
        const blob = new Blob([bytes]);
        this.admitBlob(index, blob);
        return blob;
      })
      .catch(() => null)
      .finally(() => this.blobJobs.delete(index));
    this.blobJobs.set(index, job);
    return job;
  }

  getBitmap(index: number): Promise<T | null> {
    const held = this.bitmaps.get(index);
    if (held) {
      this.touch(this.bitmaps, index, held);
      return Promise.resolve(held);
    }
    const running = this.bitmapJobs.get(index);
    if (running) return running;
    const job = this.blobFor(index)
      .then((blob) => (blob && !this.disposed ? this.decode(blob) : null))
      .then((bitmap) => {
        if (!bitmap) return null;
        const size = bitmap.width * bitmap.height * 4;
        if (this.disposed || size > this.decodedBudget) {
          bitmap.close();
          return null;
        }
        while (this.decodedBytes + size > this.decodedBudget) {
          const oldest = this.bitmaps.keys().next().value;
          if (oldest === undefined) break;
          this.dropBitmap(oldest);
        }
        this.bitmaps.set(index, bitmap);
        this.decodedBytes += size;
        return bitmap;
      })
      .catch(() => null)
      .finally(() => this.bitmapJobs.delete(index));
    this.bitmapJobs.set(index, job);
    return job;
  }

  dispose() {
    this.disposed = true;
    for (const index of [...this.bitmaps.keys()]) this.dropBitmap(index);
    this.blobs.clear();
    this.blobBytes = 0;
  }
}
