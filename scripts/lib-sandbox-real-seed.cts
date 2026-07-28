'use strict';

// Real-data seeding for the sandbox verify instance (#286).
//
// Fixtures cover neither of the two things a real library reproduces: the
// diversity/scale at which layout and performance problems appear, and one
// specific post that triggers a bug. This module fills <tree>/.sandbox with a
// SNAPSHOT of the real library's database plus generated stand-in media, so both
// become verifiable while the real library stays unreachable from the instance.
//
// The design is #286's 2026-07-25 decision comment:
//   - The database arrives through SQLite's Online Backup API (lib-db-snapshot's
//     rationale applies verbatim: a raw file copy of a live .db can be torn).
//     The source connection is READ-ONLY and nothing here ever writes to the
//     real library or the real config dir.
//   - Media are stand-ins by DEFAULT: one generated PNG per referenced file, at
//     the aspect ratio the database already records (media.width/height for
//     downloaded media, posts.shotW/shotH for the card image). Masonry height
//     reservation and the post-load aspect therefore match the real library
//     while no personal image is ever copied. Files whose dimensions the DB does
//     not know fall back to one shared square placeholder.
//   - Real files are copied ONLY for captureIds named explicitly (--capture),
//     i.e. reproducing a bug on a specific post. Never wholesale. A seed that
//     used it is flagged so the instance can warn on screen, because a
//     screenshot of it carries personal data.
//   - Isolation is checked mechanically before launch (verifyIsolation): the
//     snapshot must carry no absolute path, and every media reference must
//     resolve inside the sandbox library.
//
// Stand-in fidelity, stated so it is not mistaken for full fidelity:
//   - Pixel dimensions are scaled down to `maxDim` on the long side (aspect kept),
//     so decode cost is NOT the real library's. Layout is, because layout is
//     driven by the DB's own shotW/shotH and by the aspect ratio after load.
//   - Video files get no stand-in (a PNG named .mp4 does not play); the poster
//     frame does, which is what cards show. Playback is not reproducible here.
//   - Trashed posts are skipped: their files live under .trash/ and the trash
//     view is driven by the per-post JSON records that live there, which a DB
//     snapshot does not carry.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const os = require('node:os');

const repoRoot = path.join(__dirname, '..');
const appMainDir = path.join(repoRoot, 'app', 'src', 'main');
const { openDatabase } = require(path.join(appMainDir, 'lib-db.ts'));
const { cardImageFile } = require(path.join(appMainDir, 'lib-card-dims.ts'));
const { resolveMediaPath } = require(path.join(appMainDir, 'lib-db-inbox.ts'));

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
// One shared size for every reference whose dimensions the DB does not record
// (the capture screenshot of a post whose card image is its downloaded media,
// and every shared-store avatar). Square: avatars are the bulk of them and are
// displayed in a circle.
const PLACEHOLDER_DIM = 400;
const DEFAULT_MAX_DIM = 512;

// ---- PNG encoding (no deps, mirrors scripts/gen-dummy-library.cts) ----------

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// Solid color with a subtle horizontal gradient, same look as the fixture seed's
// images so a real-data sandbox reads as "generated" at a glance. Deflate level 1:
// every row is identical, so the cheap level costs nothing in size and keeps a
// ten-thousand-image run in the tens of seconds rather than minutes.
function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const row = Buffer.alloc(1 + w * 3); // filter byte 0 + RGB pixels
  for (let x = 0; x < w; x++) {
    const f = 0.75 + (0.25 * x) / w;
    row[1 + x * 3] = Math.round(rgb[0] * f);
    row[2 + x * 3] = Math.round(rgb[1] * f);
    row[3 + x * 3] = Math.round(rgb[2] * f);
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })), pngChunk('IEND', Buffer.alloc(0))]);
}

// Deterministic per filename: the same library re-seeds to the same colors, and
// neighbouring cards differ (a hash, not a counter, so ordering doesn't stripe).
function colorFor(name: string): [number, number, number] {
  const h = crypto.createHash('sha1').update(name).digest();
  // Keep it light and desaturated-ish: 140..235 per channel reads as a
  // placeholder rather than as content.
  return [140 + (h[0] % 96), 140 + (h[1] % 96), 140 + (h[2] % 96)];
}

// ---- snapshot ---------------------------------------------------------------

// SQLite's Online Backup API against a read-only source connection. openDatabase
// runs quick_check but no migrations in readonly mode, so the real database is
// never written to — the sandbox copy is migrated later, when the app opens it.
//
// One caveat, measured rather than assumed: reading a WAL database materializes
// its -shm (and an empty -wal) beside it if the app is not already running, which
// is SQLite's reader bookkeeping, not a change to any data — the .db bytes come
// out identical. The alternative (opening the URI with immutable=1) skips that at
// the price of assuming a file nothing is writing, which is exactly the wrong
// assumption for a live library.
async function snapshotDatabaseFile(srcDbFile: string, destDbFile: string): Promise<{ bytes: number }> {
  if (!fs.existsSync(srcDbFile)) throw new Error(`real database not found: ${srcDbFile}`);
  fs.mkdirSync(path.dirname(destDbFile), { recursive: true });
  // A leftover WAL/SHM beside an overwritten destination would be read as that
  // (now replaced) database's tail.
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(destDbFile + suffix, { force: true });
  const handle = openDatabase(srcDbFile, { readonly: true });
  try {
    await handle.sqlite.backup(destDbFile);
  } finally {
    handle.sqlite.close();
  }
  return { bytes: fs.statSync(destDbFile).size };
}

// ---- stand-in planning ------------------------------------------------------

interface StandinPlan {
  files: Map<string, { width: number; height: number; known: boolean }>;
  videos: string[];
  trashedPosts: number;
  postCount: number;
}

// Every media reference the database holds, paired with the dimensions the
// database knows for it. cardImageFile() is the app's own rule for which file a
// card shows, so shotW/shotH lands on exactly the file it measured.
function planStandins(sqlite: any): StandinPlan {
  const plan: StandinPlan = { files: new Map(), videos: [], trashedPosts: 0, postCount: 0 };
  const mediaByPost = new Map<string, any[]>();
  for (const m of sqlite.prepare('SELECT postId, seq, file, posterFile, width, height, type FROM media ORDER BY postId, seq').all()) {
    let list = mediaByPost.get(m.postId);
    if (!list) mediaByPost.set(m.postId, (list = []));
    list.push(m);
  }

  const add = (file: string | null, width: number | null, height: number | null) => {
    if (!file) return;
    if (VIDEO_EXT.test(file)) {
      plan.videos.push(file);
      return;
    }
    const known = Number.isFinite(width) && Number.isFinite(height) && (width as number) > 0 && (height as number) > 0;
    const prev = plan.files.get(file);
    // A file referenced twice (a shared avatar, a poster) keeps the first KNOWN
    // dimensions it was seen with — a later placeholder must not overwrite them.
    if (prev && (prev.known || !known)) return;
    plan.files.set(file, known ? { width: width as number, height: height as number, known: true } : { width: PLACEHOLDER_DIM, height: PLACEHOLDER_DIM, known: false });
  };

  for (const p of sqlite.prepare('SELECT captureId, image, video, avatarFile, shotW, shotH, trashedAt FROM posts').all()) {
    plan.postCount++;
    if (p.trashedAt) {
      plan.trashedPosts++;
      continue;
    }
    const media = mediaByPost.get(p.captureId) || [];
    const cardFile = cardImageFile({ image: p.image, media });
    if (cardFile) add(cardFile, p.shotW, p.shotH);
    for (const m of media) {
      add(m.file, m.width, m.height);
      if (m.posterFile) add(m.posterFile, m.width, m.height);
    }
    add(p.image, null, null);
    add(p.video, null, null);
    add(p.avatarFile, null, null);
  }
  return plan;
}

// Scale to `maxDim` on the long side, aspect preserved: the app reserves card
// height from the DB's own shotW/shotH and re-measures the aspect after load, so
// the RATIO is what has to survive, not the pixel count.
function scaleDims(width: number, height: number, maxDim: number): [number, number] {
  const long = Math.max(width, height);
  if (long <= maxDim) return [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
  const k = maxDim / long;
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

function writeStandins(destLibrary: string, plan: StandinPlan, opts: { maxDim?: number } = {}): { written: number; placeholders: number; escaped: string[] } {
  const maxDim = opts.maxDim || DEFAULT_MAX_DIM;
  fs.mkdirSync(destLibrary, { recursive: true });
  let written = 0;
  let placeholders = 0;
  const escaped: string[] = [];
  for (const [file, dims] of plan.files) {
    // Same containment rule the app applies when it resolves a record's media
    // reference — a hostile/legacy row must not write outside the sandbox.
    const dest = resolveMediaPath(destLibrary, file);
    if (!dest) {
      escaped.push(file);
      continue;
    }
    const [w, h] = scaleDims(dims.width, dims.height, maxDim);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, makePng(w, h, colorFor(file)));
    written++;
    if (!dims.known) placeholders++;
  }
  return { written, placeholders, escaped };
}

// ---- pinpoint real copies ---------------------------------------------------

// The files one post owns: what has to be real for that post to reproduce.
function filesOfPost(sqlite: any, captureId: string): string[] {
  const p = sqlite.prepare('SELECT captureId, image, video, avatarFile FROM posts WHERE captureId = ?').get(captureId);
  if (!p) return [];
  const files = [p.image, p.video, p.avatarFile];
  for (const m of sqlite.prepare('SELECT file, posterFile FROM media WHERE postId = ? ORDER BY seq').all(captureId)) {
    files.push(m.file, m.posterFile);
  }
  return files.filter((f: string | null): f is string => !!f);
}

// Overwrites the stand-ins for the named posts with the real bytes. This is the
// one path that puts personal images inside the sandbox — the caller records it
// in the seed report so the instance can warn on screen for as long as it lives.
function copyRealMedia(sqlite: any, captureIds: string[], srcLibrary: string, destLibrary: string): { copied: string[]; missing: string[]; unknownIds: string[] } {
  const copied: string[] = [];
  const missing: string[] = [];
  const unknownIds: string[] = [];
  for (const id of captureIds) {
    const files = filesOfPost(sqlite, id);
    if (!files.length) {
      unknownIds.push(id);
      continue;
    }
    for (const file of files) {
      const src = resolveMediaPath(srcLibrary, file);
      const dest = resolveMediaPath(destLibrary, file);
      if (!src || !dest || !fs.existsSync(src)) {
        missing.push(file);
        continue;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(file);
    }
  }
  return { copied, missing, unknownIds };
}

// ---- mechanical isolation check --------------------------------------------

interface IsolationInput {
  dbFile: string;
  configPath: string;
  sandboxLibrary: string;
  realConfigDir: string;
  realSaveFolder: string;
}

// Runs BEFORE the instance is launched: a sandbox that still knows a real path is
// a sandbox that can write to it. Three independent questions, because each has
// its own way of going wrong:
//   1. does the config point anywhere real (saveFolder, and a backup mirror
//      destination the app would start writing to on a schedule)?
//   2. does the snapshot carry an absolute path in its own bytes? (Nothing in
//      the schema stores one today — this is the check that notices when
//      something starts to.)
//   3. does every media reference resolve INSIDE the sandbox library?
function verifyIsolation(input: IsolationInput): { ok: boolean; problems: string[]; checked: { pathNeedles: number; mediaRefs: number } } {
  const problems: string[] = [];

  const cfg = JSON.parse(fs.readFileSync(input.configPath, 'utf8'));
  const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  if (!cfg.saveFolder || norm(cfg.saveFolder) !== norm(input.sandboxLibrary)) problems.push(`config saveFolder is not the sandbox library: ${cfg.saveFolder}`);
  if (cfg.backup && cfg.backup.dir) problems.push(`config carries a backup destination: ${cfg.backup.dir}`);
  if (norm(input.dbFile).startsWith(norm(input.realConfigDir) + '/')) problems.push(`sandbox database sits inside the real config dir: ${input.dbFile}`);
  if (norm(input.sandboxLibrary).startsWith(norm(input.realSaveFolder) + '/')) problems.push(`sandbox library sits inside the real library: ${input.sandboxLibrary}`);

  // Byte scan: the real roots explicitly, plus the home directory as the general
  // case (no absolute user path belongs in this file at all). Both separators —
  // a Windows path can be stored either way.
  const needles = new Set<string>();
  for (const p of [input.realConfigDir, input.realSaveFolder, os.homedir()]) {
    needles.add(p);
    needles.add(p.replace(/\\/g, '/'));
    needles.add(p.replace(/\//g, '\\'));
  }
  const bytes = fs.readFileSync(input.dbFile);
  for (const needle of needles) {
    const at = bytes.indexOf(Buffer.from(needle, 'utf8'));
    if (at >= 0) problems.push(`snapshot contains an absolute path (${needle}) at byte ${at}: ${JSON.stringify(bytes.subarray(Math.max(0, at - 40), at + needle.length + 40).toString('utf8'))}`);
  }

  const handle = openDatabase(input.dbFile, { readonly: true });
  let mediaRefs = 0;
  try {
    const refs: string[] = [];
    for (const p of handle.sqlite.prepare('SELECT image, video, avatarFile FROM posts').all()) refs.push(p.image, p.video, p.avatarFile);
    for (const m of handle.sqlite.prepare('SELECT file, posterFile FROM media').all()) refs.push(m.file, m.posterFile);
    for (const ref of refs) {
      if (!ref) continue;
      mediaRefs++;
      if (path.isAbsolute(ref)) problems.push(`absolute media reference in snapshot: ${ref}`);
      else if (!resolveMediaPath(input.sandboxLibrary, ref)) problems.push(`media reference escapes the sandbox library: ${ref}`);
    }
  } finally {
    handle.sqlite.close();
  }

  return { ok: problems.length === 0, problems, checked: { pathNeedles: needles.size, mediaRefs } };
}

// ---- orchestration ----------------------------------------------------------

interface SeedOptions {
  realConfigDir: string;
  realSaveFolder: string;
  sandboxConfigDir: string;
  sandboxLibrary: string;
  captureIds?: string[];
  maxDim?: number;
  log?: (msg: string) => void;
}

async function seedRealSandbox(opts: SeedOptions) {
  const log = opts.log || (() => {});
  const dbFile = path.join(opts.sandboxConfigDir, 'hologram.db');
  const configPath = path.join(opts.sandboxConfigDir, 'config.json');

  fs.mkdirSync(opts.sandboxConfigDir, { recursive: true });
  fs.mkdirSync(opts.sandboxLibrary, { recursive: true });

  const snap = await snapshotDatabaseFile(path.join(opts.realConfigDir, 'hologram.db'), dbFile);
  log(`snapshot: ${(snap.bytes / 1048576).toFixed(1)} MB via SQLite backup API`);

  const handle = openDatabase(dbFile, { readonly: true });
  let plan: StandinPlan;
  try {
    plan = planStandins(handle.sqlite);
  } finally {
    handle.sqlite.close();
  }
  const standins = writeStandins(opts.sandboxLibrary, plan, { maxDim: opts.maxDim });
  log(`stand-ins: ${standins.written} image(s) (${standins.placeholders} placeholder, ${plan.videos.length} video reference(s) left absent, ${plan.trashedPosts} trashed post(s) skipped)`);

  let realMedia: { copied: string[]; missing: string[]; unknownIds: string[] } = { copied: [], missing: [], unknownIds: [] };
  const captureIds = opts.captureIds || [];
  if (captureIds.length) {
    // Reopened read-write-capable? No: read-only again. Copying reads the source
    // library, and the destination is plain fs — the DB is only consulted for
    // which files a post owns.
    const h2 = openDatabase(dbFile, { readonly: true });
    try {
      realMedia = copyRealMedia(h2.sqlite, captureIds, opts.realSaveFolder, opts.sandboxLibrary);
    } finally {
      h2.sqlite.close();
    }
    log(`real media: ${realMedia.copied.length} file(s) copied for ${captureIds.length} capture(s)`);
    if (realMedia.unknownIds.length) log(`  no such captureId in the snapshot: ${realMedia.unknownIds.join(', ')}`);
    if (realMedia.missing.length) log(`  not found in the real library: ${realMedia.missing.join(', ')}`);
  }

  // Written last so the isolation check reads the config the instance will use.
  fs.writeFileSync(configPath, JSON.stringify({ saveFolder: opts.sandboxLibrary, extensionId: 'testextensionidabcdefghijklmnop' }, null, 2));

  const isolation = verifyIsolation({
    dbFile,
    configPath,
    sandboxLibrary: opts.sandboxLibrary,
    realConfigDir: opts.realConfigDir,
    realSaveFolder: opts.realSaveFolder,
  });
  if (!isolation.ok) {
    const err: any = new Error(`sandbox isolation check FAILED:\n  - ${isolation.problems.join('\n  - ')}`);
    err.problems = isolation.problems;
    throw err;
  }
  log(`isolation check: ok (${isolation.checked.mediaRefs} media reference(s), ${isolation.checked.pathNeedles} path needle(s))`);

  return {
    mode: 'real',
    seededAt: new Date().toISOString(),
    source: { configDir: opts.realConfigDir, saveFolder: opts.realSaveFolder },
    db: { file: dbFile, bytes: snap.bytes, posts: plan.postCount },
    standins: { written: standins.written, placeholders: standins.placeholders, escaped: standins.escaped, videosAbsent: plan.videos.length, trashedSkipped: plan.trashedPosts },
    realMedia: { captureIds, files: realMedia.copied, missing: realMedia.missing, unknownIds: realMedia.unknownIds },
    maxDim: opts.maxDim || DEFAULT_MAX_DIM,
  };
}

module.exports = { seedRealSandbox, snapshotDatabaseFile, planStandins, writeStandins, copyRealMedia, verifyIsolation, scaleDims, makePng, DEFAULT_MAX_DIM, PLACEHOLDER_DIM };
