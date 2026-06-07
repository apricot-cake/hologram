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

const { configDir } = require('./paths');

// --- Save folder resolution (shared config with the desktop app) ---
function readSaveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) {
      return cfg.saveFolder;
    }
  } catch {
    // No config yet — fall back to a sensible default.
  }
  return path.join(os.homedir(), 'Corpus');
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

// Download one still image to <base>-media-<i>.<ext>. Returns the post-download
// descriptor (with `file`) on success, or null on any failure (caller drops it).
async function downloadOneMedia(entry, dir, base, i) {
  if (!entry || typeof entry.url !== 'string' || !/^https:\/\//i.test(entry.url)) return null;
  if (typeof fetch !== 'function' || typeof AbortController !== 'function') return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MEDIA_TIMEOUT_MS);
  try {
    const res = await fetch(entry.url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = MEDIA_MIME_EXT[ct];
    if (!ext) return null; // not a supported still image
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_MEDIA_BYTES) return null;
    const file = `${base}-media-${i}.${ext}`;
    fs.writeFileSync(path.join(dir, file), buf);
    return {
      url: entry.url,
      alt: entry.alt != null ? String(entry.alt) : null,
      width: Number.isFinite(entry.width) ? entry.width : null,
      height: Number.isFinite(entry.height) ? entry.height : null,
      file
    };
  } catch {
    return null; // network/abort/parse failure — drop this entry
  } finally {
    clearTimeout(timer);
  }
}

async function downloadMedia(mediaList, dir, base) {
  if (!Array.isArray(mediaList) || !mediaList.length) return [];
  const list = mediaList.slice(0, MAX_MEDIA);
  const settled = await Promise.allSettled(list.map((m, i) => downloadOneMedia(m, dir, base, i)));
  return settled.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean);
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

  const record = Object.assign({}, meta, {
    captureId: base,
    image: `${base}.jpg`,
    media: savedMedia
  });
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2), 'utf8');

  return { ok: true, file: `${base}.jpg`, saveFolder, mediaCount: savedMedia.length };
}

// --- stdin reader: buffer bytes and process complete messages ---
// Only act as a real native-messaging host when executed directly. When this
// module is require()'d (by a test), skip the reader and expose internals.
if (require.main === module) {
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
      sendMessage({ ok: false, error: 'Invalid JSON message' });
      continue;
    }

    try {
      if (msg.type === 'save') {
        // async (downloads original media) — ack is sent once it settles. The
        // process drains naturally so the pending fetch keeps it alive.
        handleSave(msg).then(sendMessage).catch((err) => sendMessage({ ok: false, error: err.message }));
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

module.exports = { handleSave, downloadMedia };
