'use strict';

// One-off repair for records the pre-#377 bulk-intake save left mis-shaped: it
// moved the FIRST downloaded original out of media[] and into `image`, leaving
// media[] empty. Every file is on disk and intact; only the pointers are wrong.
//
//   node scripts/repair-legacy-media-records.cts           # report only (default)
//   node scripts/repair-legacy-media-records.cts --apply   # rewrite the records
//
// Two symptoms, one shape:
//   - a VIDEO post is unshowable end to end (#496) — `image` is the STILL slot,
//     so the card and the detail view hand an mp4 to an <img> and draw nothing,
//     and the poster frame beside it has no field left pointing at it.
//   - a STILL post displays, but as the wrong KIND of picture: a filename ending
//     .jpg in `image` reads as a capture screenshot (records.ts's isScreenshot),
//     so the post's own original is filed as "how the page looked" and sorts to
//     the tail of the lightbox instead of leading it.
//
// Run with the app CLOSED: the database has a single writer (the main process),
// and --apply takes that role for the duration. A dry run only reads and is safe
// to run against a library the app has open.
//
// What it rebuilds, per affected post: one media row per <captureId>-media-N.<ext>
// found on disk, in N order, with <captureId>-poster.<ext> attached to the first
// entry as its posterFile; `image`/`video` are cleared of any filename that has
// just moved into media[]; shotW/shotH are re-measured from what the card will
// now show (for the video records the stored value is the 0/0 "unsizable"
// sentinel fillCardDims wrote when it tried to measure an mp4).
//
// media[].url is NOT recoverable — the announced source URL was only ever kept
// inside media[], which is exactly what these records lost, and no raw payload
// was preserved for them either. It stays null, which costs one thing: the
// extension's per-picture "saved" badge cannot say WHICH pictures of that post
// the library holds (#334). Everything the library shows comes from the files.
//
// normalizePostRecord now refuses to leave a video filename in `image` at all,
// so nothing writes this shape any more. Temporary (pre-release) — delete it
// once the library has no such records left.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configDir } = require('../native-host/paths.cts');
const { openDatabase } = require('../app/src/main/lib-db.ts');
const { readImageDims } = require('../app/src/main/lib-card-dims.ts');
const { isVideoFileName } = require('../native-host/post-record.mts');

// Mirrors media-download.cts's attachment naming: <base>-media-<seq>.<ext> for
// the originals and <base>-poster.<ext> for the still frame beside an animated one.
const MEDIA_FILE = /^(.+)-media-(\d+)\.([a-z0-9]+)$/i;
const POSTER_FILE = /^(.+)-poster\.([a-z0-9]+)$/i;
// A poster is the only thing beside an animated entry that an <img> can show.
const ANIMATED_EXT = /\.(mp4|webm|mov|m4v|zip)$/i;

// A surviving media row, read back so the rebuild can carry its metadata over.
// frames stays the stored JSON TEXT — it goes straight back into the same column.
interface MediaRow {
  url: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  type: string | null;
  posterFile: string | null;
  frames: string | null;
}

function saveFolder(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch {
    /* no config */
  }
  return path.join(os.homedir(), 'Hologram');
}

// captureId -> { media: [{ seq, file }], poster: string | null }, from the save
// folder's root listing alone (attachments never live in a subfolder).
function attachmentsByCapture(folder: string): Map<string, { media: { seq: number; file: string }[]; poster: string | null }> {
  const out = new Map<string, { media: { seq: number; file: string }[]; poster: string | null }>();
  const entry = (id: string) => {
    let e = out.get(id);
    if (!e) out.set(id, (e = { media: [], poster: null }));
    return e;
  };
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return out;
  }
  for (const name of names) {
    const m = MEDIA_FILE.exec(name);
    if (m) {
      entry(m[1]).media.push({ seq: Number(m[2]), file: name });
      continue;
    }
    const p = POSTER_FILE.exec(name);
    if (p) entry(p[1]).poster = name;
  }
  for (const e of out.values()) e.media.sort((a, b) => a.seq - b.seq);
  return out;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const folder = saveFolder();
  const dbFile = path.join(configDir(), 'hologram.db');
  if (!fs.existsSync(dbFile)) {
    console.log('No database:', dbFile);
    return;
  }
  // A dry run must be able to answer "what would this change" about a library
  // that is currently open in the app, so it takes no write lock and runs no
  // migration — it only reads. --apply is the single-writer step, and the app
  // has to be closed for it.
  const handle = openDatabase(dbFile, { readonly: !apply });
  const sqlite = handle.sqlite;

  // Two ways the old shape shows up, and BOTH have to be caught:
  //   - a single-media post kept no media rows at all (its one original went to
  //     `image`), and
  //   - a MULTI-media post kept rows for the rest, so only the first original is
  //     missing. Asking for "no media rows" alone silently skips these — the
  //     tell is `image` naming an attachment file (<captureId>-media-N.<ext>),
  //     which no correct producer ever writes there: a screenshot save puts
  //     <captureId>.jpg in that field and the bulk-intake save leaves it null.
  // Trashed posts are excluded because their files have physically moved into
  // .trash/ — there is nothing at the root to rebuild from.
  const candidates = sqlite
    .prepare(
      `SELECT captureId, image, video FROM posts p WHERE trashedAt IS NULL
         AND (NOT EXISTS (SELECT 1 FROM media m WHERE m.postId = p.captureId) OR p.image GLOB '*-media-[0-9]*.*')`,
    )
    .all() as Array<{ captureId: string; image: string | null; video: string | null }>;
  const onDisk = attachmentsByCapture(folder);
  // What each post's surviving media rows already know. The rebuild orders and
  // renumbers from the files on disk, but the rows that DID survive carry the
  // announced source URL and dimensions — facts nothing on disk can re-derive —
  // so they are carried over by filename rather than thrown away.
  const keptRows = sqlite.prepare('SELECT postId, url, alt, width, height, file, type, posterFile, frames FROM media WHERE postId = ?');
  const clearRows = apply ? sqlite.prepare('DELETE FROM media WHERE postId = ?') : null;

  // Prepared only for --apply: a readonly connection rejects a write statement.
  const write = apply
    ? {
        media: sqlite.prepare('INSERT INTO media (postId, seq, url, alt, width, height, file, type, posterFile, frames) VALUES (?,?,?,?,?,?,?,?,?,?)'),
        post: sqlite.prepare('UPDATE posts SET image = ?, video = ?, shotW = ?, shotH = ? WHERE captureId = ?'),
      }
    : null;

  let repaired = 0;
  for (const post of candidates) {
    const found = onDisk.get(post.captureId);
    if (!found || !found.media.length) continue;

    const files = found.media.map((m) => m.file);
    const kept = new Map((keptRows.all(post.captureId) as MediaRow[]).map((r) => [r.file, r]));
    // Already whole: every file on disk has a row and `image` claims none of
    // them. The candidate query casts wide on purpose, so say nothing here.
    if (kept.size === files.length && !(post.image && files.includes(post.image))) continue;

    // Clear only what has just moved into media[]; a record whose image is an
    // unrelated screenshot keeps it (its media were simply never rowed).
    const image = post.image && !files.includes(post.image) && !isVideoFileName(post.image) ? post.image : null;
    const video = post.video && !files.includes(post.video) ? post.video : null;
    const rows = found.media.map((m, seq) => {
      const had = kept.get(m.file);
      return {
        seq,
        file: m.file,
        url: had?.url ?? null,
        alt: had?.alt ?? null,
        width: had?.width ?? null,
        height: had?.height ?? null,
        frames: had?.frames ?? null,
        // Only the leading entry can own the poster: one -poster.<ext> exists per
        // post, and downloadMedia writes it beside the entry it belongs to.
        posterFile: had?.posterFile ?? (seq === 0 && found.poster && ANIMATED_EXT.test(m.file) ? found.poster : null),
        type: had?.type ?? (isVideoFileName(m.file) ? 'video' : null),
      };
    });
    // Re-measure from what the card will actually show now (the poster), replacing
    // the 0/0 "unsizable" sentinel that measuring an mp4 produced.
    const face = rows[0].posterFile || (ANIMATED_EXT.test(rows[0].file) ? image : rows[0].file);
    const dim = face ? readImageDims(folder, face) : null;

    console.log(`${apply ? 'repair' : 'would repair'} ${post.captureId}`);
    console.log(`  image: ${post.image || 'null'} -> ${image || 'null'}${post.video ? `  video: ${post.video} -> ${video || 'null'}` : ''}`);
    for (const r of rows) console.log(`  media[${r.seq}]: ${r.file}${r.type ? ` (${r.type})` : ''}${r.posterFile ? ` poster=${r.posterFile}` : ''}${kept.has(r.file) ? ' (kept its row)' : ''}`);
    console.log(`  card dims: ${dim ? `${dim.width}x${dim.height}` : 'unsizable'}`);

    if (write && clearRows) {
      sqlite.exec('BEGIN');
      try {
        write.post.run(image, video, dim ? dim.width : 0, dim ? dim.height : 0, post.captureId);
        // Rewritten wholesale rather than patched: seq has to renumber when a
        // file is inserted ahead of the survivors, and `rows` already carries
        // everything those survivors knew.
        clearRows.run(post.captureId);
        for (const r of rows) write.media.run(post.captureId, r.seq, r.url, r.alt, r.width, r.height, r.file, r.type, r.posterFile, r.frames);
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      // The root sidecar, where one still exists, is a second copy of the same
      // wrong shape — left alone it would reintroduce the bug the day the DB is
      // rebuilt from sidecars (the legacy-import path).
      const sidecar = path.join(folder, `${post.captureId}.json`);
      try {
        if (fs.existsSync(sidecar)) {
          const rec = JSON.parse(fs.readFileSync(sidecar, 'utf8').replace(/^\uFEFF/, ''));
          rec.image = image;
          rec.video = video;
          rec.media = rows.map((r) => ({ url: r.url, alt: r.alt, width: r.width, height: r.height, file: r.file, type: r.type, posterFile: r.posterFile, frames: r.frames ? JSON.parse(r.frames) : null }));
          fs.writeFileSync(sidecar, JSON.stringify(rec, null, 2), 'utf8');
          console.log('  sidecar rewritten');
        }
      } catch (err: any) {
        console.log(`  sidecar NOT rewritten: ${err?.message || err}`);
      }
    }
    repaired++;
  }

  sqlite.close();
  if (!repaired) console.log('Nothing to repair.');
  else if (!apply) console.log(`\n${repaired} record(s) would be repaired. Re-run with --apply to write.`);
  else console.log(`\n${repaired} record(s) repaired.`);
}

main();
