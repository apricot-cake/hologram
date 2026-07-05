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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configDir } = require('../native-host/paths');
const { fetchPostMetadata } = require('../extension/metadata');
const { downloadAvatar, pixivRefererFor } = require('../native-host/media-download');

// Crash-safe sidecar write: tmp + rename, so a reader (or the app's fs.watch in
// the save folder) only ever sees the complete old or complete new file, never a
// torn/zero-byte one. The .tmp suffix is invisible to the watcher's image/json
// regex. Mirrors app/main.js writeSidecarAtomic.
function writeJsonAtomicSync(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function saveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch {
    /* no config */
  }
  return path.join(os.homedir(), 'Corpus');
}

// DL the author avatar into the shared avatars/ store when the record has an
// avatar URL but no local file. Best-effort: returns the folder-relative path
// ('avatars/<hash>.<ext>') on success, else null. pixiv needs a Referer; use
// the stored one or derive it from the i.pximg.net host.
async function ensureAvatarFile(folder, avatarUrl, referer) {
  if (!avatarUrl) return null;
  const ref = referer || pixivRefererFor(avatarUrl);
  try {
    return await downloadAvatar(avatarUrl, ref, folder);
  } catch {
    return null;
  }
}

function listSidecars(folder) {
  return fs.readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.json') && f !== 'config.json' && f !== '.index.json');
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
    let filled = 0,
      skipped = 0,
      failed = 0;
    for (const f of files) {
      const p = path.join(folder, f);
      let rec;
      try {
        rec = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch {
        continue;
      }
      if (!rec.avatar || rec.avatarFile) {
        skipped++;
        continue;
      }
      const af = await ensureAvatarFile(folder, rec.avatar, rec.avatarReferer);
      if (!af) {
        failed++;
        console.log('  no avatar:', f, rec.avatar);
        continue;
      }
      rec.avatarFile = af;
      writeJsonAtomicSync(p, rec);
      filled++;
      console.log('  avatar:', f, '->', af);
    }
    console.log(`\navatars: filled ${filled}, skipped ${skipped}, no-data ${failed}  (folder: ${folder})`);
    return;
  }

  let updated = 0,
    skipped = 0,
    failed = 0;
  for (const f of files) {
    const p = path.join(folder, f);
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      continue;
    }
    if (!rec.url) {
      skipped++;
      continue;
    }

    const missing = rec.text == null && rec.screenName == null;
    if (!missing && !all) {
      skipped++;
      continue;
    }

    const m = await fetchPostMetadata(rec.url);
    // Success = the re-fetch produced an API-only field. screenName/handle are
    // derived from the post URL BEFORE the network call (X sets parsed.screenName,
    // Bluesky sets parsed.handle), so they are NOT evidence the fetch succeeded —
    // a failed X/Bluesky fetch still carries a screenName. Gate on text/likes/date,
    // which only an actual API response can fill; otherwise keep the stored record
    // intact (don't null-destroy text/author/userId/stats/lang). (audit #2)
    if (m.text == null && m.likes == null && m.date == null) {
      failed++;
      console.log('  no data:', f, rec.url);
      continue;
    }

    // Non-destructive merge: `m.X ?? rec.X` keeps the existing value when the
    // re-fetch lacks that field, so a partial fetch never clears stored fields.
    const merged = Object.assign({}, rec, {
      url: m.url || rec.url,
      platform: m.platform || rec.platform,
      text: m.text ?? rec.text,
      title: m.title ?? rec.title, // keep existing (e.g. pixiv work title) if re-fetch lacks it
      displayName: m.displayName ?? rec.displayName,
      screenName: m.screenName ?? rec.screenName,
      userId: m.userId ?? rec.userId,
      avatar: m.avatar ?? rec.avatar, // keep existing avatar if re-fetch lacks it
      followers: m.followers ?? rec.followers,
      authorCreatedAt: m.authorCreatedAt ?? rec.authorCreatedAt,
      likes: m.likes ?? rec.likes,
      reposts: m.reposts ?? rec.reposts,
      replies: m.replies ?? rec.replies,
      bookmarks: m.bookmarks ?? rec.bookmarks,
      views: m.views ?? rec.views,
      date: m.date || rec.date,
      mediaType: m.mediaType ?? rec.mediaType,
      lang: m.lang ?? rec.lang,
      // Reply/quote/thread flags are tri-state (null = "not this kind"). We only
      // reach here on a successful re-fetch (text/likes/date present), so the fresh
      // flags are authoritative — a stored `true` must NOT shadow a fresh `null`
      // (e.g. the post is genuinely no longer detected as a reply). Don't `?? rec`.
      isReply: m.isReply,
      isQuote: m.isQuote,
      isThread: m.isThread,
      quotedUrl: m.quotedUrl ?? rec.quotedUrl,
    });

    // Fill the avatar image if we have a URL but no local file yet (merged keeps
    // rec.avatarFile via the spread). The fresh fetch carries avatarReferer for pixiv.
    if (merged.avatar && !merged.avatarFile) {
      const af = await ensureAvatarFile(folder, merged.avatar, m.avatarReferer);
      if (af) merged.avatarFile = af;
    }

    writeJsonAtomicSync(p, merged);
    updated++;
    console.log('  updated:', f, '->', m.screenName, JSON.stringify((m.text || '').slice(0, 30)));
  }

  console.log(`\nbackfilled ${updated}, skipped ${skipped}, no-data ${failed}  (folder: ${folder})`);
})();
