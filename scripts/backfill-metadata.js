'use strict';

// Re-fetch metadata for sidecars that are missing it (e.g. captured while the
// extension's service worker was stale), using the stored post URL. Rewrites
// each sidecar in place, preserving captureId/image/capturedAt/tags.
//
//   node scripts/backfill-metadata.js          # only sidecars missing metadata
//   node scripts/backfill-metadata.js --all     # re-fetch every sidecar

const fs = require('fs');
const os = require('os');
const path = require('path');
const { configDir } = require('../native-host/paths');
const { fetchPostMetadata } = require('../extension/metadata');

function saveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch { /* no config */ }
  return path.join(os.homedir(), 'Corpus');
}

(async () => {
  const folder = saveFolder();
  const all = process.argv.includes('--all');
  let files;
  try {
    files = fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.json') && f !== 'config.json' && f !== '.index.json');
  } catch {
    console.log('No save folder:', folder);
    return;
  }

  let updated = 0, skipped = 0, failed = 0;
  for (const f of files) {
    const p = path.join(folder, f);
    let rec;
    try { rec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    if (!rec.url) { skipped++; continue; }

    const missing = rec.text == null && rec.screenName == null;
    if (!missing && !all) { skipped++; continue; }

    const m = await fetchPostMetadata(rec.url);
    if (!m.screenName && !m.text && !m.date) { failed++; console.log('  no data:', f, rec.url); continue; }

    const merged = Object.assign({}, rec, {
      url: m.url || rec.url,
      platform: m.platform || rec.platform,
      text: m.text,
      title: m.title ?? rec.title,                 // keep existing (e.g. pixiv work title) if re-fetch lacks it
      displayName: m.displayName,
      screenName: m.screenName,
      userId: m.userId,
      likes: m.likes,
      reposts: m.reposts,
      replies: m.replies,
      bookmarks: m.bookmarks,
      views: m.views,
      date: m.date || rec.date,
      mediaType: m.mediaType,
      lang: m.lang,
      isReply: m.isReply,
      isQuote: m.isQuote,
      isThread: m.isThread,
      quotedUrl: m.quotedUrl
    });
    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
    updated++;
    console.log('  updated:', f, '->', m.screenName, JSON.stringify((m.text || '').slice(0, 30)));
  }

  console.log(`\nbackfilled ${updated}, skipped ${skipped}, no-data ${failed}  (folder: ${folder})`);
})();
