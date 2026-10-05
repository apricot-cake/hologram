import { protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { getSaveFolder } from './lib-config.ts';
import { assetSecurityHeaders } from './asset-headers.ts';
import { parseAssetByteRange } from './lib-http-range.ts';
import { getPreparedImage } from './image-processing.ts';
import { ASSET_STREAM_HEADER_BYTES, canStreamAssetOriginal } from './lib-asset-stream-signature.ts';

export interface ImageProtocolDeps {
  resolveInFolder(name: string): string | null;
}

const EXT_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.zip': 'application/zip',
};

export function mimeForFile(name: string): string {
  return EXT_MIME[path.extname(name || '').toLowerCase()] || 'application/octet-stream';
}

export function registerImageProtocol({ resolveInFolder }: ImageProtocolDeps): void {
  protocol.handle('asset', async (request) => {
    const error = (message: string, status: number) => new Response(message, { status, headers: assetSecurityHeaders() });
    let originalFile: fs.promises.FileHandle | undefined;
    try {
      if (!getSaveFolder()) return error('No save folder', 404);
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel === '.' || rel === '..') return error('Not found', 404);
      const resolved = resolveInFolder(rel);
      if (!resolved) return error('Forbidden', 403);
      const originalMime = mimeForFile(resolved);
      let prefix: Buffer = Buffer.alloc(0);
      let imageRequest = originalMime.startsWith('image/');
      if (!imageRequest) {
        originalFile = await fs.promises.open(resolved, 'r');
        const header = Buffer.alloc(ASSET_STREAM_HEADER_BYTES);
        const read = await originalFile.read(header, 0, header.length, 0);
        prefix = header.subarray(0, read.bytesRead);
        imageRequest = !canStreamAssetOriginal(originalMime, prefix);
        if (imageRequest) {
          await originalFile.close();
          originalFile = undefined;
        }
      }
      let responsePath = resolved;
      let mime = originalMime;
      if (imageRequest) {
        const widths = url.searchParams.getAll('w');
        const rotations = url.searchParams.getAll('rotate');
        const flips = url.searchParams.getAll('flip');
        const width = widths.length ? Number(widths[0]) : undefined;
        if (widths.length > 1 || (widths.length === 1 && (!/^[0-9]+$/.test(widths[0]) || !Number.isSafeInteger(width) || (width as number) < 1 || (width as number) > 720))) return error('Invalid thumbnail width', 400);
        if (rotations.length > 1 || (rotations.length && !['0', '90', '180', '270'].includes(rotations[0])) || flips.length > 1 || (flips.length && !['0', '1'].includes(flips[0]))) return error('Invalid image transform', 400);
        const image = await getPreparedImage(resolved, {
          kind: width ? 'thumbnail' : 'preview',
          ...(width ? { width } : {}),
          rotation: Number(rotations[0] ?? 0) as 0 | 90 | 180 | 270,
          flipped: flips[0] === '1',
        });
        if (!image) return error('Image unavailable', 422);
        responsePath = image.path;
        mime = image.mime;
      }
      const stat = originalFile ? await originalFile.stat() : await fs.promises.stat(responsePath);
      if (!stat.isFile()) return error('Not found', 404);
      const range = parseAssetByteRange(request.headers.get('range'), stat.size);
      const headers: Record<string, string> = {
        ...assetSecurityHeaders(),
        'content-type': mime,
        'cache-control': imageRequest ? 'no-cache' : 'public, max-age=31536000, immutable',
        'accept-ranges': 'bytes',
      };
      if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}` } });
      const start = range?.start ?? 0;
      const end = range?.end ?? stat.size - 1;
      headers['content-length'] = String(Math.max(0, end - start + 1));
      if (range) headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
      let body: ReadableStream | null = null;
      if (request.method !== 'HEAD' && stat.size > 0) {
        if (originalFile) {
          const file = originalFile;
          // 判定した先頭 bytes をそのまま送る。同じファイルの書き換えでも画像へ差し替わらない。
          const stream = Readable.from(
            (async function* () {
              try {
                if (start < prefix.length) yield prefix.subarray(start, Math.min(prefix.length, end + 1));
                const remainingStart = Math.max(start, prefix.length);
                if (remainingStart <= end) yield* file.createReadStream({ start: remainingStart, end, autoClose: false });
              } finally {
                await file.close();
              }
            })(),
          );
          stream.once('close', () => {
            void file.close().catch(() => {});
          });
          body = Readable.toWeb(stream) as ReadableStream;
          originalFile = undefined;
        } else body = Readable.toWeb(fs.createReadStream(responsePath, { start, end })) as ReadableStream;
      }
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch {
      return error('Error', 500);
    } finally {
      await originalFile?.close().catch(() => {});
    }
  });
}
