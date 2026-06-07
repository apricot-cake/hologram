'use strict';

// One-time Eagle → Corpus migration. Reads the Eagle library's
// plugin-data/engagement-browser.json + copies the original image files OUT of
// the (read-only) library into the Corpus save folder as sidecar records.
//
// SAFETY: never writes to / moves / deletes anything under the Eagle library.
// DRY-RUN BY DEFAULT (no --apply → writes nothing, prints the plan). Idempotent
// (captureId = eagle-<itemId>; skips if the sidecar already exists). Never
// overwrites an existing Corpus sidecar. See docs/eagle-migration.md.
//
//   node scripts/migrate-eagle.js --lib "<path to .library>"            (dry-run)
//   node scripts/migrate-eagle.js --lib "<...>" --apply                 (write)
//   node scripts/migrate-eagle.js --lib "<...>" --apply --verify        (+ audit)
//   flags: --include-nonpost  migrate non-post URLs as platform:null (default: skip)
//          --save "<folder>"  override the Corpus save folder (default: config.json)
//          --limit N          cap the plan to the first N items (trial batch)

const fs = require('fs');
const path = require('path');
const { parsePostUrl } = require('../extension/metadata');
const { configDir } = require('../native-host/paths');

// --- args ---
function parseArgs(argv) {
  const a = { lib: null, apply: false, includeNonpost: false, verify: false, save: null, limit: 0 };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--apply') a.apply = true;
    else if (t === '--include-nonpost') a.includeNonpost = true;
    else if (t === '--verify') a.verify = true;
    else if (t === '--lib') a.lib = argv[++i];
    else if (t === '--save') a.save = argv[++i];
    else if (t === '--limit') a.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
  }
  return a;
}

function abort(msg) { console.error('ERROR: ' + msg); process.exit(2); }

const STILL_EXT = /^(jpe?g|png|webp|gif)$/i;

function isoFromMs(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

// Deterministic 0..999 offset from the item id, added to capturedAt so two items
// sharing the same modifiedAt don't collide on the viewer's url|capturedAt key.
function hashOffset(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 1000;
}

// Resolve an item's original image on disk. Primary: <lib>/images/<id>.info/<name>.<ext>
// (name+ext from the store record). Fallback: the first non-thumbnail still image
// in the .info dir (covers name-sanitization / ext mismatches). null if none.
function resolveImage(lib, id, name, ext) {
  const dir = path.join(lib, 'images', `${id}.info`);
  if (name) {
    const primary = path.join(dir, `${name}.${ext}`);
    if (fs.existsSync(primary)) return primary;
  }
  try {
    const files = fs.readdirSync(dir);
    const imgs = files.filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f) && !/_thumbnail\.[a-z0-9]+$/i.test(f));
    if (imgs.length) return path.join(dir, imgs[0]);
  } catch { /* .info dir missing */ }
  return null;
}

function buildRecord(id, r, platform, captureId, imageBasename) {
  return {
    captureId,
    image: imageBasename,
    url: r.url || null,
    platform: platform || null,
    text: r.text || null,
    title: r.title || null,
    displayName: r.displayName || null,
    screenName: r.author || null,                       // pixiv: userId; x/bsky: handle
    userId: platform === 'pixiv' ? (r.author || null) : null,
    likes: r.likes ?? null,
    reposts: r.reposts ?? null,
    replies: r.replies ?? null,
    bookmarks: r.bookmarks ?? null,
    views: r.views ?? null,
    date: isoFromMs(r.publishedAt) || isoFromMs(r.modifiedAt),
    capturedAt: isoFromMs((r.modifiedAt || Date.parse('2020-01-01')) + hashOffset(id)),
    mediaType: 'image',
    media: [],                                          // image IS the artwork; empty avoids lightbox dup
    lang: null,
    isReply: null, isQuote: null, isThread: null, quotedUrl: null,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    status: r.status || null,
    engagementSyncedAt: r.engagementSyncedAt ?? null,
    source: 'eagle-migration'                           // provenance marker
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
const storePath = path.join(args.lib, 'plugin-data', 'engagement-browser.json');
let store;
try { store = JSON.parse(fs.readFileSync(storePath, 'utf8')); }
catch (e) { abort(`could not read ${storePath}: ${e.message}`); }
const items = store.items || {};
const saveFolder = resolveSaveFolder(args.save);

const stats = {
  urlItems: 0, parseable: 0, unparseable: 0, nonpostSkipped: 0,
  nonStillSkipped: 0, imageMissing: 0, skippedExisting: 0, wouldWrite: 0,
  byPlatform: {}
};
const plan = [];

for (const [id, r] of Object.entries(items)) {
  if (!r || !r.url) continue;
  stats.urlItems++;
  const parsed = parsePostUrl(r.url);
  const platform = r.platform || (parsed && parsed.platform) || null;
  const ext = String(r.ext || '').toLowerCase().replace(/^\./, '');

  if (!STILL_EXT.test(ext)) { stats.nonStillSkipped++; continue; }      // svg/mp4/etc — psimg can't render
  if (!parsed) {
    stats.unparseable++;
    if (!args.includeNonpost) { stats.nonpostSkipped++; continue; }     // non-post URL → skip by default
  } else {
    stats.parseable++;
  }

  const captureId = `eagle-${id}`;
  if (saveFolder && fs.existsSync(path.join(saveFolder, `${captureId}.json`))) { stats.skippedExisting++; continue; }

  const srcImage = resolveImage(args.lib, id, r.name, ext);
  if (!srcImage) { stats.imageMissing++; continue; }                    // no renderable original → skip

  const destImage = `${captureId}.${ext}`;
  const rec = buildRecord(id, r, platform, captureId, destImage);
  plan.push({ id, captureId, platform, srcImage, destImage, rec });
  stats.wouldWrite++;
  const k = platform || '(null)';
  stats.byPlatform[k] = (stats.byPlatform[k] || 0) + 1;
}

// The survey/accounting above covers the WHOLE library; --limit only caps how
// many of the mapped items actually get written (trial batch).
const toWrite = args.limit ? plan.slice(0, args.limit) : plan;

function printPlan() {
  console.log('=== Eagle → Corpus migration (DRY-RUN' + (args.apply ? ' DISABLED — APPLYING' : '') + ') ===');
  console.log('library      :', args.lib);
  console.log('save folder  :', saveFolder || '(NOT CONFIGURED — set it in Corpus or pass --save before --apply)');
  console.log('store items  :', Object.keys(items).length, '| url-bearing:', stats.urlItems);
  console.log('parseable    :', stats.parseable, '| unparseable(non-post):', stats.unparseable,
    args.includeNonpost ? '(included as platform:null)' : `(skipped ${stats.nonpostSkipped})`);
  console.log('skipped      : non-still(svg/mp4)=' + stats.nonStillSkipped,
    '| image-missing=' + stats.imageMissing, '| already-migrated=' + stats.skippedExisting);
  console.log('WOULD WRITE  :', stats.wouldWrite, 'sidecars  by platform:', JSON.stringify(stats.byPlatform));
  if (args.limit) console.log('LIMIT        :', '--limit ' + args.limit + ' → writing only first ' + toWrite.length + ' of ' + stats.wouldWrite);
  // sanity: every url item is accounted for
  const accounted = stats.wouldWrite + stats.nonStillSkipped + stats.imageMissing + stats.skippedExisting + stats.nonpostSkipped;
  console.log('accounting   :', accounted, '==', stats.urlItems, accounted === stats.urlItems ? 'OK' : 'MISMATCH');
  console.log('\nsample (first 5 mapped):');
  for (const p of toWrite.slice(0, 5)) {
    const r = p.rec;
    console.log('  •', p.captureId, '| pf=' + (r.platform || 'null'), '| ' + (r.title || r.text || '').slice(0, 36).replace(/\n/g, ' '),
      '| likes=' + (r.likes ?? '-'), '| ' + path.basename(p.srcImage), '→', p.destImage);
  }
  console.log('\nfirst 8 would-write files:');
  for (const p of toWrite.slice(0, 8)) console.log('  ', p.destImage, '+', p.captureId + '.json');
}

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
let done = 0; const failed = [];
for (const p of toWrite) {
  const destJson = path.join(saveFolder, `${p.captureId}.json`);
  const destImg = path.join(saveFolder, p.destImage);
  try {
    if (fs.existsSync(destJson)) continue;                 // idempotent
    fs.copyFileSync(p.srcImage, destImg);                  // image first
    fs.writeFileSync(destJson, JSON.stringify(p.rec, null, 2), 'utf8');  // then sidecar
    done++;
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
      const srcSize = fs.statSync(p.srcImage).size;
      const dstSize = fs.statSync(destImg).size;
      if (srcSize !== dstSize) { problems.push(`${p.captureId}: size ${dstSize}!=${srcSize}`); continue; }
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
