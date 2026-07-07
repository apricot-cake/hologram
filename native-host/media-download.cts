'use strict';

// Shared best-effort still-image downloader (original media + author avatars).
//
// Extracted from bridge.js so the SAME SSRF guard, size/time caps, and manual
// redirect handling are reused by every path that pulls remote images into the
// library:
//   - native-host/bridge.js          (capture / drag save)
//   - app/main.js                    (import-posts)
//   - scripts/backfill-metadata.js   (backfill + existing-data avatar fill)
// Keeping it in ONE place means the security-sensitive guard never drifts apart
// between callers. Every function here is best-effort: a failure returns null and
// is the caller's cue to drop that file — it must never throw the save/import.

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

// --- Original-media download (best-effort, still images only) ---
// Supported still-image content types -> file extension. Anything else (video,
// svg, avif, html error pages, ...) is skipped rather than saved.
const MEDIA_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_MEDIA = 12; // cap attachments per post
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // skip anything larger
const MEDIA_TIMEOUT_MS = 12000; // per-image abort
const MAX_MEDIA_REDIRECTS = 4; // bound redirect chains

interface MediaEntry {
  url: string;
  referer?: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
}
interface MediaDescriptor {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
}
interface StillImage {
  buf: Buffer;
  ext: string;
}

// --- SSRF guard ----------------------------------------------------------------
// The media URLs come from the page / a (possibly hostile) Misskey/Mastodon
// instance, so a crafted URL could point the downloader at internal resources
// (cloud metadata 169.254.169.254, loopback, RFC1918). This is BLIND SSRF (the
// fetched bytes are written to the user's disk, never returned to the attacker)
// and we already require https, but we still refuse private/reserved targets and
// re-check every redirect hop. We block IP-LITERAL targets by range (the direct
// and realistic vector — an attacker reaches metadata/loopback by its IP) plus
// obvious local hostnames. We deliberately do NOT resolve hostnames here: it
// would add per-fetch DNS latency and a rebinding TOCTOU gap (fetch re-resolves)
// without closing it, and the residual "attacker domain → private IP" path is a
// far higher bar for a blind, best-effort downloader.
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const o = parts.map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true; // this-network / RFC1918 / loopback
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a === 192 && b === 0 && o[2] === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast + reserved (224-255)
  return false;
}
function isPrivateIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) {
    const lc = ip.toLowerCase();
    if (lc === '::1' || lc === '::') return true; // loopback / unspecified
    const mapped = lc.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/); // ::ffff:a.b.c.d / ::a.b.c.d (dotted)
    if (mapped) return isPrivateIPv4(mapped[1]);
    // ::ffff:0:0/96 IPv4-mapped in HEX form. The WHATWG URL parser normalizes a
    // dotted mapped literal (e.g. ::ffff:127.0.0.1) to hex (::ffff:7f00:1), so
    // checkMediaUrl never sees the dotted form above — recover the embedded v4
    // from the low 32 bits and apply the same private-range check. Groups may be
    // 1-4 hex digits (leading zeros are dropped: 192.168.0.1 -> ::ffff:c0a8:1).
    const mapped6 = lc.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped6) {
      const hi = Number.parseInt(mapped6[1], 16);
      const lo = Number.parseInt(mapped6[2], 16);
      const v4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
      return isPrivateIPv4(v4);
    }
    if (/^f[cd][0-9a-f]{2}:/.test(lc)) return true; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(lc)) return true; // fe80::/10 link-local
    if (lc.startsWith('ff')) return true; // ff00::/8 multicast
    return false;
  }
  return false; // not an IP literal
}
// Validate one URL: https + (if an IP literal) a public range + not an obvious
// local hostname. Returns the parsed URL on success, or null.
function checkMediaUrl(urlStr: string): URL | null {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets so net.isIP sees the literal
  if (net.isIP(host)) return isPrivateIp(host) ? null : u;
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal')) return null;
  return u;
}

// Read a response body with a hard byte cap, streaming so an over-cap or
// content-length-lying body is aborted mid-flight instead of buffered whole.
async function readCappedBody(res: Response, cap: number, ctrl: AbortController): Promise<Buffer | null> {
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        try {
          ctrl.abort();
        } catch {
          /* ignore */
        }
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  // Fallback (no streamable body): buffer whole, then enforce the cap.
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > cap ? null : buf;
}

// Fetch one still image and return { buf, ext } on success, or null on any
// failure. pixiv originals on i.pximg.net 403 without a pixiv Referer; callers
// pass a referer for those. Other hosts omit it. Redirects are followed manually
// so every hop is re-validated against the SSRF guard.
async function fetchStillImage(url: unknown, referer?: unknown): Promise<StillImage | null> {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return null;
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MEDIA_TIMEOUT_MS);
  try {
    const headers = typeof referer === 'string' && /^https:\/\//i.test(referer) ? { Referer: referer } : undefined;
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
      if (!checkMediaUrl(current)) return null; // SSRF guard, every hop
      res = await fetch(current, { signal: ctrl.signal, redirect: 'manual', headers });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return null;
        try {
          current = new URL(loc, current).href;
        } catch {
          return null;
        }
        continue;
      }
      break;
    }
    if (!res || !res.ok) return null;
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = MEDIA_MIME_EXT[ct];
    if (!ext) return null; // not a supported still image
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) return null;
    const buf = await readCappedBody(res, MAX_MEDIA_BYTES, ctrl);
    if (!buf || !buf.length) return null;
    return { buf, ext };
  } catch {
    return null; // network/abort/parse failure
  } finally {
    clearTimeout(timer);
  }
}

// Download one still image to <base>-media-<i>.<ext>. Returns the post-download
// descriptor (with `file`) on success, or null on any failure (caller drops it).
async function downloadOneMedia(entry: MediaEntry | null | undefined, dir: string, base: string, i: number): Promise<MediaDescriptor | null> {
  if (!entry) return null;
  const got = await fetchStillImage(entry.url, entry.referer);
  if (!got) return null;
  const file = `${base}-media-${i}.${got.ext}`;
  fs.writeFileSync(path.join(dir, file), got.buf);
  return {
    url: entry.url,
    alt: entry.alt != null ? String(entry.alt) : null,
    width: typeof entry.width === 'number' && Number.isFinite(entry.width) ? entry.width : null,
    height: typeof entry.height === 'number' && Number.isFinite(entry.height) ? entry.height : null,
    file,
  };
}

async function downloadMedia(mediaList: unknown, dir: string, base: string): Promise<MediaDescriptor[]> {
  if (!Array.isArray(mediaList) || !mediaList.length) return [];
  const list: MediaEntry[] = mediaList.slice(0, MAX_MEDIA);
  const settled = await Promise.allSettled(list.map((m, i) => downloadOneMedia(m, dir, base, i)));
  return settled.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter((v): v is MediaDescriptor => Boolean(v));
}

// Download the author avatar into the shared store <dir>/avatars/ so the viewer
// can show it offline (no external fetch at display time). One file per avatar
// URL — NOT per capture: the legacy <captureId>-avatar.<ext> scheme wrote (and
// fetched) the same icon once per save, so authors saved often piled up dozens
// of identical copies. Avatar URLs on every supported platform are content-
// addressed (bsky CDN bafkrei… hashes, twimg profile_images ids, pximg dated
// paths), so "same URL = same pixels": files are keyed by a hash of the URL and
// an existing file skips both the fetch and the write. A changed avatar arrives
// under a new URL and lands as a new file; the superseded one stays behind only
// as the target of older sidecars (tiny — no GC).
// Returns the folder-relative path 'avatars/<hash>.<ext>' (forward slash = the
// canonical sidecar form) or null; like media, a failure never fails the save.
// Legacy sidecars keep their <captureId>-avatar.<ext> files untouched.
const AVATAR_SUBDIR = 'avatars';
async function downloadAvatar(avatar: unknown, referer: unknown, dir: string): Promise<string | null> {
  if (typeof avatar !== 'string' || !avatar) return null;
  const hash = crypto.createHash('sha1').update(avatar).digest('hex').slice(0, 16);
  const sub = path.join(dir, AVATAR_SUBDIR);
  // The extension is only known from the response content-type, so probe every
  // supported one — a hit means this exact URL was already downloaded.
  for (const ext of new Set(Object.values(MEDIA_MIME_EXT))) {
    if (fs.existsSync(path.join(sub, `${hash}.${ext}`))) return `${AVATAR_SUBDIR}/${hash}.${ext}`;
  }
  const got = await fetchStillImage(avatar, referer);
  if (!got) return null;
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, `${hash}.${got.ext}`), got.buf);
  return `${AVATAR_SUBDIR}/${hash}.${got.ext}`;
}

// pixiv avatars on i.pximg.net 403 without a pixiv Referer. When a caller has an
// avatar URL but no stored referer (legacy import data predates avatarReferer),
// derive it from the host so the download isn't rejected.
function pixivRefererFor(url: unknown): string | undefined {
  try {
    const h = new URL(url as string).hostname.toLowerCase();
    if (h === 'pximg.net' || h.endsWith('.pximg.net')) return 'https://www.pixiv.net/';
  } catch {
    /* not a parseable URL */
  }
  return undefined;
}

module.exports = {
  fetchStillImage,
  downloadOneMedia,
  downloadMedia,
  downloadAvatar,
  AVATAR_SUBDIR,
  pixivRefererFor,
  checkMediaUrl,
  isPrivateIp,
  MEDIA_MIME_EXT,
  MAX_MEDIA,
  MAX_MEDIA_BYTES,
  MEDIA_TIMEOUT_MS,
};
