'use strict';

// Watch the library for new captures and AUTO-VERIFY each against the platform's
// public API (re-fetched via extension/utils/metadata.ts). Per capture it prints
// PASS/FAIL with the reasons and a one-line summary of the cell — the human only
// opens pages and clicks/drags; selection criteria come from
// scripts/test-select-posts.cts.
//
//   node scripts/test-watch-verify.cts              # watch until Ctrl+C
//   node scripts/test-watch-verify.cts --recent 5   # one-shot: latest N records
//
// Records come from the library database, opened read-only so this can run while
// the app has it open (the app is the single writer). Watch mode polls: a capture
// lands as a DB row now, and SQLite has no filesystem event to hook — the inbox
// file appearing is not the same instant as the app applying it.
//
// Checks per record:
//   - the image file it points at exists
//   - url is the platform's CANONICAL permalink form (no /photo/N, /liked-by …)
//   - identity fields match a live API re-fetch (screenName/displayName/userId/
//     text-prefix/date) — engagement counts drift and are reported as info
//   - media count sanity (saved ≤ live, imageIndex within imageCount)

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { fetchPostMetadata } = require('../extension/utils/metadata.ts');
const { configDir, defaultLibraryDir } = require('../native-host/paths.cts');

const POLL_MS = 2000;

// Read-only handle: never take the writer role away from the running app.
function openReadOnly() {
  const file = path.join(configDir(), 'hologram.db');
  if (!fs.existsSync(file)) {
    console.error('ライブラリのデータベースが見つかりません: ' + file);
    process.exit(1);
  }
  return new Database(file, { readonly: true, fileMustExist: true });
}

// The fields this tool compares, plus the media rows and tag names the record
// shape carries. Newest capture first, matching the app's own ordering.
function readRecords(db, limit) {
  const rows = db.prepare('SELECT captureId, image, video, url, platform, text, displayName, screenName, userId, likes, reposts, replies, date, capturedAt FROM posts ORDER BY capturedAt DESC LIMIT ?').all(limit);
  const media = db.prepare('SELECT url, alt, width, height, file FROM media WHERE postId = ? ORDER BY seq');
  for (const rec of rows) rec.media = media.all(rec.captureId);
  return rows;
}

function saveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch {
    /* default below */
  }
  return defaultLibraryDir();
}

const CANON = {
  x: /^https:\/\/x\.com\/(?:[^/]+\/status\/\d+|i\/web\/status\/\d+)$/,
  bluesky: /^https:\/\/bsky\.app\/profile\/[^/]+\/post\/[^/?#]+$/,
  misskey: /^https?:\/\/[^/]+\/notes\/[^/?#]+$/,
  mastodon: /^https?:\/\/[^/]+\/@[^/]+\/\d[\w-]*$/,
  pixiv: /^https:\/\/www\.pixiv\.net\/artworks\/\d+$/,
};

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function verifyRecord(rec: any, dir: string) {
  if (!rec || !rec.captureId) return null;
  const base = rec.captureId;
  const issues: any[] = [];
  const info: any[] = [];

  const imgFile = rec.image || rec.video;
  if (!imgFile) issues.push('image/video フィールドなし');
  else if (!fs.existsSync(path.join(dir, imgFile))) issues.push(`ペア画像なし: ${imgFile}`);

  if (!rec.url) {
    issues.push('url なし');
  } else {
    const re = CANON[rec.platform];
    if (re && !re.test(rec.url)) issues.push(`url がパーマリンク形式でない: ${rec.url}`);
  }

  if (rec.url && rec.platform) {
    let live: any = null;
    try {
      live = await fetchPostMetadata(rec.url);
    } catch {
      /* below */
    }
    if (!live || (!live.screenName && !live.text && !live.date)) {
      info.push('liveメタ取得不可（API照合スキップ）');
    } else {
      for (const k of ['screenName', 'displayName', 'userId']) {
        if (rec[k] != null && live[k] != null && String(rec[k]) !== String(live[k])) {
          issues.push(`${k} 不一致: saved=${rec[k]} live=${live[k]}`);
        }
      }
      const st = norm(rec.text);
      const lt = norm(live.text);
      if (st && lt && !(lt.startsWith(st.slice(0, 60)) || st.startsWith(lt.slice(0, 60)))) {
        issues.push(`text 不一致: "${st.slice(0, 30)}…" / "${lt.slice(0, 30)}…"`);
      }
      if (rec.date && live.date && rec.date !== live.date) issues.push(`date 不一致: ${rec.date} vs ${live.date}`);

      const counts = ['likes', 'reposts', 'replies'].filter((k) => rec[k] != null && live[k] != null).map((k) => `${k} ${rec[k]}→${live[k]}`);
      if (counts.length) info.push(counts.join(' '));

      const liveN = (live.media || []).length;
      const savedN = (rec.media || []).length;
      if (savedN > liveN && liveN > 0) issues.push(`media 数が過大: saved=${savedN} live=${liveN}`);
      if (rec.imageCount != null) {
        if (rec.imageCount !== liveN && liveN > 0) issues.push(`imageCount=${rec.imageCount} だが live media=${liveN}`);
        if (rec.imageIndex != null && (rec.imageIndex < 1 || rec.imageIndex > rec.imageCount)) {
          issues.push(`imageIndex=${rec.imageIndex} が範囲外 (1..${rec.imageCount})`);
        }
        info.push(`imageIndex=${rec.imageIndex ?? 'null'}/${rec.imageCount}`);
      }
      info.push(`media live=${liveN} saved=${savedN}`);
    }
  }

  const ok = issues.length === 0;
  console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} ${base} [${rec.platform || '?'}] ${rec.url || ''}`);
  for (const i of issues) console.log(`   - ${i}`);
  if (info.length) console.log(`   (${info.join(' / ')})`);
  console.log(`   進捗行: | A-?? | ${ok ? 'OK' : 'NG'} | ${rec.url || ''}${issues.length ? ' — ' + issues.join('、') : ''} |`);
  return ok;
}

(async () => {
  const dir = saveFolder();
  if (!fs.existsSync(dir)) {
    console.error('保存先フォルダが見つかりません: ' + dir);
    process.exit(1);
  }
  const db = openReadOnly();

  const recentIdx = process.argv.indexOf('--recent');
  if (recentIdx >= 0) {
    const n = Number.parseInt(process.argv[recentIdx + 1], 10) || 1;
    let okAll = true;
    let checked = 0;
    for (const rec of readRecords(db, n)) {
      const r = await verifyRecord(rec, dir);
      if (r === null) continue;
      checked++;
      if (!r) okAll = false;
    }
    console.log(`\n${checked} 件検証 → ${okAll ? 'ALL PASS' : 'FAIL あり'}`);
    db.close();
    process.exit(okAll ? 0 : 1);
  }

  console.log(`監視中: ${path.join(configDir(), 'hologram.db')}`);
  console.log('キャプチャすると自動で検証します（Ctrl+C で終了）\n');
  const seen = new Set(readRecords(db, 1000).map((r: any) => r.captureId));
  setInterval(async () => {
    let fresh: any[] = [];
    try {
      fresh = readRecords(db, 20).filter((r: any) => !seen.has(r.captureId));
    } catch (e: any) {
      console.error('read error:', e.message);
      return;
    }
    for (const rec of fresh.reverse()) {
      seen.add(rec.captureId);
      await verifyRecord(rec, dir).catch((e: any) => console.error('verify error:', e.message));
    }
  }, POLL_MS);
})();
