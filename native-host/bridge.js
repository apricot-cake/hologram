'use strict';

// Corpus native messaging host.
//
// Chrome spawns this process per connection (chrome.runtime.connectNative).
// It receives a captured post over stdin and writes two files into the user's
// save folder:
//   <captureId>.jpg   the cropped JPEG (no EXIF)
//   <captureId>.json  the sidecar metadata
//
// Files are write-once: the bridge never mutates existing files, so concurrent
// captures cannot corrupt a shared file. The desktop app is the sole owner of
// deletes/edits/index. The bridge works even when the app is not running.

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const { configDir, defaultLibraryDir } = require('./paths');

// --- Diagnostic log -----------------------------------------------------------
// Chrome spawns this process once per native-messaging connection, so a line
// here PROVES the host was found in the registry and launched. If Chrome reports
// "native messaging host not found" and this log gets NO new lines, the failure
// is in Chrome's manifest lookup (before launch), not in the bridge. Best-effort;
// must never throw (a logging error must not break a capture).
function logLine(msg) {
  try {
    fs.appendFileSync(
      path.join(configDir(), 'bridge.log'),
      `${new Date().toISOString()} [pid ${process.pid}] ${msg}\n`
    );
  } catch { /* ignore — logging is non-essential */ }
}

// --- Save folder resolution (shared config with the desktop app) ---
// MUST stay in lockstep with the app's getSaveFolder(): explicit config wins,
// otherwise both fall back to the SAME shared default (defaultLibraryDir).
function readSaveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) {
      return cfg.saveFolder;
    }
  } catch {
    // No config yet — fall back to the shared default.
  }
  return defaultLibraryDir();
}

// --- Native messaging framing (4-byte LE length prefix + UTF-8 JSON) ---
function sendMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  try {
    process.stdout.write(Buffer.concat([header, json]));
  } catch {
    // stdout closed — nothing we can do.
  }
}

// captureId is "<epochMillis>-<hex>". Reject anything else so it can never
// escape the save folder via path separators or "..".
const SAFE_ID = /^[0-9]{1,20}-[0-9a-f]{1,8}$/i;

function sanitizeCaptureId(id) {
  return (typeof id === 'string' && SAFE_ID.test(id)) ? id : null;
}

function uniqueBase(dir, captureId) {
  if (!fs.existsSync(path.join(dir, `${captureId}.jpg`)) &&
      !fs.existsSync(path.join(dir, `${captureId}.json`))) {
    return captureId;
  }
  let n = 1;
  // Extremely unlikely (captureId already carries a timestamp + random), but
  // guarantee uniqueness rather than overwrite.
  while (fs.existsSync(path.join(dir, `${captureId}-${n}.jpg`)) ||
         fs.existsSync(path.join(dir, `${captureId}-${n}.json`))) {
    n += 1;
  }
  return `${captureId}-${n}`;
}

// --- Original-media download (best-effort, still images only) ---
// Supported still-image content types -> file extension. Anything else (video,
// svg, avif, html error pages, ...) is skipped rather than saved.
const MEDIA_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
};
const MAX_MEDIA = 12;                       // cap attachments per post
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;   // skip anything larger
const MEDIA_TIMEOUT_MS = 12000;             // per-image abort
const MAX_MEDIA_REDIRECTS = 4;              // bound redirect chains

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
function isPrivateIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const o = parts.map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true;       // this-network / RFC1918 / loopback
  if (a === 169 && b === 254) return true;                 // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;        // RFC1918
  if (a === 192 && b === 168) return true;                 // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT (RFC6598)
  if (a === 192 && b === 0 && o[2] === 0) return true;     // IETF protocol assignments
  if (a >= 224) return true;                               // multicast + reserved (224-255)
  return false;
}
function isPrivateIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return isPrivateIPv4(ip);
  if (fam === 6) {
    const lc = ip.toLowerCase();
    if (lc === '::1' || lc === '::') return true;                       // loopback / unspecified
    const mapped = lc.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);       // ::ffff:a.b.c.d / ::a.b.c.d
    if (mapped) return isPrivateIPv4(mapped[1]);
    if (/^f[cd][0-9a-f]{2}:/.test(lc)) return true;                     // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(lc)) return true;                     // fe80::/10 link-local
    if (lc.startsWith('ff')) return true;                              // ff00::/8 multicast
    return false;
  }
  return false; // not an IP literal
}
// Validate one URL: https + (if an IP literal) a public range + not an obvious
// local hostname. Returns the parsed URL on success, or null.
function checkMediaUrl(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');   // strip IPv6 brackets so net.isIP sees the literal
  if (net.isIP(host)) return isPrivateIp(host) ? null : u;
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') ||
      lower.endsWith('.local') || lower.endsWith('.internal')) return null;
  return u;
}

// Read a response body with a hard byte cap, streaming so an over-cap or
// content-length-lying body is aborted mid-flight instead of buffered whole.
async function readCappedBody(res, cap, ctrl) {
  const body = res.body;
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        try { ctrl.abort(); } catch { /* ignore */ }
        try { await reader.cancel(); } catch { /* ignore */ }
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
async function fetchStillImage(url, referer) {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return null;
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MEDIA_TIMEOUT_MS);
  try {
    const headers = (typeof referer === 'string' && /^https:\/\//i.test(referer))
      ? { Referer: referer }
      : undefined;
    let current = url;
    let res = null;
    for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
      if (!checkMediaUrl(current)) return null;   // SSRF guard, every hop
      res = await fetch(current, { signal: ctrl.signal, redirect: 'manual', headers });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) return null;
        try { current = new URL(loc, current).href; } catch { return null; }
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
async function downloadOneMedia(entry, dir, base, i) {
  if (!entry) return null;
  const got = await fetchStillImage(entry.url, entry.referer);
  if (!got) return null;
  const file = `${base}-media-${i}.${got.ext}`;
  fs.writeFileSync(path.join(dir, file), got.buf);
  return {
    url: entry.url,
    alt: entry.alt != null ? String(entry.alt) : null,
    width: Number.isFinite(entry.width) ? entry.width : null,
    height: Number.isFinite(entry.height) ? entry.height : null,
    file
  };
}

async function downloadMedia(mediaList, dir, base) {
  if (!Array.isArray(mediaList) || !mediaList.length) return [];
  const list = mediaList.slice(0, MAX_MEDIA);
  const settled = await Promise.allSettled(list.map((m, i) => downloadOneMedia(m, dir, base, i)));
  return settled.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
}

// Download the author avatar to <base>-avatar.<ext> so the viewer can show it
// offline (no external fetch at display time). pixiv passes a Referer because
// i.pximg.net 403s without one. Returns the filename or null; like media, a
// failure here never fails the save.
async function downloadAvatar(avatar, referer, dir, base) {
  if (typeof avatar !== 'string' || !avatar) return null;
  const got = await fetchStillImage(avatar, referer);
  if (!got) return null;
  const file = `${base}-avatar.${got.ext}`;
  fs.writeFileSync(path.join(dir, file), got.buf);
  return file;
}

async function handleSave(msg) {
  const captureId = sanitizeCaptureId(msg.captureId);
  if (!captureId) throw new Error('Invalid captureId');
  if (typeof msg.image !== 'string' || !msg.image) throw new Error('Missing image data');

  const saveFolder = readSaveFolder();
  fs.mkdirSync(saveFolder, { recursive: true });

  const base = uniqueBase(saveFolder, captureId);
  const jpgPath = path.join(saveFolder, `${base}.jpg`);
  const jsonPath = path.join(saveFolder, `${base}.json`);

  // base64 decoding is lenient (it silently drops invalid chars), so a corrupt
  // payload would otherwise be written as a broken .jpg with ok:true. Validate
  // the JPEG SOI marker (FF D8 FF) and fail loudly before writing anything; the
  // throw is caught upstream and returned as { ok:false, error }, leaving no
  // orphaned files (the sidecar .json is written only after the image).
  const img = Buffer.from(msg.image, 'base64');
  if (img.length < 3 || img[0] !== 0xFF || img[1] !== 0xD8 || img[2] !== 0xFF) {
    throw new Error('Invalid image data (not a JPEG)');
  }
  fs.writeFileSync(jpgPath, img);

  const meta = msg.metadata || {};
  // Best-effort original-media download. A failure here must NEVER fail the save:
  // the screenshot + sidecar are the primary artifacts. The sidecar is written
  // LAST so media[].file reflects exactly what landed on disk.
  let savedMedia = [];
  try {
    savedMedia = await downloadMedia(meta.media, saveFolder, base);
  } catch {
    savedMedia = [];
  }

  // Author avatar: same best-effort contract as media — a failure leaves
  // avatarFile null (the viewer hides it) and never fails the save.
  let avatarFile = null;
  try {
    avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder, base);
  } catch {
    avatarFile = null;
  }

  const record = Object.assign({}, meta, {
    captureId: base,
    image: `${base}.jpg`,
    media: savedMedia,
    avatarFile
  });
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2), 'utf8');

  return { ok: true, file: `${base}.jpg`, saveFolder, mediaCount: savedMedia.length };
}

// Image-drag save: no screenshot. The bridge downloads the dragged illustration
// itself (any supported still type, with an optional pixiv Referer) and that file
// IS the record's primary image. media[] is left empty (the image is the content;
// duplicating it in media[] would double it in the viewer's lightbox). This is the
// same "illustration record" shape an imported library item produces. captureId is the
// normal epochMillis-hex form, so it passes SAFE_ID.
async function handleSaveDragged(msg) {
  const captureId = sanitizeCaptureId(msg.captureId);
  if (!captureId) throw new Error('Invalid captureId');
  if (typeof msg.imageUrl !== 'string' || !msg.imageUrl) throw new Error('Missing image URL');

  const saveFolder = readSaveFolder();
  fs.mkdirSync(saveFolder, { recursive: true });
  const base = uniqueBase(saveFolder, captureId);

  const got = await fetchStillImage(msg.imageUrl, msg.imageReferer);
  if (!got) throw new Error('Image download failed (unsupported type, too large, or network error)');
  const imageFile = `${base}.${got.ext}`;
  fs.writeFileSync(path.join(saveFolder, imageFile), got.buf);

  const meta = msg.metadata || {};
  let avatarFile = null;
  try {
    avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder, base);
  } catch {
    avatarFile = null;
  }
  // source:'drag' marks the image as the artwork itself (not a post screenshot),
  // so the image-view shows it. Mirrors the migrated records' source marker.
  const record = Object.assign({}, meta, { captureId: base, image: imageFile, media: [], source: 'drag', avatarFile });
  fs.writeFileSync(path.join(saveFolder, `${base}.json`), JSON.stringify(record, null, 2), 'utf8');

  return { ok: true, file: imageFile, saveFolder };
}

// --- stdin reader: buffer bytes and process complete messages ---
// Only act as a real native-messaging host when executed directly. When this
// module is require()'d (by a test), skip the reader and expose internals.
if (require.main === module) {
logLine(`launched argv=${JSON.stringify(process.argv.slice(2))} saveFolder=${readSaveFolder()}`);
let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const body = buffer.subarray(4, 4 + len);
    buffer = buffer.subarray(4 + len);

    let msg;
    try {
      msg = JSON.parse(body.toString('utf8'));
    } catch {
      logLine('recv: invalid JSON');
      sendMessage({ ok: false, error: 'Invalid JSON message' });
      continue;
    }

    logLine(`recv type=${msg && msg.type}`);
    try {
      if (msg.type === 'save') {
        // async (downloads original media) — ack is sent once it settles. The
        // process drains naturally so the pending fetch keeps it alive.
        handleSave(msg).then(sendMessage).catch((err) => sendMessage({ ok: false, error: err.message }));
      } else if (msg.type === 'saveDragged') {
        handleSaveDragged(msg).then(sendMessage).catch((err) => sendMessage({ ok: false, error: err.message }));
      } else if (msg.type === 'ping') {
        sendMessage({ ok: true, pong: true });
      } else {
        sendMessage({ ok: false, error: `Unknown message type: ${msg.type}` });
      }
    } catch (err) {
      sendMessage({ ok: false, error: err.message });
    }
  }
});
}

// When Chrome closes the port, stdin ends. We let the event loop drain
// naturally rather than calling process.exit(), so any pending stdout write
// (the ack) is flushed before the process terminates.

module.exports = { handleSave, handleSaveDragged, downloadMedia, downloadAvatar, fetchStillImage };
