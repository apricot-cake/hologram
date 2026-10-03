export const UGOIRA_BLOB_BUDGET_BYTES = 64 * 1024 * 1024;
export const UGOIRA_DECODED_BUDGET_BYTES = 96 * 1024 * 1024;

export interface ClosableBitmap {
  width: number;
  height: number;
  close(): void;
}

export interface UgoiraFrameData {
  bytes: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

// 展開済みデータとデコード済み画像を、互いに独立した byte 単位の LRU にする。
// zip 自体は main 側のファイルに残るため、追い出したフレームは必要になった時だけ再読込する。
export class UgoiraFrameCache<T extends ClosableBitmap> {
  readonly blobs = new Map<number, Blob>();
  readonly bitmaps = new Map<number, T>();
  private readonly decodedSizes = new Map<number, number>();
  private readonly blobJobs = new Map<number, Promise<{ blob: Blob; decodedSize: number } | null>>();
  private readonly bitmapJobs = new Map<number, Promise<T | null>>();
  blobBytes = 0;
  decodedBytes = 0;
  private disposed = false;
  private reservedDecodedBytes = 0;

  constructor(
    private readonly load: (index: number) => Promise<UgoiraFrameData | null>,
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
    this.decodedSizes.delete(index);
    this.blobBytes -= blob.size;
  }

  dropBitmap(index: number) {
    const bitmap = this.bitmaps.get(index);
    if (!bitmap) return;
    this.bitmaps.delete(index);
    this.decodedBytes -= bitmap.width * bitmap.height * 4;
    bitmap.close();
  }

  private admitBlob(index: number, blob: Blob, decodedSize: number) {
    if (this.disposed || blob.size > this.blobBudget) return;
    while (this.blobBytes + blob.size > this.blobBudget) {
      const oldest = this.blobs.keys().next().value;
      if (oldest === undefined) break;
      this.dropBlob(oldest);
    }
    this.blobs.set(index, blob);
    this.decodedSizes.set(index, decodedSize);
    this.blobBytes += blob.size;
  }

  private async blobFor(index: number): Promise<{ blob: Blob; decodedSize: number } | null> {
    const held = this.blobs.get(index);
    if (held) {
      this.touch(this.blobs, index, held);
      return { blob: held, decodedSize: this.decodedSizes.get(index) ?? 0 };
    }
    const running = this.blobJobs.get(index);
    if (running) return running;
    const job = this.load(index)
      .then((bytes) => {
        if (!bytes || this.disposed) return null;
        const decodedSize = bytes.width * bytes.height * 4;
        if (!Number.isSafeInteger(decodedSize) || decodedSize <= 0 || decodedSize > this.decodedBudget) return null;
        const blob = new Blob([bytes.bytes]);
        this.admitBlob(index, blob, decodedSize);
        return { blob, decodedSize };
      })
      .catch(() => null)
      .finally(() => this.blobJobs.delete(index));
    this.blobJobs.set(index, job);
    return job;
  }

  getBitmap(index: number, protectedIndices: ReadonlySet<number> = new Set()): Promise<T | null> {
    const held = this.bitmaps.get(index);
    if (held) {
      this.touch(this.bitmaps, index, held);
      return Promise.resolve(held);
    }
    const running = this.bitmapJobs.get(index);
    if (running) return running;
    let reservation = 0;
    const job = this.blobFor(index)
      .then((frame) => {
        if (!frame || this.disposed) return null;
        // 既存キャッシュと走行中デコードの双方を数える。保護中の現在フレームや先読み窓を
        // 追い出してまでデコードせず、空きが作れない場合はこの先読みを諦める。
        while (this.decodedBytes + this.reservedDecodedBytes + frame.decodedSize > this.decodedBudget) {
          const oldest = [...this.bitmaps.keys()].find((key) => !protectedIndices.has(key));
          if (oldest === undefined) return null;
          this.dropBitmap(oldest);
        }
        reservation = frame.decodedSize;
        this.reservedDecodedBytes += reservation;
        return this.decode(frame.blob);
      })
      .then((bitmap) => {
        if (!bitmap) return null;
        const size = bitmap.width * bitmap.height * 4;
        if (this.disposed || size > reservation) {
          bitmap.close();
          return null;
        }
        this.bitmaps.set(index, bitmap);
        this.decodedBytes += size;
        return bitmap;
      })
      .catch(() => null)
      .finally(() => {
        this.reservedDecodedBytes -= reservation;
        this.bitmapJobs.delete(index);
      });
    this.bitmapJobs.set(index, job);
    return job;
  }

  dispose() {
    this.disposed = true;
    for (const index of [...this.bitmaps.keys()]) this.dropBitmap(index);
    this.blobs.clear();
    this.decodedSizes.clear();
    this.blobBytes = 0;
  }
}

// 再生位置が進んでも先読み処理を増殖させず、最新位置の有限窓だけを1本ずつ処理する。
export class UgoiraPrefetcher<T extends ClosableBitmap> {
  private next: { from: number; current: number; frameCount: number } | null = null;
  private running = false;
  private disposed = false;

  constructor(
    private readonly cache: Pick<UgoiraFrameCache<T>, 'getBitmap'>,
    private readonly windowSize: number,
  ) {}

  request(from: number, current: number, frameCount: number) {
    this.next = { from, current, frameCount };
    if (!this.running) void this.run();
  }

  private async run() {
    this.running = true;
    try {
      while (this.next && !this.disposed) {
        const request = this.next;
        this.next = null;
        const protectedIndices = new Set([request.current]);
        for (let k = 0; k < Math.min(request.frameCount, this.windowSize) && !this.disposed; k++) {
          const index = (request.from + k) % request.frameCount;
          const bitmap = await this.cache.getBitmap(index, protectedIndices);
          if (!bitmap) break;
          protectedIndices.add(index);
        }
      }
    } finally {
      this.running = false;
      if (this.next && !this.disposed) void this.run();
    }
  }

  dispose() {
    this.disposed = true;
    this.next = null;
  }
}
