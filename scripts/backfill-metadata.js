'use strict';

// Re-fetch metadata for sidecars that are missing it (e.g. captured while the
// extension's service worker was stale), using the stored post URL. Rewrites
// each sidecar in place, preserving captureId/image/capturedAt/tags.
//
//   node scripts/backfill-metadata.js          # only sidecars missing metadata
//   node scripts/backfill-metadata.js --all     # re-fetch every sidecar
//   node scripts/backfill-metadata.js --avatars # no API: just DL missing avatars
//
// Avatars: a re-fetch (or --all) downloads the author avatar to <base>-avatar.<ext>
// when the record has an avatar URL but no local file yet — mirroring what the
// native host does at capture time, so backfilled/imported records get an avatar
// too. --avatars is the fast path for existing records whose metadata is already
// present (no network metadata fetch, only the avatar image download).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { configDir } = require('../native-host/paths');
const { fetchPostMetadata } = require('../extension/metadata');
const { downloadAvatar, pixivRefererFor } = require('../native-host/media-download');

function saveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch { /* no config */ }
  return path.join(os.homedir(), 'Corpus');
}

// DL the author avatar to <base>-avatar.<ext> when the record has an avatar URL
// but no local file. Best-effort: returns the filename on success, else null.
// pixiv needs a Referer; use the stored one or derive it from the i.pximg.net host.
async function ensureAvatarFile(folder, base, avatarUrl, referer) {
  if (!avatarUrl) return null;
  const ref = referer || pixivRefererFor(avatarUrl);
  try { return await downloadAvatar(avatarUrl, ref, folder, base); }
  catch { return null; }
}

function listSidecars(folder) {
  return fs.readdirSync(folder).filter(
    (f) => f.toLowerCase().endsWith('.json') && f !== 'config.json' && f !== '.index.json'
  );
}

(async () => {
  const folder = saveFolder();
  const all = process.argv.includes('--all');
  const avatarsOnly = process.argv.includes('--avatars');
  let files;
  try {
    files = listSidecars(folder);
  } catch {
    console.log('No save folder:', folder);
    return;
  }

  // --avatars: no metadata fetch, just fill in missing avatar images.
  if (avatarsOnly) {
    let filled = 0, skipped = 0, failed = 0;
    for (const f of files) {
      const p = path.join(folder, f);
      let rec;
      try { rec = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      if (!rec.avatar || rec.avatarFile) { skipped++; continue; }
      const base = path.basename(f, '.json');
      const af = await ensureAvatarFile(folder, base, rec.avatar, rec.avatarReferer);
      if (!af) { failed++; console.log('  no avatar:', f, rec.avatar); continue; }
      rec.avatarFile = af;
      fs.writeFileSync(p, JSON.stringify(rec, null, 2), 'utf8');
      filled++;
      console.log('  avatar:', f, '->', af);
    }
    console.log(`\navatars: filled ${filled}, skipped ${skipped}, no-data ${failed}  (folder: ${folder})`);
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
      avatar: m.avatar ?? rec.avatar,                 // keep existing avatar if re-fetch lacks it
      followers: m.followers ?? rec.followers,
      authorCreatedAt: m.authorCreatedAt ?? rec.authorCreatedAt,
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

    // Fill the avatar image if we have a URL but no local file yet (merged keeps
    // rec.avatarFile via the spread). The fresh fetch carries avatarReferer for pixiv.
    if (merged.avatar && !merged.avatarFile) {
      const base = path.basename(f, '.json');
      const af = await ensureAvatarFile(folder, base, merged.avatar, m.avatarReferer);
      if (af) merged.avatarFile = af;
    }

    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
    updated++;
    console.log('  updated:', f, '->', m.screenName, JSON.stringify((m.text || '').slice(0, 30)));
  }

  console.log(`\nbackfilled ${updated}, skipped ${skipped}, no-data ${failed}  (folder: ${folder})`);
})();
