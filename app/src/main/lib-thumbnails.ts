'use strict';

// The asset:// scheme and the thumbnail cache behind it (#227) — index.ts's
// `// --- Image protocol ---` block, moved out whole. One module because the
// cache exists only to serve this handler: `?w=N` is the only thing that
// generates a thumbnail, and the mime table is the only thing that decides what
// the un-resized response says it is.
//
// The save-folder containment check is NOT here. resolveInFolder stays with the
// other file helpers in index.ts (it is the rule every file handler shares, not
// this handler's own), so registerImageProtocol takes it as a dependency rather
// than reaching back for it.

import { protocol, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { configDir } from './native-host.ts';
import { getSaveFolder } from './lib-config.ts';
import { assetSecurityHeaders } from './asset-headers.ts';

/** What registerImageProtocol needs from the assembly. */
export interface ImageProtocolDeps {
  /** Resolves a name INSIDE the save folder, or null if it would escape it. */
  resolveInFolder(name: string): string | null;
}

// Screenshots are JPEG; downloaded original media may be png/webp/gif.
const EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.zip': 'application/zip', // pixiv うごイラ archive (#119 St3) — read by main and handed to the player over IPC, never rendered
};
function mimeForFile(name) {
  return EXT_MIME[path.extname(name || '').toLowerCase()] || 'application/octet-stream';
}

// Thumbnails: the image-view tile grid downscaled full-resolution originals
// (multi-MB pixiv/X art) into ~180px cells, which made scrolling stutter as the
// GPU decoded every full image. Instead serve a resized JPEG via asset://…?w=N,
// generated once with Electron's built-in nativeImage and cached on disk
// (keyed by name + mtime + width, so re-migration invalidates it). The
// full-resolution original is still served when no ?w= is given (lightbox/viewer).
const THUMB_EXT = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.webp', '.gif', '.avif', '.svg']);
// thumb-cache sits in configDir, not the save folder, for the same "local, not
// portable with the library" reason hologram.db does (index.ts's Posts comment).
function thumbCacheDir() {
  return path.join(configDir(), 'thumb-cache');
}

// nativeImage decode/resize/toJPEG is synchronous and runs on the main process's
// single JS thread. The tile grid fires many asset?w= requests at once when first
// scrolling into uncached cells; left unbounded they execute back-to-back as one
// long synchronous burst that starves every other IPC/UI message (first-scroll
// stutter). Funnel the heavy generation through a small pool that yields to the
// event loop (setImmediate) between jobs so the main thread keeps breathing, and
// coalesce concurrent identical requests so each tile is decoded at most once.
const THUMB_POOL = 2;
let _thumbRunning = 0;
const _thumbQueue: any[] = [];
const _thumbInflight = new Map(); // cachePath -> Promise<Buffer|null>
function _pumpThumbs() {
  while (_thumbRunning < THUMB_POOL && _thumbQueue.length) {
    const job = _thumbQueue.shift();
    _thumbRunning++;
    setImmediate(async () => {
      try {
        job.resolve(await job.fn());
      } catch {
        job.resolve(null);
      } finally {
        _thumbRunning--;
        _pumpThumbs();
      }
    });
  }
}
function runThumbJob(fn) {
  return new Promise((resolve) => {
    _thumbQueue.push({ fn, resolve });
    _pumpThumbs();
  });
}

async function getThumbnail(resolved, name, w) {
  if (!THUMB_EXT.has(path.extname(name).toLowerCase())) return null;
  let st: any;
  try {
    st = await fs.promises.stat(resolved);
  } catch {
    return null;
  }
  // q3: resize by the SHORT edge (not width). Tiles are square + object-fit:cover, so the
  // short edge is what maps to the tile. Resizing by width made wide images (e.g. 1920x1080)
  // become 180x101, which then got upscaled vertically into the square tile → heavy blur.
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q3.jpg`.replace(/[^\w.-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try {
    return await fs.promises.readFile(cachePath);
  } catch {
    /* cache miss */
  }
  // Coalesce: if this exact tile is already being generated, await that one job
  // instead of starting a duplicate decode (a full grid rebuild re-requests still-
  // visible tiles while the first decode is in flight).
  const pending = _thumbInflight.get(cachePath);
  if (pending) return pending;
  const job = runThumbJob(() => {
    let img = nativeImage.createFromPath(resolved);
    if (img.isEmpty()) return null;
    const sz = img.getSize();
    if (Math.min(sz.width, sz.height) > w) {
      img = sz.width >= sz.height ? img.resize({ height: w, quality: 'good' }) : img.resize({ width: w, quality: 'good' });
    }
    const buf = img.toJPEG(90);
    fs.promises
      .mkdir(thumbCacheDir(), { recursive: true })
      .then(() => fs.promises.writeFile(cachePath, buf))
      .catch(() => {
        /* cache best-effort */
      });
    return buf;
  });
  _thumbInflight.set(cachePath, job);
  try {
    return await job;
  } finally {
    _thumbInflight.delete(cachePath);
  }
}

function registerImageProtocol({ resolveInFolder }: ImageProtocolDeps) {
  protocol.handle('asset', async (request) => {
    try {
      const folder = getSaveFolder();
      if (!folder) return new Response('No save folder', { status: 404 });

      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      if (!rel || rel === '.' || rel === '..') return new Response('Not found', { status: 404 });

      // Same containment rule as every file handler: basenames only, plus the
      // sanctioned single-level subpaths 'avatars/<file>' (shared avatar store)
      // and '.trash/<file>' (soft-deleted captures the trash view still draws,
      // #267). resolveInFolder asserts the resolved path lands strictly INSIDE
      // the save folder and directly under the directory the name asked for.
      const resolved = resolveInFolder(rel);
      if (!resolved) return new Response('Forbidden', { status: 403 });
      const name = path.basename(resolved);

      const w = Number.parseInt(url.searchParams.get('w') || '', 10);
      if (Number.isFinite(w) && w >= 64 && w <= 720) {
        const thumb = await getThumbnail(resolved, name, w);
        // Cache-key includes mtime+width, and capture filenames are content-stable
        // (unique captureId, written once) → immutable lets Chromium keep the
        // decoded bitmap and skip re-reads/re-decodes on scroll-back.
        if (thumb) return new Response(thumb, { headers: { ...assetSecurityHeaders(), 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
        // fall through to the original if thumbnailing failed
      }

      const data = await fs.promises.readFile(resolved);
      return new Response(data, { headers: { ...assetSecurityHeaders(), 'content-type': mimeForFile(name), 'cache-control': 'public, max-age=31536000, immutable' } });
    } catch {
      return new Response('Error', { status: 500 });
    }
  });
}

export { mimeForFile, registerImageProtocol };
