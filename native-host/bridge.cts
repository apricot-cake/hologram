'use strict';

// Hologram native messaging host.
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
//
// It also answers ONE read: {type:'query'} tells the extension which permalinks
// are already in the library, so the timeline can mark saved posts (#54). That
// path still writes nothing into the save folder — see the saved-post index.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { configDir, defaultLibraryDir } = require('./paths.cts');
// Best-effort remote-image download (original media + avatars) lives in a shared
// module so the SSRF guard / size caps are identical across capture, import and
// backfill. See media-download.cts.
const { downloadMedia, downloadAvatar, fetchStillImage } = require('./media-download.cts');
// Same pure resolver the desktop app uses, so the bridge and app pick the SAME
// save folder — including recovering from the redundant pointer. See readSaveFolder.
const { resolveSaveFolder } = require('./config-recovery.cts');
// The ONE URL→identity-key rule, shared with the renderer's grouping. See
// post-key.mts and the saved-post index below.
const { postKeyOf } = require('./post-key.mts');

// --- Diagnostic log -----------------------------------------------------------
// Chrome spawns this process once per native-messaging connection, so a line
// here PROVES the host was found in the registry and launched. If Chrome reports
// "native messaging host not found" and this log gets NO new lines, the failure
// is in Chrome's manifest lookup (before launch), not in the bridge. Best-effort;
// must never throw (a logging error must not break a capture).
function logLine(msg: string): void {
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

function appendLog(entry: Record<string, unknown>): void {
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
function logSaveOutcome(type: string, msg: any, res: any, err: Error | null): void {
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
function readSaveFolder(): string {
  let configSaveFolder = null;
  try {
    // README documents hand-editing config.json — strip the UTF-8 BOM Windows
    // editors love to prepend, or the parse throws and this silently falls back.
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
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
function sendMessage(obj: unknown): void {
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

function sanitizeCaptureId(id: unknown): string | null {
  return typeof id === 'string' && SAFE_ID.test(id) ? id : null;
}

function uniqueBase(dir: string, captureId: string): string {
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

// --- Saved-post index (the TL "saved" badge's read path) ----------------------
// The extension asks "which of these permalinks are already in the library?"
// ({type:'query'}), and the answer has to be right even with the desktop app
// closed — that is the whole point of asking the bridge rather than the app.
//
// The app's .index.json (a rebuildable snapshot of every sidecar, written
// debounced) is the cheap bulk source: one read instead of tens of thousands.
// It is also the STALE one — anything saved while the app was closed is missing
// from it — so two independent patches cover the gap:
//
//   1. bridge-journal.jsonl (configDir): every bridge-side save appends its
//      postKey here. This is exactly the app-was-closed case, recorded by the
//      only process that was awake for it.
//   2. a bounded rescan of sidecars NEWER than the snapshot. captureId is
//      "<epochMillis>-<hex>" and the sidecar is named after it, so "newer than
//      the snapshot" is readable from the filename — no stat() per file. This
//      is the belt to the journal's braces: it also catches saves made by a
//      second browser profile (a different bridge process, a different journal).
//
// Both are merged into one postKey→captureId map, cached for the life of the
// process (the extension keeps ONE port open across a timeline's worth of
// queries — see background.ts) and invalidated when either source's mtime moves.
const JOURNAL_FILE = 'bridge-journal.jsonl';
const QUERY_URL_CAP = 300; // one viewport's worth of posts, with room to spare
const RECENT_SCAN_CAP = 500; // sidecars re-read per rebuild, newest first
const JOURNAL_COMPACT_BYTES = 64 * 1024; // compact only once it's worth the rewrite
// Sidecar basename written by a save: "<epochMillis>-<hex>.json", plus the
// "-<n>" uniqueBase() suffix. Group 1 is the save time.
const SIDECAR_NAME = /^(\d{10,})-[0-9a-f]{1,8}(?:-\d+)?\.json$/i;

interface SavedIndex {
  folder: string;
  indexMtimeMs: number;
  journalMtimeMs: number;
  keys: Map<string, string>; // postKey -> captureId
}
let savedIndexCache: SavedIndex | null = null;

function journalPath(): string {
  return path.join(configDir(), JOURNAL_FILE);
}

function statMtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return -1; // absent — a real mtime is never negative, so this compares cleanly
  }
}

// Record a just-completed save so a query answers "saved" immediately, even
// though .index.json will not know about it until the app next runs. Updates the
// live map too: within one port's lifetime the badge must light on the post the
// user just saved without waiting for any file to settle.
function noteSaved(url: unknown, captureId: string): void {
  const key = postKeyOf(typeof url === 'string' ? url : null);
  if (!key) return;
  if (savedIndexCache && !savedIndexCache.keys.has(key)) savedIndexCache.keys.set(key, captureId);
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.appendFileSync(journalPath(), JSON.stringify({ k: key, id: captureId, t: Date.now() }) + '\n', 'utf8');
    // The append moved the journal's mtime; adopt it so the next query doesn't
    // read our own write as "someone else changed this" and rebuild.
    if (savedIndexCache) savedIndexCache.journalMtimeMs = statMtimeMs(journalPath());
  } catch {
    /* best-effort — a save must never fail over its badge bookkeeping */
  }
}

// Journal lines still worth keeping: those recorded AFTER the snapshot was
// written (older ones are already in .index.json). Compacts the file once it
// grows past the threshold, with a check-and-swap on its size so a concurrent
// bridge's append is not silently dropped by the rewrite.
function readJournal(indexMtimeMs: number): Array<{ k: string; id: string }> {
  const p = journalPath();
  let sizeBefore: number;
  let raw: string;
  try {
    sizeBefore = fs.statSync(p).size;
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return []; // no journal yet — nothing was saved app-closed
  }
  const kept: string[] = [];
  const entries: Array<{ k: string; id: string }> = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // torn line (a crashed append) — drop it
    }
    if (!e || typeof e.k !== 'string') continue;
    if (typeof e.t === 'number' && e.t <= indexMtimeMs) continue; // the snapshot has it
    entries.push({ k: e.k, id: typeof e.id === 'string' ? e.id : '' });
    kept.push(line);
  }
  if (sizeBefore >= JOURNAL_COMPACT_BYTES && kept.length * 120 < sizeBefore) {
    try {
      if (fs.statSync(p).size === sizeBefore) {
        const tmp = p + '.tmp';
        fs.writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
        fs.renameSync(tmp, p);
      }
    } catch {
      /* compaction is an optimization — a failure just leaves the file long */
    }
  }
  return entries;
}

// Sidecars saved after the snapshot, read newest-first and capped. Reads the
// save time out of the FILENAME (see SIDECAR_NAME) rather than stat-ing every
// file: on a 9k-post folder that is one readdir instead of 9k stats.
function scanRecentSidecars(folder: string, sinceMs: number, keys: Map<string, string>): void {
  let files: string[];
  try {
    files = fs.readdirSync(folder);
  } catch {
    return;
  }
  const fresh: string[] = [];
  for (const f of files) {
    const m = f.match(SIDECAR_NAME);
    if (m && Number(m[1]) >= sinceMs) fresh.push(f);
  }
  fresh.sort().reverse();
  for (const f of fresh.slice(0, RECENT_SCAN_CAP)) {
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8').replace(/^\uFEFF/, ''));
      const key = postKeyOf(rec && rec.url);
      if (key && !keys.has(key)) keys.set(key, (rec && rec.captureId) || '');
    } catch {
      /* unreadable/partial sidecar — skip it */
    }
  }
}

function buildSavedIndex(folder: string): SavedIndex {
  const indexFile = path.join(folder, '.index.json');
  const indexMtimeMs = statMtimeMs(indexFile);
  const keys = new Map<string, string>();
  try {
    const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8').replace(/^\uFEFF/, ''));
    const entries = idx && idx.entries;
    if (entries && typeof entries === 'object') {
      for (const name of Object.keys(entries)) {
        const rec = entries[name] && entries[name].record;
        const key = postKeyOf(rec && rec.url);
        if (key && !keys.has(key)) keys.set(key, (rec && rec.captureId) || '');
      }
    }
  } catch {
    // No snapshot (fresh library, or the app has never run here) — indexMtimeMs
    // stays -1, so the rescan below covers the whole folder up to its cap.
  }
  scanRecentSidecars(folder, indexMtimeMs, keys);
  for (const e of readJournal(indexMtimeMs)) if (!keys.has(e.k)) keys.set(e.k, e.id);
  return { folder, indexMtimeMs, journalMtimeMs: statMtimeMs(journalPath()), keys };
}

// Cached map, rebuilt when the save folder changed or either source moved. The
// two stats are the whole cost of a warm query.
function savedIndex(folder: string): Map<string, string> {
  const c = savedIndexCache;
  if (c && c.folder === folder && c.indexMtimeMs === statMtimeMs(path.join(folder, '.index.json')) && c.journalMtimeMs === statMtimeMs(journalPath())) {
    return c.keys;
  }
  savedIndexCache = buildSavedIndex(folder);
  return savedIndexCache.keys;
}

// {type:'query', urls:[…]} → {ok:true, results:{[url]: captureId|null}}.
// null means "not in the library"; anything else means saved (the captureId is
// informational — a record whose id we could not read answers with '').
function handleQuery(msg: any) {
  const urls: unknown[] = Array.isArray(msg.urls) ? msg.urls.slice(0, QUERY_URL_CAP) : [];
  const results: Record<string, string | null> = {};
  if (!urls.length) return { ok: true, results };
  const keys = savedIndex(readSaveFolder());
  for (const u of urls) {
    if (typeof u !== 'string' || !u) continue;
    const key = postKeyOf(u);
    results[u] = key && keys.has(key) ? (keys.get(key) as string) : null;
  }
  return { ok: true, results };
}

async function handleSave(msg: any) {
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
  // avatarFile null (the viewer hides it) and never fails the save. Shared
  // store (avatars/<urlhash>.<ext>): a re-save of the same author reuses the
  // existing file instead of writing another copy.
  let avatarFile = null;
  try {
    avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder);
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
  // The sidecar is on disk = this post IS saved. Tell the badge index now: the
  // app's .index.json won't know until the app next runs (see noteSaved).
  noteSaved(record.url, base);

  return { ok: true, file: `${base}.jpg`, saveFolder, mediaCount: savedMedia.length };
}

// Image-drag save: no screenshot. The bridge downloads the dragged illustration
// itself (any supported still type, with an optional pixiv Referer) and that file
// IS the record's primary image. media[] is left empty (the image is the content;
// duplicating it in media[] would double it in the viewer's lightbox). This is the
// same "illustration record" shape an imported library item produces. captureId is the
// normal epochMillis-hex form, so it passes SAFE_ID.
async function handleSaveDragged(msg: any) {
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
    avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder);
  } catch {
    avatarFile = null;
  }
  // source:'drag' marks the image as the artwork itself (not a post screenshot),
  // so the image-view shows it. Mirrors the migrated records' source marker.
  const record = Object.assign({}, meta, { captureId: base, image: imageFile, media: [], source: 'drag', avatarFile });
  fs.writeFileSync(path.join(saveFolder, `${base}.json`), JSON.stringify(record, null, 2), 'utf8');
  noteSaved(record.url, base); // see handleSave

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

      let msg: any;
      try {
        msg = JSON.parse(body.toString('utf8'));
      } catch {
        logLine('recv: invalid JSON');
        sendMessage({ ok: false, error: 'Invalid JSON message' });
        continue;
      }

      // The badge's port stays open for a whole browsing session and asks on
      // every scroll, so its queries would drown bridge.log's one-line-per-save
      // signal. Everything else still logs — a save that never arrives is the
      // failure this log exists for.
      if (msg.type !== 'query') logLine(`recv type=${msg && msg.type}`);
      // Replies carry the request's id back when it has one. A one-shot
      // connection (every save path) does not need it — the port closes after
      // its single reply — but the badge multiplexes many queries over ONE port
      // and has to match each answer to its question. Echoed for every type so
      // the correlation rule is the message's, not the handler's.
      const reply = (res: Record<string, unknown>) => sendMessage(msg && msg.id != null ? Object.assign({ id: msg.id }, res) : res);
      try {
        if (msg.type === 'save') {
          // async (downloads original media) — ack is sent once it settles. The
          // process drains naturally so the pending fetch keeps it alive.
          handleSave(msg)
            .then((res) => {
              logSaveOutcome('save', msg, res, null);
              reply(res);
            })
            .catch((err) => {
              logSaveOutcome('save', msg, null, err);
              reply({ ok: false, error: err.message });
            });
        } else if (msg.type === 'saveDragged') {
          handleSaveDragged(msg)
            .then((res) => {
              logSaveOutcome('saveDragged', msg, res, null);
              reply(res);
            })
            .catch((err) => {
              logSaveOutcome('saveDragged', msg, null, err);
              reply({ ok: false, error: err.message });
            });
        } else if (msg.type === 'query') {
          // Read-only: "which of these permalinks are already in the library?"
          reply(handleQuery(msg));
        } else if (msg.type === 'log') {
          // Diagnostics relayed by the extension (pre-bridge stages). Persist + ack.
          appendLog(msg.entry || {});
          reply({ ok: true });
        } else if (msg.type === 'ping') {
          reply({ ok: true, pong: true });
        } else {
          reply({ ok: false, error: `Unknown message type: ${msg.type}` });
        }
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    }
  });
}

// When Chrome closes the port, stdin ends. We let the event loop drain
// naturally rather than calling process.exit(), so any pending stdout write
// (the ack) is flushed before the process terminates.

// _resetSavedIndex is a test seam: the index caches for the life of the process,
// which is right for a real host (one process per port) and wrong for a test file
// that walks several save folders in a row.
module.exports = { handleSave, handleSaveDragged, downloadMedia, downloadAvatar, fetchStillImage, appendLog, handleQuery, noteSaved, _resetSavedIndex: () => (savedIndexCache = null) };
