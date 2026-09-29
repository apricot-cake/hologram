'use strict';

import fs from 'node:fs';
import { imageSize } from './lib-imgsize.ts';

const HEADER_BYTES = 262144;
export const MAX_IMAGE_DATA_URL_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_DATA_URL_PIXELS = 40_000_000;

// 回転・反転用の canvas へ渡す画像だけを data URL にする。書庫由来の原本は最大 1 GiB
// なので、全読み込みの前にファイル量と復号後の画素量の両方を制限する。
export async function readBoundedImageDataUrl(file: string, mime: string): Promise<string | null> {
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_IMAGE_DATA_URL_BYTES) return null;

    const header = Buffer.alloc(Math.min(HEADER_BYTES, stat.size));
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const dimensions = imageSize(header.subarray(0, bytesRead));
    if (!dimensions || dimensions.width * dimensions.height > MAX_IMAGE_DATA_URL_PIXELS) return null;

    const buf = await handle.readFile();
    if (buf.byteLength > MAX_IMAGE_DATA_URL_BYTES) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
