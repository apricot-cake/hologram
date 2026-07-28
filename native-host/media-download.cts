'use strict';

// Shared best-effort media downloader (original media + author avatars).
//
// Extracted from the bridge so the SAME SSRF guard, size/time caps, save-wide
// byte budget, and manual redirect handling are reused by every path that pulls
// remote images into the library:
//   - native-host/bridge.cts          (capture / drag save)
//   - app/src/main/index.ts                    (import-posts)
//   - scripts/backfill-metadata.cts   (backfill + existing-data avatar fill)
// Keeping it in ONE place means the security-sensitive guard never drifts apart
// between callers. Every function here is best-effort: a failure returns null and
// is the caller's cue to drop that file — it must never throw the save/import.

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const dns = require('node:dns');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { Agent, setGlobalDispatcher } = require('undici');

// --- Original-media download (best-effort) ---
// Supported still-image content types -> file extension. Anything else (svg,
// avif, html error pages, ...) is skipped rather than saved. Kept separate from
// VIDEO_MIME_EXT below (also used for the avatar-extension probe, which is
// never a video).
const MEDIA_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
// Supported video content types (#119 St1: X / Misskey / Mastodon direct URLs).
const VIDEO_MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
const MAX_MEDIA = 12; // cap attachments per post
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // skip anything larger (still images)
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // videos run far bigger than photos
// Byte budget for ONE save operation, on top of the per-file caps (#389). Those
// caps bound a single response, not the click: 12 attachments at the video cap
// is ~2.4GB of network and disk driven by one save. 512MB clears every shape our
// own caps allow (12 stills = 300MB; video + poster = 225MB), so no legitimate
// post is refused, and matches the largest single file any supported platform
// accepts (X video, 512MB) — a save that wants more is not a real post.
const MAX_SAVE_BYTES = 512 * 1024 * 1024;
// Attachments in flight at once. Bodies stream to disk, so memory no longer
// scales with this number; 2 keeps a multi-image post from serializing into a
// wait as long as the sum of its downloads.
const MEDIA_CONCURRENCY = 2;
const MEDIA_TIMEOUT_MS = 12000; // per-image abort
const VIDEO_TIMEOUT_MS = 60000; // videos take longer to pull down than a still
const MAX_MEDIA_REDIRECTS = 4; // bound redirect chains

interface MediaEntry {
  url: string;
  referer?: string;
  alt?: string | null;
  width?: number | null;
  height?: number | null;
  // Omitted (legacy shape / Bluesky / pixiv, all still-image-only today) means
  // 'image'. video/gif entries additionally carry `poster` (#119 St1).
  type?: 'image' | 'video' | 'gif';
  poster?: string | null;
}
interface MediaDescriptor {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  type?: string;
  posterFile?: string;
}
// What a download leaves behind: the folder-relative file name it committed and
// the extension the response's content-type resolved to.
interface SavedFile {
  file: string;
  ext: string;
}
// Per-response caps. Bundled so the shared fetch serves stills and video without
// each call site restating three arguments in the right order.
interface FetchLimits {
  mimeExt: Record<string, string>;
  maxBytes: number;
  timeoutMs: number;
}
const STILL_LIMITS: FetchLimits = { mimeExt: MEDIA_MIME_EXT, maxBytes: MAX_MEDIA_BYTES, timeoutMs: MEDIA_TIMEOUT_MS };
const VIDEO_LIMITS: FetchLimits = { mimeExt: VIDEO_MIME_EXT, maxBytes: MAX_VIDEO_BYTES, timeoutMs: VIDEO_TIMEOUT_MS };

// --- Whole-save byte budget (#389) ---------------------------------------------
// One budget per save operation, shared by every download it makes (media,
// poster frames, avatar). Bytes are counted as they ARRIVE — including the bytes
// of a transfer that later fails — because those were already paid for in
// network and disk. Blowing the budget aborts the in-flight fetches through
// `signal` and stops any further one from starting.
interface ByteBudget {
  readonly signal: AbortSignal;
  readonly blown: boolean;
  remaining(): number;
  take(bytes: number): boolean;
}
function createByteBudget(total: number = MAX_SAVE_BYTES): ByteBudget {
  const ctrl = new AbortController();
  let spent = 0;
  return {
    get signal() {
      return ctrl.signal;
    },
    get blown() {
      return spent >= total;
    },
    remaining: () => Math.max(0, total - spent),
    take(bytes: number) {
      spent += bytes;
      if (spent > total) {
        ctrl.abort();
        return false;
      }
      return true;
    },
  };
}

// --- SSRF guard ----------------------------------------------------------------
// The media URLs come from the page / a (possibly hostile) Misskey/Mastodon
// instance, so a crafted URL could point the downloader at internal resources
// (cloud metadata 169.254.169.254, loopback, RFC1918). This is BLIND SSRF (the
// fetched bytes are written to the user's disk, never returned to the attacker)
// and we already require https, but we still refuse private/reserved targets and
// re-check every redirect hop. IP literals and obvious local hostnames are
// rejected before fetch. Hostnames are resolved by the guarded dispatcher below:
// every A/AAAA result must be public, then Node connects only to that verified
// result set. This closes DNS rebinding without a check-then-resolve gap.
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

// Replace the connector's normal DNS lookup with an all-address guard. Returning
// the verified records to net.connect (with autoSelectFamily enabled below)
// preserves A/AAAA fallback while pinning the connection to this exact set.
function createGuardedLookup(resolveAll = dns.lookup) {
  return (hostname, options, callback) => {
    resolveAll(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) {
        callback(err);
        return;
      }
      if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some(({ address }) => !net.isIP(address) || isPrivateIp(address))) {
        const refused = new Error(`DNS resolution refused for ${hostname}`) as NodeJS.ErrnoException;
        refused.code = 'EHOSTUNREACH';
        callback(refused);
        return;
      }
      callback(null, addresses);
    });
  };
}

const MEDIA_DISPATCHER = new Agent({
  connect: {
    lookup: createGuardedLookup(),
    autoSelectFamily: true,
  },
});
// Node's global fetch dispatches through its own internally-bundled (older)
// undici. Passing MEDIA_DISPATCHER as a per-request `dispatcher` option makes
// that internal fetch build a Request with this (newer, v8+) undici's Request
// class, which rejects the handler as missing v2-only methods ("invalid
// onRequestStart method") before the connector — and createGuardedLookup —
// ever run. Registering it as the process-wide default instead sidesteps
// that handler-shape check entirely, so it must stay off the per-call
// `request` options below.
setGlobalDispatcher(MEDIA_DISPATCHER);

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

// Write a response body into `tmpPath`, enforcing the per-file cap AND the save
// budget on the bytes that ACTUALLY arrive. Content-Length already gave us an
// early exit, but it is attacker-controlled: a chunked body, an under-declared
// one, or one that simply never stops is cut here, mid-flight, with only the
// current chunk in memory. Returns the byte count written, or null if a cap was
// hit or the transfer broke — the caller removes the temp file either way.
async function streamToFile(res: Response, cap: number, budget: ByteBudget, tmpPath: string): Promise<number | null> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') return null;
  const reader = body.getReader();
  // 'wx' so a name collision fails instead of overwriting another save's
  // in-progress file. The error listener is attached in the same tick as the
  // stream: an open failure ('EEXIST', a read-only folder) is emitted
  // asynchronously and would otherwise be an unhandled 'error' event.
  const out = fs.createWriteStream(tmpPath, { flags: 'wx' });
  const failed = new Promise<never>((_, reject) => out.once('error', reject));
  failed.catch(() => {}); // nobody may end up awaiting it
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap || !budget.take(value.length)) return null;
      if (!out.write(Buffer.from(value))) await Promise.race([once(out, 'drain'), failed]);
    }
    out.end();
    // 'close', not 'finish': Windows refuses to rename or delete a file whose
    // handle is still open, and the caller does exactly that next.
    await Promise.race([once(out, 'close'), failed]);
    return total;
  } catch {
    return null; // disconnect mid-body / abort / write failure
  } finally {
    reader.cancel().catch(() => {}); // no-op once the body is drained
    if (!out.destroyed) out.destroy();
    if (!out.closed) await once(out, 'close').catch(() => {}); // see above
  }
}

// Fetch one media file straight to disk and return its folder-relative name, or
// null on any failure. `stem` is that name WITHOUT the extension, which is only
// known once the response's content-type arrives. pixiv originals on i.pximg.net
// 403 without a pixiv Referer; callers pass a referer for those. Other hosts omit
// it. Redirects are followed manually so every hop is re-validated against the
// SSRF guard.
//
// The body streams into a sibling temp file and is committed with a rename, so a
// download that fails at ANY point (unsupported type, per-file cap, save budget,
// redirect, disconnect, timeout) leaves behind neither a finished-looking file
// nor a temp one. Same directory as the target on purpose: a rename is only
// atomic within one filesystem.
async function downloadToFile(url: unknown, referer: unknown, limits: FetchLimits, dir: string, stem: string, budget: ByteBudget): Promise<SavedFile | null> {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return null;
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;
  if (budget.blown) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), limits.timeoutMs);
  let tmpPath = ''; // set once we have a name to clean up
  let committed = false;
  try {
    const headers = typeof referer === 'string' && /^https:\/\//i.test(referer) ? { Referer: referer } : undefined;
    // Blowing the budget aborts every download of this save, not just the one
    // that overran it.
    const signal = AbortSignal.any([ctrl.signal, budget.signal]);
    let current = url;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
      if (!checkMediaUrl(current)) return null; // SSRF guard, every hop
      const request = { signal, redirect: 'manual' as const, headers };
      res = await fetch(current, request);
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
    const ext = limits.mimeExt[ct];
    if (!ext) return null; // not a supported type
    // Content-Length is a hint, never a guarantee: an honest server saves us the
    // whole transfer here, a lying one is stopped by the byte counter above.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && (declared > limits.maxBytes || declared > budget.remaining())) return null;
    const file = `${stem}.${ext}`;
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    tmpPath = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    const bytes = await streamToFile(res, limits.maxBytes, budget, tmpPath);
    if (!bytes) return null; // capped, broken, or an empty body
    fs.renameSync(tmpPath, target); // commit point
    committed = true;
    return { file, ext };
  } catch {
    return null; // network/abort/parse failure
  } finally {
    clearTimeout(timer);
    if (!committed) {
      ctrl.abort(); // release the socket of a body we are walking away from
      if (tmpPath) {
        try {
          fs.rmSync(tmpPath, { force: true });
        } catch {
          /* best-effort cleanup of the orphaned temp file */
        }
      }
    }
  }
}

// Download one still image to <dir>/<stem>.<ext> (the drag-save's own artwork,
// avatars). Callers that save a whole post go through downloadMedia instead.
async function saveStillImage(url: unknown, referer: unknown, dir: string, stem: string, budget: ByteBudget = createByteBudget()): Promise<SavedFile | null> {
  return downloadToFile(url, referer, STILL_LIMITS, dir, stem, budget);
}

function descriptorOf(entry: MediaEntry, file: string): MediaDescriptor {
  return {
    url: entry.url,
    alt: entry.alt != null ? String(entry.alt) : null,
    width: typeof entry.width === 'number' && Number.isFinite(entry.width) ? entry.width : null,
    height: typeof entry.height === 'number' && Number.isFinite(entry.height) ? entry.height : null,
    file,
  };
}

// Download one media item. Still images go to <base>-media-<i>.<ext> as
// before. video/gif entries ALSO fetch the poster frame (if the platform gave
// one) to <base>-poster.<ext> — unindexed, because X/Misskey/Mastodon carry at
// most one video per post — before attempting the video itself, so a poster
// lands even if the video download fails. If the video is unsupported/too
// large/network-fails, the item downgrades to a still (posterFile becomes its
// `file`, `type` stays unset) instead of vanishing entirely — only a true
// double failure (no poster AND no video) drops the item, same as an
// unfetchable photo. Returns null on that full failure (caller drops it).
async function downloadOneMedia(entry: MediaEntry | null | undefined, dir: string, base: string, i: number, budget: ByteBudget = createByteBudget()): Promise<MediaDescriptor | null> {
  if (!entry) return null;
  const isVideo = entry.type === 'video' || entry.type === 'gif';
  if (!isVideo) {
    const got = await downloadToFile(entry.url, entry.referer, STILL_LIMITS, dir, `${base}-media-${i}`, budget);
    return got ? descriptorOf(entry, got.file) : null;
  }

  let posterFile: string | undefined;
  if (typeof entry.poster === 'string' && entry.poster) {
    const posterGot = await downloadToFile(entry.poster, entry.referer, STILL_LIMITS, dir, `${base}-poster`, budget);
    if (posterGot) posterFile = posterGot.file;
  }

  const got = await downloadToFile(entry.url, entry.referer, VIDEO_LIMITS, dir, `${base}-media-${i}`, budget);
  if (got) return { ...descriptorOf(entry, got.file), type: entry.type, posterFile };
  if (posterFile) return descriptorOf(entry, posterFile); // downgrade to a still
  return null;
}

// Download a post's attachments. `budget` is the save's shared byte budget —
// pass the SAME one to every download of that save (the avatar too) so the cap
// covers the operation and not each call.
//
// A fixed-size worker pool rather than one Promise per attachment: at most
// MEDIA_CONCURRENCY transfers are open at a time, so neither sockets, disk
// writes, nor buffered chunks scale with the attachment count (#389). Ordering
// survives because each worker writes to its own index.
async function downloadMedia(mediaList: unknown, dir: string, base: string, budget: ByteBudget = createByteBudget()): Promise<MediaDescriptor[]> {
  if (!Array.isArray(mediaList) || !mediaList.length) return [];
  const list: MediaEntry[] = mediaList.slice(0, MAX_MEDIA);
  const saved: (MediaDescriptor | null)[] = new Array(list.length).fill(null);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      // A blown budget stops the queue: whatever already landed is kept.
      if (i >= list.length || budget.blown) return;
      try {
        saved[i] = await downloadOneMedia(list[i], dir, base, i, budget);
      } catch {
        saved[i] = null; // one bad attachment never fails the save
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MEDIA_CONCURRENCY, list.length) }, worker));
  return saved.filter((v): v is MediaDescriptor => Boolean(v));
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
async function downloadAvatar(avatar: unknown, referer: unknown, dir: string, budget: ByteBudget = createByteBudget()): Promise<string | null> {
  if (typeof avatar !== 'string' || !avatar) return null;
  const hash = crypto.createHash('sha1').update(avatar).digest('hex').slice(0, 16);
  const sub = path.join(dir, AVATAR_SUBDIR);
  // The extension is only known from the response content-type, so probe every
  // supported one — a hit means this exact URL was already downloaded.
  for (const ext of new Set(Object.values(MEDIA_MIME_EXT))) {
    if (fs.existsSync(path.join(sub, `${hash}.${ext}`))) return `${AVATAR_SUBDIR}/${hash}.${ext}`;
  }
  // Forward-slash stem = the canonical sidecar form comes straight back out.
  const got = await saveStillImage(avatar, referer, dir, `${AVATAR_SUBDIR}/${hash}`, budget);
  return got ? got.file : null;
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
  saveStillImage,
  downloadOneMedia,
  downloadMedia,
  downloadAvatar,
  createByteBudget,
  AVATAR_SUBDIR,
  pixivRefererFor,
  checkMediaUrl,
  isPrivateIp,
  createGuardedLookup,
  MEDIA_MIME_EXT,
  VIDEO_MIME_EXT,
  MAX_MEDIA,
  MAX_MEDIA_BYTES,
  MAX_VIDEO_BYTES,
  MAX_SAVE_BYTES,
  MEDIA_CONCURRENCY,
  MEDIA_TIMEOUT_MS,
  VIDEO_TIMEOUT_MS,
};
