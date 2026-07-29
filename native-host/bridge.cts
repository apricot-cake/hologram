'use strict';

// Hologram native messaging host.
//
// Chrome spawns this process per connection (chrome.runtime.connectNative).
// It receives a captured post over stdin and writes into the user's save
// folder:
//   <captureId>.jpg          the cropped JPEG (no EXIF) — media stays a plain file
//   .hologram-inbox/new/<captureId>.json   the durable intake envelope (#5 St6 / #299)
//
// The bridge no longer writes a per-post sidecar JSON directly into the save
// folder — that write path belonged to the "expand" phase of #5's migration
// (sidecars were the truth). Now that the desktop app owns hologram.db as the
// SOLE writer (lib-db.ts's single-writer invariant), a second process writing
// straight into the DB's derived state would violate that boundary. Instead
// the bridge appends an envelope to the inbox queue (native-host/inbox.mts);
// the app drains it into the DB at startup and on change. Files (screenshot/
// media/avatar) are still write-once, still safe for concurrent captures, and
// the bridge still works even when the app is not running — an inbox envelope
// on disk is exactly as durable as the old sidecar was, just not a DB row yet.
//
// It also answers ONE read: {type:'query'} tells the extension which permalinks
// are already in the library, so the timeline can mark saved posts (#54). That
// path still writes nothing into the save folder — see the saved-post index.

const fs = require('node:fs');
const path = require('node:path');
const _os = require('node:os');

const { configDir, defaultLibraryDir } = require('./paths.cts');
// Best-effort remote-image download (original media + avatars) lives in a shared
// module so the SSRF guard / size caps are identical across capture, import and
// backfill. See media-download.cts.
const { downloadMedia, downloadAvatar, saveStillImage, createByteBudget } = require('./media-download.cts');
// Same pure resolver the desktop app uses, so the bridge and app pick the SAME
// save folder — including recovering from the redundant pointer. See readSaveFolder.
const { resolveSaveFolder } = require('./config-recovery.cts');
// The ONE URL→identity-key rule, shared with the renderer's grouping. See
// post-key.mts and the saved-post index below.
const { postKeyOf } = require('./post-key.mts');
// The shared record shape + normalization builder (#5 St2 / #295), so a
// bridge-built record carries the exact same fields the DB writer expects.
const { normalizePostRecord, recordHoldsContent } = require('./post-record.mts');
// The durable intake queue's envelope format + atomic writer (#5 St6 / #299).
const { buildEnvelope, writeInboxEvent, inboxNewDir, parseInboxEnvelope } = require('./inbox.mts');
// The acquisition originals (#292): the extension hands over response bodies as
// received; compressing, hashing and capping them happens HERE, on the trusted
// side of the native-messaging boundary, so the browser never decides how much
// of an original is worth keeping.
const { packRawPayloads } = require('./raw-payload.mts');

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
    // metaReason is its cause when the extension could classify one (protected /
    // ageRestricted / unavailable / fetchFailed) — the difference between "the
    // post is gone" and "our fetch broke", which the outcome alone cannot say.
    metaOk: msg ? msg.metaOk : undefined,
    metaReason: msg ? msg.metaReason : undefined,
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

// Collision-avoidance for the captureId-derived base name. Checks the media file at
// the save-folder root (.jpg) and the inbox envelope (new/<id>.json) — the two
// artifacts a save produces — plus a root .json, which only a pre-#5 library can
// still have lying around (nothing writes one since #302).
function uniqueBase(dir: string, captureId: string): string {
  const taken = (base: string) => fs.existsSync(path.join(dir, `${base}.jpg`)) || fs.existsSync(path.join(dir, `${base}.json`)) || fs.existsSync(path.join(inboxNewDir(dir), `${base}.json`));
  if (!taken(captureId)) return captureId;
  let n = 1;
  // Extremely unlikely (captureId already carries a timestamp + random), but
  // guarantee uniqueness rather than overwrite.
  while (taken(`${captureId}-${n}`)) {
    n += 1;
  }
  return `${captureId}-${n}`;
}

// --- Saved-post index (the TL "saved" badge's read path) ----------------------
// The extension asks "which of these permalinks are already in the library?"
// ({type:'query'}), and the answer has to be right even with the desktop app
// closed — that is the whole point of asking the bridge rather than the app.
//
// #299 replaced the old scan-derived snapshot with bridge-saved-index.json: a
// small postKey->captureId map the app rebuilds straight from hologram.db
// (lib-saved-index.ts) and rewrites debounced, atomically, whenever posts
// change. It is the cheap bulk source — one read instead of scanning the
// library — and it is also the STALE one: anything saved (or imported/
// deleted) since the app's last write is missing from it. Two independent
// patches cover the gap:
//
//   1. bridge-journal.jsonl (configDir): every bridge-side save appends its
//      postKey here. This is exactly the app-was-closed case, recorded by the
//      only process that was awake for it.
//   2. a bounded rescan of loose inbox envelopes (.hologram-inbox/new) NEWER
//      than the saved-index snapshot. eventId is "<epochMillis>-<hex>" and the
//      envelope is named after it, so "newer than the snapshot" is readable
//      from the filename — no stat() per file. This is the belt to the
//      journal's braces: it also catches saves made by a second browser
//      profile (a different bridge process, a different journal).
//
// Both are merged into one postKey→entry map, cached for the life of the
// process (the extension keeps ONE port open across a timeline's worth of
// queries — see background.ts) and invalidated when either source's mtime moves.
//
// An entry is a captureId plus the post's SAVED PICTURES (#334): the media
// items the record holds, in the record's own order. The badge's question is
// per picture, not per post — one picture of a multi-image post may be in the
// library while the rest are not — and only the record knows which. Media from
// EVERY record sharing a postKey is merged, because saving a second picture of
// a post writes a second record rather than extending the first.
//
// A record whose media is unknown (an entry with no items at all: a text-only
// post, a capture whose downloads failed, a snapshot written by an older app)
// answers with an empty list, which the extension reads as "saved, granularity
// unknown" and treats exactly as it did before #334 — the whole post marked.
// Absence of detail must not read as "that picture is not saved".
const SAVED_INDEX_FILE = 'bridge-saved-index.json';
const JOURNAL_FILE = 'bridge-journal.jsonl';
const QUERY_URL_CAP = 300; // one viewport's worth of posts, with room to spare
const RECENT_SCAN_CAP = 500; // loose inbox envelopes re-read per rebuild, newest first
const JOURNAL_COMPACT_BYTES = 64 * 1024; // compact only once it's worth the rewrite
// Inbox envelope basename (native-host/inbox.mts's writeInboxEvent): eventId
// IS the captureId, "<epochMillis>-<hex>", plus the "-<n>" uniqueBase()
// suffix. Group 1 is the save time.
const INBOX_ENVELOPE_NAME = /^(\d{10,})-[0-9a-f]{1,8}(?:-\d+)?\.json$/i;

// The saved pictures of one post: positional, so the array index IS the media
// row's seq and a picture the library recorded no URL for holds its place as
// null. url leads; seq is only the fallback for those nulls (a post's media can
// change, so a position is no durable id).
interface SavedEntry {
  id: string; // captureId ('' when the source could not report one)
  media: Array<string | null>;
}
interface SavedIndex {
  folder: string;
  savedIndexMtimeMs: number;
  journalMtimeMs: number;
  keys: Map<string, SavedEntry>; // postKey -> entry
}
let savedIndexCache: SavedIndex | null = null;

// media[] as the saved-index carries it: positional, so the index IS the seq
// and an item the record has no URL for still occupies its place. Takes either
// shape a source offers — a record's media objects ({url,file,…}) or the
// already-flattened list the snapshot and the journal store.
function mediaUrlsOf(source: any): Array<string | null> {
  const media = source && Array.isArray(source.media) ? source.media : [];
  return media.map((m: any) => {
    if (typeof m === 'string') return m || null;
    return m && typeof m.url === 'string' && m.url ? m.url : null;
  });
}

// Fold one record's pictures into the entry for its postKey. Two records of the
// same post (the second picture of a multi-image post is its own save) both
// contribute; a picture already listed is not listed twice.
//
// A url-less picture is kept only from the FIRST record to claim the key: its
// position is meaningful inside its own record and nowhere else, so appending
// one from a later record would put a "picture number" at a number that is not
// its own. Dropping it costs nothing the badge can use.
function mergeSavedEntry(keys: Map<string, SavedEntry>, key: string, id: string, urls: Array<string | null>): void {
  const entry = keys.get(key);
  if (!entry) {
    keys.set(key, { id, media: urls.slice() });
    return;
  }
  for (const url of urls) {
    if (!url || entry.media.includes(url)) continue;
    entry.media.push(url);
  }
}

function savedIndexPath(): string {
  return path.join(configDir(), SAVED_INDEX_FILE);
}
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
// though bridge-saved-index.json will not know about it until the app next
// drains the inbox. Updates the live map too: within one port's lifetime the
// badge must light on the post the user just saved without waiting for any
// file to settle.
function noteSaved(url: unknown, captureId: string, media?: unknown): void {
  const key = postKeyOf(typeof url === 'string' ? url : null);
  if (!key) return;
  const urls = mediaUrlsOf({ media });
  if (savedIndexCache) mergeSavedEntry(savedIndexCache.keys, key, captureId, urls);
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.appendFileSync(journalPath(), JSON.stringify({ k: key, id: captureId, m: urls, t: Date.now() }) + '\n', 'utf8');
    // The append moved the journal's mtime; adopt it so the next query doesn't
    // read our own write as "someone else changed this" and rebuild.
    if (savedIndexCache) savedIndexCache.journalMtimeMs = statMtimeMs(journalPath());
  } catch {
    /* best-effort — a save must never fail over its badge bookkeeping */
  }
}

// Journal lines still worth keeping: those recorded AFTER the saved-index
// snapshot was written (older ones are already in it). Compacts the file once
// it grows past the threshold, with a check-and-swap on its size so a
// concurrent bridge's append is not silently dropped by the rewrite.
function readJournal(savedIndexMtimeMs: number): Array<{ k: string; id: string; m: Array<string | null> }> {
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
  const entries: Array<{ k: string; id: string; m: Array<string | null> }> = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // torn line (a crashed append) — drop it
    }
    if (!e || typeof e.k !== 'string') continue;
    if (typeof e.t === 'number' && e.t <= savedIndexMtimeMs) continue; // the snapshot has it
    // m is positional (see mediaUrlsOf); a line written before #334 has none,
    // which reads as "saved, pictures unknown" rather than "no pictures saved".
    entries.push({ k: e.k, id: typeof e.id === 'string' ? e.id : '', m: Array.isArray(e.m) ? e.m.map((u: unknown) => (typeof u === 'string' && u ? u : null)) : [] });
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

// Loose inbox envelopes newer than the saved-index snapshot, read newest-first
// and capped. Reads the save time out of the FILENAME (see INBOX_ENVELOPE_NAME)
// rather than stat-ing every file — same trick scanRecentSidecars used pre-#299.
function scanRecentInbox(folder: string, sinceMs: number, keys: Map<string, SavedEntry>): void {
  let files: string[];
  try {
    files = fs.readdirSync(inboxNewDir(folder));
  } catch {
    return; // no inbox yet (fresh library, or nothing saved through this bridge)
  }
  const fresh: string[] = [];
  for (const f of files) {
    const m = f.match(INBOX_ENVELOPE_NAME);
    if (m && Number(m[1]) >= sinceMs) fresh.push(f);
  }
  fresh.sort().reverse();
  for (const f of fresh.slice(0, RECENT_SCAN_CAP)) {
    try {
      const raw = fs.readFileSync(path.join(inboxNewDir(folder), f), 'utf8');
      const parsed = parseInboxEnvelope(raw);
      if (!parsed.ok) continue; // corrupt/mid-write/unknown-version -- skip, don't crash the query
      // Same rule the writer now applies (#492): an envelope holding nothing of
      // its post must not answer "saved". handleSavePost stopped writing these,
      // but envelopes left by an older bridge are still on disk.
      if (!recordHoldsContent(parsed.envelope.record)) continue;
      const key = postKeyOf(parsed.envelope.record.url);
      if (key) mergeSavedEntry(keys, key, parsed.envelope.eventId, mediaUrlsOf(parsed.envelope.record));
    } catch {
      /* unreadable/partial envelope — skip it */
    }
  }
}

function buildSavedIndex(folder: string): SavedIndex {
  const indexFile = savedIndexPath();
  const savedIndexMtimeMs = statMtimeMs(indexFile);
  const keys = new Map<string, SavedEntry>();
  try {
    const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    const entries = idx && idx.entries;
    if (entries && typeof entries === 'object') {
      for (const [key, value] of Object.entries(entries)) {
        if (typeof key !== 'string' || !key || keys.has(key)) continue;
        // v1 wrote a bare captureId string (pre-#334): saved, pictures unknown.
        if (typeof value === 'string') keys.set(key, { id: value, media: [] });
        else if (value && typeof value === 'object') mergeSavedEntry(keys, key, typeof (value as any).id === 'string' ? (value as any).id : '', mediaUrlsOf(value));
      }
    }
  } catch {
    // No snapshot yet (fresh library, or the app has never run here) —
    // savedIndexMtimeMs stays -1, so the rescan below covers the whole loose
    // inbox up to its cap.
  }
  scanRecentInbox(folder, savedIndexMtimeMs, keys);
  for (const e of readJournal(savedIndexMtimeMs)) mergeSavedEntry(keys, e.k, e.id, e.m);
  return { folder, savedIndexMtimeMs, journalMtimeMs: statMtimeMs(journalPath()), keys };
}

// Cached map, rebuilt when the save folder changed or either source moved. The
// two stats are the whole cost of a warm query.
function savedIndex(folder: string): Map<string, SavedEntry> {
  const c = savedIndexCache;
  if (c && c.folder === folder && c.savedIndexMtimeMs === statMtimeMs(savedIndexPath()) && c.journalMtimeMs === statMtimeMs(journalPath())) {
    return c.keys;
  }
  savedIndexCache = buildSavedIndex(folder);
  return savedIndexCache.keys;
}

// {type:'query', urls:[…]} → {ok:true, results:{[url]: {id, media}|null}}.
// null means "not in the library". An entry means saved, and its media list
// says WHICH of the post's pictures are (#334) — empty when the library knows
// the post but not its pictures, which the asker treats as the whole post.
// The captureId is informational (a record whose id we could not read answers
// with '').
function handleQuery(msg: any) {
  const urls: unknown[] = Array.isArray(msg.urls) ? msg.urls.slice(0, QUERY_URL_CAP) : [];
  const results: Record<string, SavedEntry | null> = {};
  if (!urls.length) return { ok: true, results };
  const keys = savedIndex(readSaveFolder());
  for (const u of urls) {
    if (typeof u !== 'string' || !u) continue;
    const key = postKeyOf(u);
    results[u] = (key && keys.get(key)) || null;
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

  // base64 decoding is lenient (it silently drops invalid chars), so a corrupt
  // payload would otherwise be written as a broken .jpg with ok:true. Validate
  // the JPEG SOI marker (FF D8 FF) and fail loudly before writing anything; the
  // throw is caught upstream and returned as { ok:false, error }, leaving no
  // orphaned files (the inbox envelope is written only after the image).
  const img = Buffer.from(msg.image, 'base64');
  if (img.length < 3 || img[0] !== 0xff || img[1] !== 0xd8 || img[2] !== 0xff) {
    throw new Error('Invalid image data (not a JPEG)');
  }
  fs.writeFileSync(jpgPath, img);

  const meta = msg.metadata || {};
  // ONE byte budget for this save, shared by the attachments and the avatar
  // below, so a hostile post cannot spend it twice (#389).
  const budget = createByteBudget();
  // Best-effort original-media download. A failure here must NEVER fail the save:
  // the screenshot + inbox envelope are the primary artifacts. The envelope is
  // written LAST so media[].file reflects exactly what landed on disk.
  let savedMedia = [];
  try {
    savedMedia = await downloadMedia(meta.media, saveFolder, base, budget);
  } catch {
    savedMedia = [];
  }

  // Author avatar: same best-effort contract as media — a failure leaves
  // avatarFile null (the viewer hides it) and never fails the save. Shared
  // store (avatars/<urlhash>.<ext>): a re-save of the same author reuses the
  // existing file instead of writing another copy.
  let avatarFile = null;
  try {
    avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder, budget);
  } catch {
    avatarFile = null;
  }

  const record = normalizePostRecord(
    Object.assign({}, meta, {
      captureId: base,
      image: `${base}.jpg`,
      media: savedMedia,
      avatarFile,
      raw: packRawPayloads(meta.rawPayloads),
    }),
  );
  // Commit point: the rename into new/ inside writeInboxEvent is what makes
  // this capture durable (#299 design comment). A throw here (disk full, tmp
  // create collision) is caught upstream and returned as { ok:false, error }.
  await writeInboxEvent(saveFolder, buildEnvelope(record));
  // The envelope is on disk = this post IS saved. Tell the badge index now:
  // the app won't know until it next drains the inbox (see noteSaved).
  noteSaved(record.url, base, record.media);

  return { ok: true, file: `${base}.jpg`, saveFolder, mediaCount: savedMedia.length, media: mediaUrlsOf(record) };
}

// Bulk-intake save (#362): metadata plus the post's own media, and no
// screenshot at all. The auto capture mode stopped shooting the viewport
// because a virtual list re-lays out between measuring, shooting and cropping,
// so the crop slipped off the post — see that Issue. Everything a screenshot
// save keeps is still kept: the originals were always downloaded from the
// platform API alongside it, so only the "how the page looked" layer is gone.
//
// media[] holds EVERY original and image stays null — the same shape the
// screenshot path produces, minus the screenshot. The card face comes from
// media[0] either way (lib-index's cardImageFile and the renderer's
// artworkFile both lead with media), so nothing is lost by leaving image
// empty, while the viewer's multi-image stack counts media[] and would
// undercount by one if the first picture were moved out of it.
//
// A post with NO media still gets its inbox envelope written, as long as
// something of the post arrived (its text, at minimum). It cannot be displayed
// until #365 gives image-less records a home, but the record sits in the inbox
// and the DB meanwhile and simply appears when that lands. Refusing to write it
// would instead lose the post for good: X has no bookmark export, so a bookmark
// not taken during the import is unrecoverable once the account is gone.
// Preserve now, display later.
//
// A post NOTHING arrived for is the opposite case and is refused (#492). When
// the platform serves no post info at all — deleted, suspended, protected, age
// gated, or a fetch that failed — the record would carry only what the URL
// itself already says (platform, screenName, the date decoded from the id).
// Writing it looked harmless and was not: noteSaved lights the post's badge,
// every later intake reads that badge and skips the post, and the one thing
// that could still have rescued it — trying again — is what the shell record
// permanently prevents. Failing here costs a retry; succeeding here costs the
// post. recordHoldsContent is the shared rule (post-record.mts), and the badge
// index applies the SAME rule so shells written before this fix stop answering.
async function handleSavePost(msg: any) {
  const captureId = sanitizeCaptureId(msg.captureId);
  if (!captureId) throw new Error('Invalid captureId');

  const saveFolder = readSaveFolder();
  fs.mkdirSync(saveFolder, { recursive: true });

  const base = uniqueBase(saveFolder, captureId);
  const meta = msg.metadata || {};

  // Stricter than the screenshot path: with no screenshot the media IS the
  // record's face, so a download that FAILS must not be papered over as a
  // text-only post. Announced media that could not be fetched fails the save so
  // the post stays unsaved and the next run retries it.
  let savedMedia: any[] = [];
  const announced = Array.isArray(meta.media) ? meta.media.length : 0;
  const budget = createByteBudget(); // see handleSave: one per save operation
  try {
    savedMedia = await downloadMedia(meta.media, saveFolder, base, budget);
  } catch (error: any) {
    throw new Error(`Media download failed: ${error?.message || error}`);
  }
  if (announced && !savedMedia.length) throw new Error('Media download produced no files');

  let avatarFile = null;
  try {
    avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder, budget);
  } catch {
    avatarFile = null;
  }

  const record = normalizePostRecord(
    Object.assign({}, meta, {
      captureId: base,
      image: null,
      media: savedMedia,
      avatarFile,
      raw: packRawPayloads(meta.rawPayloads),
    }),
  );
  // Nothing of the post arrived — see this function's comment. Thrown before
  // the envelope is written AND before noteSaved, so the post stays unsaved and
  // unbadged: the next intake run offers it again instead of skipping it.
  if (!recordHoldsContent(record)) throw new Error(`Post unavailable: nothing was obtained for it (${msg.metaReason || 'no post info'}, no media)`);
  await writeInboxEvent(saveFolder, buildEnvelope(record));
  noteSaved(record.url, base, record.media); // see handleSave

  // deferred = written but not displayable yet (no media at all → #365).
  return { ok: true, file: savedMedia.length ? savedMedia[0].file : base, saveFolder, mediaCount: savedMedia.length, deferred: !savedMedia.length, media: mediaUrlsOf(record) };
}

// Image-drag save: no screenshot. The bridge downloads the dragged illustration
// itself (any supported still type, with an optional pixiv Referer) and that file
// IS the record's primary image. It is ALSO the record's single media[] entry —
// the row that says WHICH picture of the post this record holds (#334). Nothing
// is doubled by that: the viewer's artwork/group helpers read media[] *instead
// of* image (records.ts's artworkFile/groupFilesOf), and both point at the one
// file this save wrote. Before #334 the record kept the downloaded file but not
// where it came from, so a multi-image post could not be asked which of its
// pictures were already in the library. This is the same "illustration record"
// shape an imported library item produces. captureId is the normal
// epochMillis-hex form, so it passes SAFE_ID.
async function handleSaveDragged(msg: any) {
  const captureId = sanitizeCaptureId(msg.captureId);
  if (!captureId) throw new Error('Invalid captureId');
  if (typeof msg.imageUrl !== 'string' || !msg.imageUrl) throw new Error('Missing image URL');

  const saveFolder = readSaveFolder();
  fs.mkdirSync(saveFolder, { recursive: true });
  const base = uniqueBase(saveFolder, captureId);

  const budget = createByteBudget(); // see handleSave: one per save operation
  const got = await saveStillImage(msg.imageUrl, msg.imageReferer, saveFolder, base, budget);
  if (!got) throw new Error('Image download failed (unsupported type, too large, or network error)');
  const imageFile = got.file;

  const meta = msg.metadata || {};
  let avatarFile = null;
  try {
    avatarFile = await downloadAvatar(meta.avatar, meta.avatarReferer, saveFolder, budget);
  } catch {
    avatarFile = null;
  }
  // source:'drag' marks the image as the artwork itself (not a post screenshot),
  // so the image-view shows it. Mirrors the migrated records' source marker.
  const media = [{ url: msg.imageUrl, file: imageFile }];
  const record = normalizePostRecord(Object.assign({}, meta, { captureId: base, image: imageFile, media, source: 'drag', avatarFile, raw: packRawPayloads(meta.rawPayloads) }));
  await writeInboxEvent(saveFolder, buildEnvelope(record));
  noteSaved(record.url, base, record.media); // see handleSave

  return { ok: true, file: imageFile, saveFolder, media: mediaUrlsOf(record) };
}

// --- stdin reader: buffer bytes and process complete messages ---
// Only act as a real native-messaging host when executed directly. When this
// module is require()'d (by a test), skip the reader and expose internals.
if (require.main === module) {
  logLine(`launched argv=${JSON.stringify(process.argv.slice(2))} saveFolder=${readSaveFolder()}`);
  let buffer = Buffer.alloc(0);

  // chunk is annotated because the 'data' signature is string | Buffer: stdin
  // only yields strings once an encoding is set, and this host never sets one
  // (native messaging frames are length-prefixed binary).
  process.stdin.on('data', (chunk: Buffer) => {
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
        } else if (msg.type === 'savePost') {
          handleSavePost(msg)
            .then((res) => {
              logSaveOutcome('savePost', msg, res, null);
              reply(res);
            })
            .catch((err) => {
              logSaveOutcome('savePost', msg, null, err);
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
module.exports = { handleSave, handleSavePost, handleSaveDragged, downloadMedia, downloadAvatar, saveStillImage, createByteBudget, appendLog, handleQuery, noteSaved, _resetSavedIndex: () => (savedIndexCache = null) };
