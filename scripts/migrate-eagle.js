'use strict';

// One-time Eagle → Corpus migration (WHOLE LIBRARY — "graduate from Eagle").
//
// Iterates Eagle's NATIVE items (<lib>/images/<id>.info/metadata.json), copies
// each VIEWABLE original (images + video) OUT of the (read-only) library into the
// Corpus save folder as a sidecar record, carries over the item's NATIVE Eagle
// tags, and migrates the library's TAG GROUPS (<lib>/metadata.json → tagsGroups)
// to <saveFolder>/tag-groups.json. SNS engagement / author / text / uid is
// overlaid from the engagement-browser.json plugin store (+ the per-item Eagle
// annotation's UID line) when present; items with no SNS URL become plain
// illustration records (image + tags).
//
// VIEWABLE = images (jpg/jpeg/jfif/png/webp/gif/avif/svg) + video (mp4/webm/mov/
// m4v). Everything else (exe, archives, …) is excluded. Videos copy their Eagle
// thumbnail as a poster (record.image) and the video file as record.video.
//
// SAFETY: never writes to / moves / deletes anything under the Eagle library.
// DRY-RUN BY DEFAULT (no --apply → writes nothing, prints the plan). Idempotent
// (captureId = eagle-<itemId>; skips if the sidecar already exists). See
// docs/eagle-migration.md.
//
//   node scripts/migrate-eagle.js --lib "<path to .library>"            (dry-run)
//   node scripts/migrate-eagle.js --lib "<...>" --apply --verify        (write+audit)
//   flags: --tagged-only     only items that have tags or an SNS URL (skip plain refs)
//          --save "<folder>"  override the Corpus save folder (default: config.json)
//          --limit N          cap writes to N NOT-yet-migrated items (re-runs continue the
//                             batch: --limit 20 twice = 40 migrated). The batch is STRATIFIED
//                             (interleaves SNS-url and url-less refs) so a small trial validates
//                             both field-mapping paths, not just the oldest reference images.
//          --csv "<file>"     write the migration plan as a CSV (for review)

const fs = require('fs');
const path = require('path');
const { parsePostUrl } = require('../extension/metadata');
const { configDir } = require('../native-host/paths');

// --- args ---
function parseArgs(argv) {
  const a = { lib: null, apply: false, verify: false, taggedOnly: false, save: null, limit: 0, csv: null };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--apply') a.apply = true;
    else if (t === '--verify') a.verify = true;
    else if (t === '--tagged-only') a.taggedOnly = true;
    else if (t === '--lib') a.lib = argv[++i];
    else if (t === '--save') a.save = argv[++i];
    else if (t === '--limit') a.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    else if (t === '--csv') a.csv = argv[++i];
  }
  return a;
}

function abort(msg) { console.error('ERROR: ' + msg); process.exit(2); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

// Viewable allowlist. Anything not matched (exe, zip, psd, fonts, …) is excluded.
const IMAGE_EXT = /^(jpe?g|jfif|png|webp|gif|avif|svg)$/i;
const VIDEO_EXT = /^(mp4|webm|mov|m4v)$/i;
const VIEWABLE_FILE = /\.(jpe?g|jfif|png|webp|gif|avif|svg|mp4|webm|mov|m4v)$/i;
const isViewable = (ext) => IMAGE_EXT.test(ext) || VIDEO_EXT.test(ext);

function isoFromMs(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}
function isoFromStr(s) { const t = Date.parse(s || ''); return Number.isFinite(t) ? new Date(t).toISOString() : null; }

// Resolve an item's original file. Primary: <lib>/images/<id>.info/<name>.<ext>.
// Fallback: the first non-thumbnail viewable file in the .info dir. null if none.
function resolveImage(lib, id, name, ext) {
  const dir = path.join(lib, 'images', `${id}.info`);
  if (name) {
    const primary = path.join(dir, `${name}.${ext}`);
    if (fs.existsSync(primary)) return primary;
  }
  try {
    const files = fs.readdirSync(dir);
    const hit = files.filter((f) => VIEWABLE_FILE.test(f) && !/_thumbnail\.[a-z0-9]+$/i.test(f));
    if (hit.length) return path.join(dir, hit[0]);
  } catch { /* .info dir missing */ }
  return null;
}

// Eagle's generated poster for a video: <id>.info/<name>_thumbnail.png. null if none.
function resolveThumbnail(lib, id) {
  const dir = path.join(lib, 'images', `${id}.info`);
  try {
    const f = fs.readdirSync(dir).find((x) => /_thumbnail\.(png|jpe?g|webp)$/i.test(x));
    if (f) return path.join(dir, f);
  } catch { /* none */ }
  return null;
}

// The eagle-info-plus plugin wrote a text annotation ("Key: value" lines) into
// each Eagle item. Most keys duplicate structured store fields, but UID / Alt /
// Published are NOT in the store — notably UID, the stable user id for non-pixiv
// platforms (X numeric / bsky did / misskey・mastodon id). Parse it so userId
// survives the migration (the store's `author` is only the numeric id for pixiv).
function parseAnnotation(a) {
  const o = {};
  (a || '').split(/\r?\n/).forEach((l) => { const m = l.match(/^([^:：]+)[:：]\s*(.*)$/); if (m) o[m[1].trim()] = m[2].trim(); });
  return o;
}

// meta = native metadata.json; ov = engagement store overlay ({} when none).
// files = { captureId, image, video, mediaType } resolved by the caller.
// parsed = parsePostUrl(url) (or null) — its screenName is the URL-embedded handle.
function buildRecord(id, meta, ov, platform, files, parsed) {
  const url = meta.url || ov.url || null;
  const hasUrl = !!url;
  const anno = parseAnnotation(meta.annotation);
  const annoAuthor = anno.Author ? anno.Author.replace(/^@/, '') : null;
  // pixiv names carry the work title ("<work> - <author>のイラスト"); strip the trailing author clause.
  const pixivTitle = (platform === 'pixiv' && meta.name) ? String(meta.name).replace(/\s*[-—]\s*[^-—]+の(イラスト|マンガ|うごイラ)\s*$/, '').trim() : null;
  return {
    captureId: files.captureId,
    image: files.image,
    video: files.video || null,                                   // playable file for mediaType:'video'
    url,
    platform: platform || null,
    text: ov.text || null,
    // ref images: Eagle name is the caption. pixiv: work title. other SNS: leave null (name is page-title junk; raw kept in eagleName).
    title: ov.title || pixivTitle || (!hasUrl ? (meta.name || null) : null),
    eagleName: meta.name || null,                                 // raw Eagle filename, preserved losslessly (forensic + search)
    displayName: ov.displayName || null,
    // handle: store author → annotation Author → handle embedded in the URL (X/bsky).
    screenName: ov.author || annoAuthor || (parsed && parsed.screenName) || null,
    // stable user id for ALL platforms: annotation UID → Eagle legacyUid → pixiv numeric author.
    userId: anno.UID || ov.legacyUid || (platform === 'pixiv' ? (ov.author || null) : null),
    likes: ov.likes ?? null,
    reposts: ov.reposts ?? null,
    replies: ov.replies ?? null,
    bookmarks: ov.bookmarks ?? null,
    views: ov.views ?? null,
    quotes: ov.quotes ?? null,
    // post date: real publish time only; never the plugin sync timestamp (ov.modifiedAt). btime for ref images.
    date: isoFromMs(ov.publishedAt) || isoFromStr(ov.legacyPublishedAt) || isoFromStr(anno.Published) || isoFromMs(meta.btime),
    capturedAt: isoFromMs(meta.btime || meta.mtime),             // Eagle 追加日 (identity is captureId, not this)
    updatedAt: isoFromMs(meta.mtime || meta.modificationTime || meta.btime),  // Eagle 変更日; bumped on Corpus edits
    mediaType: files.mediaType,
    media: [],                                                    // image IS the artwork; empty avoids lightbox dup
    lang: null,
    isReply: null, isQuote: null, isThread: null, quotedUrl: null,
    hashtags: Array.isArray(ov.hashtags) ? ov.hashtags : [],
    tags: Array.isArray(meta.tags) ? meta.tags : [],              // NATIVE Eagle tags (definitive)
    status: ov.status || null,
    engagementSyncedAt: ov.engagementSyncedAt ?? null,
    source: 'eagle-migration'                                     // provenance marker
  };
}

function resolveSaveFolder(override) {
  if (override && override.trim()) return override;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) return cfg.saveFolder;
  } catch { /* no config */ }
  return null;
}

// --- main ---
const args = parseArgs(process.argv);
if (!args.lib) abort('--lib "<path to .library>" is required');
const imagesDir = path.join(args.lib, 'images');
if (!fs.existsSync(imagesDir)) abort(`images dir not found: ${imagesDir}`);

const store = readJson(path.join(args.lib, 'plugin-data', 'engagement-browser.json')) || { items: {} };
const storeItems = store.items || {};
const libMeta = readJson(path.join(args.lib, 'metadata.json')) || {};
const tagGroups = (Array.isArray(libMeta.tagsGroups) ? libMeta.tagsGroups : [])
  .map((g) => ({ id: g.id, name: g.name, tags: Array.isArray(g.tags) ? g.tags : [] }));
const saveFolder = resolveSaveFolder(args.save);

const stats = {
  scanned: 0, deleted: 0, nonViewable: 0, imageMissing: 0, unreadable: 0, orphan: 0,
  skippedExisting: 0, skippedUntagged: 0, wouldWrite: 0, withTags: 0, withUrl: 0, video: 0,
  byPlatform: {}
};
const plan = [];

let dirs = [];
try { dirs = fs.readdirSync(imagesDir).filter((d) => d.endsWith('.info')); }
catch (e) { abort(`cannot read images dir: ${e.message}`); }

for (const d of dirs) {
  const id = d.replace(/\.info$/, '');
  let meta = readJson(path.join(imagesDir, d, 'metadata.json'));
  stats.scanned++;
  let isOrphan = false;
  if (!meta) {
    // No metadata.json (orphan / interrupted import). Recover instead of dropping
    // if the .info dir still holds a viewable original — synthesize a minimal meta
    // from the file itself (name/ext from the filename, btime from fs mtime, no tags/url).
    const orphanFile = resolveImage(args.lib, id, null, null);   // directory-scan only
    if (!orphanFile) { stats.unreadable++; continue; }           // truly empty/corrupt → skip
    let st = null; try { st = fs.statSync(orphanFile); } catch { /* ignore */ }
    meta = {
      name: path.basename(orphanFile, path.extname(orphanFile)),
      ext: path.extname(orphanFile).slice(1).toLowerCase(),
      btime: st ? st.mtimeMs : 0, mtime: st ? st.mtimeMs : 0,
      tags: [], url: null, annotation: '', isDeleted: false
    };
    isOrphan = true;
    stats.orphan++;
  }
  if (meta.isDeleted) { stats.deleted++; continue; }
  const ext = String(meta.ext || '').toLowerCase().replace(/^\./, '');
  if (!isViewable(ext)) { stats.nonViewable++; continue; }        // exe / archives / etc.

  const ov = storeItems[id] || {};
  const url = meta.url || ov.url || null;
  const tagged = Array.isArray(meta.tags) && meta.tags.length > 0;
  if (args.taggedOnly && !tagged && !url) { stats.skippedUntagged++; continue; }

  const captureId = `eagle-${id}`;
  if (saveFolder && fs.existsSync(path.join(saveFolder, `${captureId}.json`))) { stats.skippedExisting++; continue; }

  const srcMain = resolveImage(args.lib, id, meta.name, ext);
  if (!srcMain) { stats.imageMissing++; continue; }               // original missing → skip

  const isVideo = VIDEO_EXT.test(ext);
  const destMain = `${captureId}.${ext}`;
  let image, video = null, srcPoster = null, destPoster = null;
  // animated webp (Eagle sets meta.animated) is a gif-like animation, not a still.
  const mediaType = isVideo ? 'video' : ((ext === 'gif' || meta.animated === true) ? 'gif' : 'image');
  if (isVideo) {
    video = destMain;
    srcPoster = resolveThumbnail(args.lib, id);                   // tile poster = Eagle thumbnail
    if (srcPoster) { destPoster = `${captureId}-poster${path.extname(srcPoster).toLowerCase()}`; image = destPoster; }
    else { image = null; }                                        // no poster (rare); tile falls back
  } else {
    image = destMain;
  }

  const parsed = url ? parsePostUrl(url) : null;
  const platform = ov.platform || (parsed && parsed.platform) || null;
  const rec = buildRecord(id, meta, ov, platform, { captureId, image, video, mediaType }, parsed);
  if (isOrphan) rec.orphan = true;                 // recovered without an Eagle metadata.json
  plan.push({ id, captureId, platform, srcMain, destMain, srcPoster, destPoster, rec });
  stats.wouldWrite++;
  if (tagged) stats.withTags++;
  if (url) stats.withUrl++;
  if (isVideo) stats.video++;
  const k = platform || '(none)';
  stats.byPlatform[k] = (stats.byPlatform[k] || 0) + 1;
}

// --limit only caps how many get WRITTEN (trial batch); the survey covers all.
// Stratify so a small trial exercises BOTH SNS (url) and ref-image mapping —
// otherwise the first N are all the oldest url-less refs and --verify "N/N OK"
// validates none of the SNS field mapping. Interleave url-bearing and url-less.
function stratify(items, n) {
  const withUrl = items.filter((p) => p.rec.url);
  const noUrl = items.filter((p) => !p.rec.url);
  const out = [];
  let i = 0, j = 0;
  while (out.length < n && (i < withUrl.length || j < noUrl.length)) {
    if (i < withUrl.length) out.push(withUrl[i++]);
    if (out.length < n && j < noUrl.length) out.push(noUrl[j++]);
  }
  return out;
}
const toWrite = args.limit ? stratify(plan, args.limit) : plan;

// CSV of the plan, for review. UTF-8 BOM so Excel renders Japanese correctly.
function csvCell(v) {
  const s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, items) {
  const cols = ['captureId', 'mediaType', 'platform', 'tags', 'title', 'text', 'displayName', 'screenName',
    'likes', 'date', 'url', 'srcImage', 'destImage'];
  const lines = [cols.join(',')];
  for (const p of items) {
    const r = p.rec;
    lines.push([
      p.captureId, r.mediaType, r.platform || '', (r.tags || []).join(' / '), r.title || '', r.text || '',
      r.displayName || '', r.screenName || '', r.likes ?? '', r.date || '', r.url || '',
      path.basename(p.srcMain), p.destMain
    ].map(csvCell).join(','));
  }
  fs.writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

function printPlan() {
  console.log('=== Eagle → Corpus migration (WHOLE LIBRARY' + (args.apply ? ' — APPLYING' : ' — DRY-RUN') + ') ===');
  console.log('library      :', args.lib);
  console.log('save folder  :', saveFolder || '(NOT CONFIGURED — set it in Corpus or pass --save before --apply)');
  console.log('scanned      :', stats.scanned, 'native items | deleted:', stats.deleted);
  console.log('skipped      : non-viewable(exe等)=' + stats.nonViewable,
    '| image-missing=' + stats.imageMissing, '| unreadable-meta=' + stats.unreadable, '| already-migrated=' + stats.skippedExisting,
    (args.taggedOnly ? '| untagged-skipped=' + stats.skippedUntagged : ''));
  if (stats.unreadable) console.log('  ⚠ WARNING: ' + stats.unreadable + ' item(s) had missing/corrupt metadata.json AND no recoverable media — skipped');
  if (stats.orphan) console.log('  ↪ recovered ' + stats.orphan + ' orphan(s): media present but no metadata.json (filename→title, no tags/url)');
  console.log('WOULD WRITE  :', stats.wouldWrite, 'sidecars  (tagged:', stats.withTags, '| SNS url:', stats.withUrl, '| video:', stats.video, '| orphan:', stats.orphan + ')');
  console.log('             by platform:', JSON.stringify(stats.byPlatform));
  if (args.limit) console.log('LIMIT        : --limit ' + args.limit + ' → writing only first ' + toWrite.length + ' of ' + stats.wouldWrite);
  console.log('tag groups   :', tagGroups.length, tagGroups.map((g) => `${g.name}(${g.tags.length})`).join(' '));
  const accounted = stats.wouldWrite + stats.deleted + stats.nonViewable + stats.imageMissing + stats.unreadable + stats.skippedExisting + stats.skippedUntagged;
  console.log('accounting   :', accounted, '==', stats.scanned, accounted === stats.scanned ? 'OK' : 'MISMATCH');
  console.log('\nsample (first 5 mapped):');
  for (const p of toWrite.slice(0, 5)) {
    const r = p.rec;
    console.log('  •', p.captureId, '| ' + r.mediaType, '| pf=' + (r.platform || 'none'),
      '| tags=[' + (r.tags || []).slice(0, 4).join(',') + ']',
      '| ' + (r.title || r.text || '').slice(0, 24).replace(/\n/g, ' '), '→', p.destMain);
  }
}

if (args.csv) { writeCsv(args.csv, toWrite); console.log('CSV written:', args.csv, '(' + toWrite.length + ' rows)'); }

if (!args.apply) {
  printPlan();
  console.log('\nDRY-RUN complete — nothing written. Re-run with --apply to migrate.');
  process.exit(0);
}

// --- apply ---
if (!saveFolder) abort('save folder not configured; set it in Corpus or pass --save "<folder>" before --apply');
fs.mkdirSync(saveFolder, { recursive: true });
printPlan();
console.log('\n--- APPLYING ---');

// Tag groups travel with the data as <saveFolder>/tag-groups.json (the viewer
// reads it to group the tag filter). Written even on a --limit trial.
try {
  fs.writeFileSync(path.join(saveFolder, 'tag-groups.json'), JSON.stringify({ groups: tagGroups }, null, 2), 'utf8');
  console.log('tag-groups.json written:', tagGroups.length, 'groups');
} catch (e) { console.log('tag-groups.json FAILED:', e.message); }

let done = 0; const failed = [];
for (const p of toWrite) {
  const destJson = path.join(saveFolder, `${p.captureId}.json`);
  try {
    if (fs.existsSync(destJson)) continue;                 // idempotent
    fs.copyFileSync(p.srcMain, path.join(saveFolder, p.destMain));            // original (image or video)
    if (p.srcPoster && p.destPoster) fs.copyFileSync(p.srcPoster, path.join(saveFolder, p.destPoster)); // video poster
    fs.writeFileSync(destJson, JSON.stringify(p.rec, null, 2), 'utf8');       // then sidecar
    done++;
    if (done % 500 === 0) console.log('  …', done, '/', toWrite.length);
  } catch (e) { failed.push({ id: p.id, error: e.message }); }
}
console.log(`migrated ${done} / ${toWrite.length}` + (failed.length ? `, ${failed.length} failed` : ''));
if (failed.length) failed.slice(0, 10).forEach((f) => console.log('  FAIL', f.id, f.error));

if (args.verify) {
  console.log('\n--- VERIFY ---');
  let okCount = 0; const problems = [];
  for (const p of toWrite) {
    const destJson = path.join(saveFolder, `${p.captureId}.json`);
    const destMain = path.join(saveFolder, p.destMain);
    if (!fs.existsSync(destJson)) { problems.push(`${p.captureId}: sidecar missing`); continue; }
    if (!fs.existsSync(destMain)) { problems.push(`${p.captureId}: original missing`); continue; }
    try {
      if (fs.statSync(p.srcMain).size !== fs.statSync(destMain).size) { problems.push(`${p.captureId}: size mismatch`); continue; }
      const rec = JSON.parse(fs.readFileSync(destJson, 'utf8'));
      if (rec.image && !fs.existsSync(path.join(saveFolder, rec.image))) { problems.push(`${p.captureId}: image/poster missing`); continue; }
      const expectPf = rec.url ? (parsePostUrl(rec.url) || {}).platform : null;
      if (rec.platform && expectPf && rec.platform !== expectPf) { problems.push(`${p.captureId}: platform ${rec.platform}!=${expectPf}`); continue; }
      okCount++;
    } catch (e) { problems.push(`${p.captureId}: ${e.message}`); }
  }
  console.log(`verified ${okCount} / ${toWrite.length}` + (problems.length ? `, ${problems.length} problems` : ' — all OK'));
  problems.slice(0, 10).forEach((p) => console.log('  ', p));
  process.exit(problems.length ? 1 : 0);
}
