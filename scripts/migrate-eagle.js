'use strict';

// One-time Eagle → Corpus migration (WHOLE LIBRARY — "graduate from Eagle").
//
// Iterates Eagle's NATIVE items (<lib>/images/<id>.info/metadata.json), copies
// each original still image OUT of the (read-only) library into the Corpus save
// folder as a sidecar record, carries over the item's NATIVE Eagle tags, and
// migrates the library's TAG GROUPS (<lib>/metadata.json → tagsGroups) to
// <saveFolder>/tag-groups.json. SNS engagement / author / text is overlaid from
// the engagement-browser.json plugin store (matched by item id) when present;
// items with no SNS URL become plain illustration records (image + tags).
//
// SAFETY: never writes to / moves / deletes anything under the Eagle library.
// DRY-RUN BY DEFAULT (no --apply → writes nothing, prints the plan). Idempotent
// (captureId = eagle-<itemId>; skips if the sidecar already exists). See
// docs/eagle-migration.md.
//
//   node scripts/migrate-eagle.js --lib "<path to .library>"            (dry-run)
//   node scripts/migrate-eagle.js --lib "<...>" --apply                 (write)
//   node scripts/migrate-eagle.js --lib "<...>" --apply --verify        (+ audit)
//   flags: --tagged-only     only items that have tags or an SNS URL (skip plain refs)
//          --save "<folder>"  override the Corpus save folder (default: config.json)
//          --limit N          cap the writes to the first N items (trial batch)
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

// jfif is just JPEG; include it. mp4/svg/etc. are skipped (psimg can't render them).
const STILL_EXT = /^(jpe?g|jfif|png|webp|gif)$/i;
const STILL_FILE = /\.(jpe?g|jfif|png|webp|gif)$/i;

function isoFromMs(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

// Deterministic 0..999 offset from the item id, added to capturedAt so two items
// sharing the same base time don't collide on the viewer's url|capturedAt key.
function hashOffset(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 1000;
}

// Resolve an item's original image on disk. Primary: <lib>/images/<id>.info/<name>.<ext>
// (name+ext from the native metadata). Fallback: the first non-thumbnail still
// image in the .info dir (covers name-sanitization / ext mismatches). null if none.
function resolveImage(lib, id, name, ext) {
  const dir = path.join(lib, 'images', `${id}.info`);
  if (name) {
    const primary = path.join(dir, `${name}.${ext}`);
    if (fs.existsSync(primary)) return primary;
  }
  try {
    const files = fs.readdirSync(dir);
    const imgs = files.filter((f) => STILL_FILE.test(f) && !/_thumbnail\.[a-z0-9]+$/i.test(f));
    if (imgs.length) return path.join(dir, imgs[0]);
  } catch { /* .info dir missing */ }
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

// meta = native metadata.json (source of truth for tags/url/time/name/annotation).
// ov   = engagement-browser store item (overlay; {} when the item has no SNS data).
function buildRecord(id, meta, ov, platform, captureId, imageBasename) {
  const url = meta.url || ov.url || null;
  const hasUrl = !!url;
  const anno = parseAnnotation(meta.annotation);
  const annoAuthor = anno.Author ? anno.Author.replace(/^@/, '') : null;
  return {
    captureId,
    image: imageBasename,
    url,
    platform: platform || null,
    text: ov.text || null,
    title: ov.title || (!hasUrl ? (meta.name || null) : null),   // ref images: use Eagle name
    displayName: ov.displayName || null,
    screenName: ov.author || annoAuthor || null,                  // handle (pixiv: numeric id)
    userId: platform === 'pixiv' ? (ov.author || null) : (anno.UID || null),  // stable user id (all platforms)
    likes: ov.likes ?? null,
    reposts: ov.reposts ?? null,
    replies: ov.replies ?? null,
    bookmarks: ov.bookmarks ?? null,
    views: ov.views ?? null,
    quotes: ov.quotes ?? null,
    date: isoFromMs(ov.publishedAt) || isoFromMs(ov.modifiedAt) || isoFromMs(meta.btime),
    capturedAt: isoFromMs((meta.btime || meta.mtime || Date.parse('2020-01-01')) + hashOffset(id)),
    mediaType: 'image',
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
  scanned: 0, deleted: 0, nonStill: 0, imageMissing: 0,
  skippedExisting: 0, skippedUntagged: 0, wouldWrite: 0, withTags: 0, withUrl: 0,
  byPlatform: {}
};
const plan = [];

let dirs = [];
try { dirs = fs.readdirSync(imagesDir).filter((d) => d.endsWith('.info')); }
catch (e) { abort(`cannot read images dir: ${e.message}`); }

for (const d of dirs) {
  const id = d.replace(/\.info$/, '');
  const meta = readJson(path.join(imagesDir, d, 'metadata.json'));
  if (!meta) continue;
  stats.scanned++;
  if (meta.isDeleted) { stats.deleted++; continue; }
  const ext = String(meta.ext || '').toLowerCase().replace(/^\./, '');
  if (!STILL_EXT.test(ext)) { stats.nonStill++; continue; }      // mp4/svg/etc — psimg can't render

  const ov = storeItems[id] || {};
  const url = meta.url || ov.url || null;
  const tagged = Array.isArray(meta.tags) && meta.tags.length > 0;
  if (args.taggedOnly && !tagged && !url) { stats.skippedUntagged++; continue; }

  const captureId = `eagle-${id}`;
  if (saveFolder && fs.existsSync(path.join(saveFolder, `${captureId}.json`))) { stats.skippedExisting++; continue; }

  const srcImage = resolveImage(args.lib, id, meta.name, ext);
  if (!srcImage) { stats.imageMissing++; continue; }             // no renderable original → skip

  const parsed = url ? parsePostUrl(url) : null;
  const platform = ov.platform || (parsed && parsed.platform) || null;
  const destImage = `${captureId}.${ext}`;
  const rec = buildRecord(id, meta, ov, platform, captureId, destImage);
  plan.push({ id, captureId, platform, srcImage, destImage, rec });
  stats.wouldWrite++;
  if (tagged) stats.withTags++;
  if (url) stats.withUrl++;
  const k = platform || '(none)';
  stats.byPlatform[k] = (stats.byPlatform[k] || 0) + 1;
}

// --limit only caps how many get WRITTEN (trial batch); the survey covers all.
const toWrite = args.limit ? plan.slice(0, args.limit) : plan;

// CSV of the plan, for review. UTF-8 BOM so Excel renders Japanese correctly.
function csvCell(v) {
  const s = v == null ? '' : String(v).replace(/\r?\n/g, ' ');
  return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function writeCsv(file, items) {
  const cols = ['captureId', 'platform', 'tags', 'title', 'text', 'displayName', 'screenName',
    'likes', 'quotes', 'date', 'url', 'srcImage', 'destImage'];
  const lines = [cols.join(',')];
  for (const p of items) {
    const r = p.rec;
    lines.push([
      p.captureId, r.platform || '', (r.tags || []).join(' / '), r.title || '', r.text || '',
      r.displayName || '', r.screenName || '', r.likes ?? '', r.quotes ?? '',
      r.date || '', r.url || '', path.basename(p.srcImage), p.destImage
    ].map(csvCell).join(','));
  }
  fs.writeFileSync(file, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

function printPlan() {
  console.log('=== Eagle → Corpus migration (WHOLE LIBRARY' + (args.apply ? ' — APPLYING' : ' — DRY-RUN') + ') ===');
  console.log('library      :', args.lib);
  console.log('save folder  :', saveFolder || '(NOT CONFIGURED — set it in Corpus or pass --save before --apply)');
  console.log('scanned      :', stats.scanned, 'native items | deleted:', stats.deleted);
  console.log('skipped      : non-still(mp4/svg)=' + stats.nonStill,
    '| image-missing=' + stats.imageMissing, '| already-migrated=' + stats.skippedExisting,
    (args.taggedOnly ? '| untagged-skipped=' + stats.skippedUntagged : ''));
  console.log('WOULD WRITE  :', stats.wouldWrite, 'sidecars  (tagged:', stats.withTags, '| with SNS url:', stats.withUrl + ')');
  console.log('             by platform:', JSON.stringify(stats.byPlatform));
  if (args.limit) console.log('LIMIT        : --limit ' + args.limit + ' → writing only first ' + toWrite.length + ' of ' + stats.wouldWrite);
  console.log('tag groups   :', tagGroups.length, tagGroups.map((g) => `${g.name}(${g.tags.length})`).join(' '));
  const accounted = stats.wouldWrite + stats.deleted + stats.nonStill + stats.imageMissing + stats.skippedExisting + stats.skippedUntagged;
  console.log('accounting   :', accounted, '==', stats.scanned, accounted === stats.scanned ? 'OK' : 'MISMATCH');
  console.log('\nsample (first 5 mapped):');
  for (const p of toWrite.slice(0, 5)) {
    const r = p.rec;
    console.log('  •', p.captureId, '| pf=' + (r.platform || 'none'),
      '| tags=[' + (r.tags || []).slice(0, 4).join(',') + ']',
      '| ' + (r.title || r.text || '').slice(0, 28).replace(/\n/g, ' '),
      '| ' + path.basename(p.srcImage), '→', p.destImage);
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
  const destImg = path.join(saveFolder, p.destImage);
  try {
    if (fs.existsSync(destJson)) continue;                 // idempotent
    fs.copyFileSync(p.srcImage, destImg);                  // image first
    fs.writeFileSync(destJson, JSON.stringify(p.rec, null, 2), 'utf8');  // then sidecar
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
    const destImg = path.join(saveFolder, p.destImage);
    if (!fs.existsSync(destJson)) { problems.push(`${p.captureId}: sidecar missing`); continue; }
    if (!fs.existsSync(destImg)) { problems.push(`${p.captureId}: image missing`); continue; }
    try {
      if (fs.statSync(p.srcImage).size !== fs.statSync(destImg).size) { problems.push(`${p.captureId}: size mismatch`); continue; }
      const rec = JSON.parse(fs.readFileSync(destJson, 'utf8'));
      const expectPf = rec.url ? (parsePostUrl(rec.url) || {}).platform : null;
      if (rec.platform && expectPf && rec.platform !== expectPf) { problems.push(`${p.captureId}: platform ${rec.platform}!=${expectPf}`); continue; }
      okCount++;
    } catch (e) { problems.push(`${p.captureId}: ${e.message}`); }
  }
  console.log(`verified ${okCount} / ${toWrite.length}` + (problems.length ? `, ${problems.length} problems` : ' — all OK'));
  problems.slice(0, 10).forEach((p) => console.log('  ', p));
  process.exit(problems.length ? 1 : 0);
}
