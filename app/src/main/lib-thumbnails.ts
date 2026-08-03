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

import { protocol, nativeImage, BrowserWindow } from 'electron';
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
// #8: nativeImage only documents PNG/JPEG (+ICO on Windows) — webp/avif decode
// as an empty image, which used to fall through to the un-resized original
// (see registerImageProtocol's "fall through" comment). These two route to
// getDelegatedThumbnail below instead; every other THUMB_EXT entry keeps the
// nativeImage path unchanged.
const DELEGATED_DECODE_EXT = new Set(['.webp', '.avif']);
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

// #8: renderer-delegated decode for the formats nativeImage can't read.
// Rather than relying on the OS's own installed codecs (unavailable for avif
// on most machines, per the issue's design comment) or a new wasm/native
// dependency (wasm-vips, rejected in the same comment), a hidden BrowserWindow
// asks Chromium itself to decode — the same engine already rendering these
// files in <img> tags elsewhere in the app — and hands back a flattened JPEG.
//
// win.webContents.executeJavaScript() does the whole "main -> IPC -> decode ->
// IPC -> main" round trip in one call (Electron ships this over its own
// internal CDP-like channel): no preload/contextBridge wiring is needed since
// nothing is exposed to page-authored script, only to code main itself injects.
let _decodeWin: BrowserWindow | null = null;
let _decodeWinIdleTimer: NodeJS.Timeout | null = null;
// THUMB_POOL runs up to 2 decode jobs concurrently — without this, two webp/
// avif requests arriving before the first window finishes its about:blank
// load would each see _decodeWin still null and stand up their own
// BrowserWindow, leaking whichever one loses the race (only the last one
// assigned to _decodeWin is ever reachable for disposal).
let _decodeWinCreating: Promise<BrowserWindow> | null = null;
// Reclaim the hidden window's GPU/compositor resources once nothing has asked
// it to decode for a while, rather than keeping it alive for the app's whole
// session. Distinct from (and not to be confused with, when reading GPU/memory
// traces) #66's separate idle-window observations.
const DECODE_WIN_IDLE_MS = 30_000;

async function getDecodeWindow(): Promise<BrowserWindow> {
  if (_decodeWinIdleTimer) {
    clearTimeout(_decodeWinIdleTimer);
    _decodeWinIdleTimer = null;
  }
  if (_decodeWin && !_decodeWin.isDestroyed()) return _decodeWin;
  if (!_decodeWinCreating) {
    _decodeWinCreating = (async () => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, offscreen: false },
      });
      await win.loadURL('about:blank');
      _decodeWin = win;
      return win;
    })();
  }
  try {
    return await _decodeWinCreating;
  } finally {
    _decodeWinCreating = null;
  }
}

function scheduleDecodeWinDispose() {
  if (_decodeWinIdleTimer) clearTimeout(_decodeWinIdleTimer);
  _decodeWinIdleTimer = setTimeout(() => {
    _decodeWinIdleTimer = null;
    const win = _decodeWin;
    _decodeWin = null;
    if (win && !win.isDestroyed()) win.destroy();
  }, DECODE_WIN_IDLE_MS);
}

// Resize-by-short-edge, same rule getThumbnail's nativeImage branch uses (q3
// comment below) — square tiles + object-fit:cover map the short edge to the
// tile, so that's the edge that must not exceed `w`.
function delegatedDecodeScript(b64: string, w: number): string {
  return `(async () => {
    try {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const shortEdge = Math.min(bitmap.width, bitmap.height);
      const scale = shortEdge > ${w} ? ${w} / shortEdge : 1;
      const dw = Math.max(1, Math.round(bitmap.width * scale));
      const dh = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(dw, dh);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, dw, dh);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  })()`;
}

async function getDelegatedThumbnail(resolved: string, w: number): Promise<Buffer | null> {
  let bytes: Buffer;
  try {
    bytes = await fs.promises.readFile(resolved);
  } catch {
    return null;
  }
  try {
    const win = await getDecodeWindow();
    const dataUrl = await win.webContents.executeJavaScript(delegatedDecodeScript(bytes.toString('base64'), w));
    scheduleDecodeWinDispose();
    if (typeof dataUrl !== 'string') return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    return Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } catch {
    scheduleDecodeWinDispose();
    return null; // decode failed (corrupt file, unsupported variant) — caller falls back to the original
  }
}

// #236 §4: a collected item (assetClass:'file' — pdf/zip/psd/…) has no
// THUMB_EXT decode path, but its OS very likely has a registered thumbnail
// handler for it already (Explorer/Finder show one). nativeImage.
// createThumbnailFromPath asks for exactly that — Electron 43, win32/darwin —
// so this is the second path getThumbnail tries instead of the plain "no
// thumbnail" null it returned before #236. Windows ignores requestedSize.height
// and derives it from width (the type's own doc note); passing {width:w,
// height:w} is still the right call, just not a promise about the result's
// aspect.
async function getOsShellThumbnail(resolved: string, w: number): Promise<Buffer | null> {
  try {
    const img = await nativeImage.createThumbnailFromPath(resolved, { width: w, height: w });
    if (img.isEmpty()) return null;
    return img.toJPEG(90);
  } catch {
    return null; // no handler registered for this format on this OS — not an error
  }
}

async function getThumbnail(resolved, name, w) {
  const ext = path.extname(name).toLowerCase();
  const isImageExt = THUMB_EXT.has(ext);
  const isDelegated = DELEGATED_DECODE_EXT.has(ext);
  let st: any;
  try {
    st = await fs.promises.stat(resolved);
  } catch {
    return null;
  }
  // q3: resize by the SHORT edge (not width). Tiles are square + object-fit:cover, so the
  // short edge is what maps to the tile. Resizing by width made wide images (e.g. 1920x1080)
  // become 180x101, which then got upscaled vertically into the square tile → heavy blur.
  // q4 (#8): generation bump — webp/avif used to cache a zero-byte NEGATIVE
  // sentinel under q3 (nativeImage couldn't decode either), which would
  // otherwise keep answering "no thumbnail" forever even after the delegated
  // decoder below can actually produce one.
  const key = `${name}.${Math.round(st.mtimeMs)}.w${w}.q4.jpg`.replace(/[^\w.-]/g, '_');
  const cachePath = path.join(thumbCacheDir(), key);
  try {
    const cached = await fs.promises.readFile(cachePath);
    // A cached NEGATIVE result (#236, extended by #8 to the delegated decode
    // path): generation was already tried once for this exact name+mtime+width
    // and produced nothing — an empty file is the sentinel, so a card that
    // never gets a thumbnail doesn't re-trigger the OS shell call or the
    // hidden-window decode on every scroll-back. Never meaningful for the
    // plain nativeImage path — a real image thumbnail is never zero bytes.
    return cached.length ? cached : null;
  } catch {
    /* cache miss */
  }
  // Coalesce: if this exact tile is already being generated, await that one job
  // instead of starting a duplicate decode (a full grid rebuild re-requests still-
  // visible tiles while the first decode is in flight).
  const pending = _thumbInflight.get(cachePath);
  if (pending) return pending;
  const job = runThumbJob(async () => {
    let buf: Buffer | null = null;
    if (isDelegated) {
      // #8: nativeImage can't decode webp/avif — Chromium itself can, via a
      // hidden renderer window (getDelegatedThumbnail above).
      buf = await getDelegatedThumbnail(resolved, w);
    } else if (isImageExt) {
      let img = nativeImage.createFromPath(resolved);
      if (!img.isEmpty()) {
        const sz = img.getSize();
        if (Math.min(sz.width, sz.height) > w) {
          img = sz.width >= sz.height ? img.resize({ height: w, quality: 'good' }) : img.resize({ width: w, quality: 'good' });
        }
        buf = img.toJPEG(90);
      }
    } else {
      // #236: not a format this handler decodes itself — ask the OS's own
      // registered thumbnail handler (Explorer/Finder's own source of truth
      // for what a .psd/.pdf/.zip/… "looks like").
      buf = await getOsShellThumbnail(resolved, w);
    }
    await fs.promises.mkdir(thumbCacheDir(), { recursive: true }).catch(() => {
      /* cache best-effort */
    });
    // buf===null caches as a zero-byte sentinel (see the read-side comment
    // above) rather than skipping the write — that's the whole point.
    await fs.promises.writeFile(cachePath, buf || Buffer.alloc(0)).catch(() => {
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
      // sanctioned single-level subpaths 'avatars/<file>' (shared avatar store),
      // 'emoji/<file>' (shared custom-emoji store, #290) and '.trash/<file>'
      // (soft-deleted captures the trash view still draws, #267).
      // resolveInFolder asserts the resolved path lands strictly INSIDE
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
