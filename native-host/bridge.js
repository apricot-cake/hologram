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

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { configDir, defaultLibraryDir } = require('./paths');
// Best-effort remote-image download (original media + avatars) lives in a shared
// module so the SSRF guard / size caps are identical across capture, import and
// backfill. See media-download.js.
const { downloadMedia, downloadAvatar, fetchStillImage } = require('./media-download');
// Same pure resolver the desktop app uses, so the bridge and app pick the SAME
// save folder — including recovering from the redundant pointer. See readSaveFolder.
const { resolveSaveFolder } = require('./config-recovery');

// --- Diagnostic log -----------------------------------------------------------
// Chrome spawns this process once per native-messaging connection, so a line
// here PROVES the host was found in the registry and launched. If Chrome reports
// "native messaging host not found" and this log gets NO new lines, the failure
// is in Chrome's manifest lookup (before launch), not in the bridge. Best-effort;
// must never throw (a logging error must not break a capture).
function logLine(msg) {
  try {
    fs.appendFileSync(path.join(configDir(), 'bridge.log'), `${new Date().toISOString()} [pid ${process.pid}] ${msg}\n`);
  } catch {
    /* ignore — logging is non-essential */
  }
}

// --- Structured capture diagnostics log ---------------------------------------
// One JSON line per capture event in capture.log, so a broken save can be
// diagnosed after the fact: which stage failed and why. The extension relays its
// pre-bridge stages (select / permalink / capture / crop / metadata) via
// {type:'log'}; the bridge appends its own final outcome here. Best-effort — must
// never throw (a logging error must not break a capture). Rotated to one previous
// generation (capture.log.1) at ~2MB so it can't grow unbounded.
const CAPTURE_LOG_MAX = 2 * 1024 * 1024;

function appendLog(entry) {
  try {
    const file = path.join(configDir(), 'capture.log');
    try {
      if (fs.statSync(file).size > CAPTURE_LOG_MAX) fs.renameSync(file, `${file}.1`);
    } catch {
      /* no file yet — nothing to rotate */
    }
    fs.appendFileSync(file, JSON.stringify(Object.assign({ ts: new Date().toISOString() }, entry)) + '\n');
  } catch {
    /* ignore — logging is non-essential */
  }
}

// One capture.log line for a bridge-side save result (the final stage). The
// extension logs the earlier stages; this ties the outcome to the same url.
function logSaveOutcome(type, msg, res, err) {
  const meta = (msg && msg.metadata) || {};
  appendLog({
    stage: 'bridge',
    phase: err ? 'fail' : 'ok',
    type,
    captureId: (res && res.file) || (msg && msg.captureId) || null,
    platform: meta.platform || null,
    url: meta.url || null,
    // metaOk is computed by the extension (whether the post API returned info);
    // pass-through so a partial save (image saved, post info missing) is visible.
    metaOk: msg ? msg.metaOk : undefined,
    mediaCount: res ? res.mediaCount : undefined,
    error: err ? err.message : undefined,
  });
}

// --- Save folder resolution (shared config with the desktop app) ---
// Resolves through the SAME pure function as the app's getSaveFolder(): explicit
// config wins, otherwise recover from the redundant saveFolder.path pointer (only
// if it still resolves to a real dir), otherwise the SAME shared default.
//
// The pointer step matters because the app and bridge read config independently.
// After a truncated config.json drops saveFolder (the 2026-06-23 loss incident),
// the app heals config from the pointer on its NEXT launch — but the bridge is
// spawned per-capture by Chrome with the app possibly closed, so without reading
// the pointer itself it would silently save into defaultLibraryDir() while the
// app still points at the chosen library = the two going out of sync.
function readSaveFolder() {
  let configSaveFolder = null;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.saveFolder === 'string') configSaveFolder = cfg.saveFolder;
  } catch {
    // No config yet (or unreadable) — fall through to pointer / default.
  }
  let pointer = null;
  try {
    pointer = fs.readFileSync(path.join(configDir(), 'saveFolder.path'), 'utf8').trim() || null;
  } catch {
    // No redundant pointer — fine.
  }
  let pointerExists = false;
  if (pointer) {
    try {
      pointerExists = fs.statSync(pointer).isDirectory();
    } catch {
      pointerExists = false;
    }
  }
  return resolveSaveFolder({
    configSaveFolder,
    pointer,
    pointerExists,
    defaultDir: defaultLibraryDir(),
  }).folder;
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
  return typeof id === 'string' && SAFE_ID.test(id) ? id : null;
}

function uniqueBase(dir, captureId) {
  if (!fs.existsSync(path.join(dir, `${captureId}.jpg`)) && !fs.existsSync(path.join(dir, `${captureId}.json`))) {
    return captureId;
  }
  let n = 1;
  // Extremely unlikely (captureId already carries a timestamp + random), but
  // guarantee uniqueness rather than overwrite.
  while (fs.existsSync(path.join(dir, `${captureId}-${n}.jpg`)) || fs.existsSync(path.join(dir, `${captureId}-${n}.json`))) {
    n += 1;
  }
  return `${captureId}-${n}`;
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
  if (img.length < 3 || img[0] !== 0xff || img[1] !== 0xd8 || img[2] !== 0xff) {
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
    avatarFile,
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
          handleSave(msg)
            .then((res) => {
              logSaveOutcome('save', msg, res, null);
              sendMessage(res);
            })
            .catch((err) => {
              logSaveOutcome('save', msg, null, err);
              sendMessage({ ok: false, error: err.message });
            });
        } else if (msg.type === 'saveDragged') {
          handleSaveDragged(msg)
            .then((res) => {
              logSaveOutcome('saveDragged', msg, res, null);
              sendMessage(res);
            })
            .catch((err) => {
              logSaveOutcome('saveDragged', msg, null, err);
              sendMessage({ ok: false, error: err.message });
            });
        } else if (msg.type === 'log') {
          // Diagnostics relayed by the extension (pre-bridge stages). Persist + ack.
          appendLog(msg.entry || {});
          sendMessage({ ok: true });
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

module.exports = { handleSave, handleSaveDragged, downloadMedia, downloadAvatar, fetchStillImage, appendLog };
