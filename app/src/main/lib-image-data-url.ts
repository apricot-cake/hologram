'use strict';

import fs from 'node:fs';
import { getPreparedImage } from './image-processing.ts';

export const MAX_IMAGE_DATA_URL_BYTES = 64 * 1024 * 1024;

// 回転・反転用の canvas へ渡すのは共通境界で復号・再エンコードした PNG のみ。
export async function readBoundedImageDataUrl(file: string, _mime: string): Promise<string | null> {
  try {
    const prepared = await getPreparedImage(file, { kind: 'copy' });
    if (!prepared || prepared.mime !== 'image/png') return null;
    const buf = await fs.promises.readFile(prepared.path);
    if (buf.byteLength > MAX_IMAGE_DATA_URL_BYTES) return null;
    return `data:${prepared.mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
