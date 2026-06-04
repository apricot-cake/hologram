'use strict';

// Post Snap native messaging host.
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
  return path.join(os.homedir(), 'PostSnap');
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

function handleSave(msg) {
  const captureId = sanitizeCaptureId(msg.captureId);
  if (!captureId) throw new Error('Invalid captureId');
  if (typeof msg.image !== 'string' || !msg.image) throw new Error('Missing image data');

  const saveFolder = readSaveFolder();
  fs.mkdirSync(saveFolder, { recursive: true });

  const base = uniqueBase(saveFolder, captureId);
  const jpgPath = path.join(saveFolder, `${base}.jpg`);
  const jsonPath = path.join(saveFolder, `${base}.json`);

  fs.writeFileSync(jpgPath, Buffer.from(msg.image, 'base64'));

  const record = Object.assign({}, msg.metadata || {}, {
    captureId: base,
    image: `${base}.jpg`
  });
  fs.writeFileSync(jsonPath, JSON.stringify(record, null, 2), 'utf8');

  return { ok: true, file: `${base}.jpg`, saveFolder };
}

// --- stdin reader: buffer bytes and process complete messages ---
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
        sendMessage(handleSave(msg));
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

// When Chrome closes the port, stdin ends. We let the event loop drain
// naturally rather than calling process.exit(), so any pending stdout write
// (the ack) is flushed before the process terminates.
