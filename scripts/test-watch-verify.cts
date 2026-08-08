'use strict';

// Watch the library for new captures and AUTO-VERIFY each against the platform's
// public API (re-fetched via extension/utils/extractor/index.ts). Per capture it prints
// PASS/FAIL with the reasons and a one-line summary of the cell — the human only
// opens pages and clicks/drags; selection criteria come from
// scripts/test-select-posts.cts.
//
//   node scripts/test-watch-verify.cts                  # watch until Ctrl+C
//   node scripts/test-watch-verify.cts --recent 5       # one-shot: latest N records
//   node scripts/test-watch-verify.cts --id <captureId> # one-shot: one record
//
// Records come from the library database, opened read-only so this can run while
// the app has it open (the app is the single writer). Watch mode polls: a capture
// lands as a DB row now, and SQLite has no filesystem event to hook — the inbox
// file appearing is not the same instant as the app applying it.
//
// verifyRecord is also `require()`d directly by scripts/e2e-capture-test.cts,
// which has no running Electron app to drain inbox -> DB and instead verifies
// straight from the inbox envelope it already read (#486).
//
// Checks per record:
//   - every local file the record points at exists (screenshot, video, each
//     media[] original and its poster, the author avatar)
//   - url is the platform's CANONICAL permalink form (no /photo/N, /liked-by …)
//   - identity fields match a live API re-fetch (screenName/displayName/userId/
//     text-prefix/date) — engagement counts drift and are reported as info
//   - media count sanity (saved ≤ live, imageIndex within imageCount)
// plus a "saved values" line of the fields no API can confirm (capturedAt, mediaType,
// lang, the reply/quote/thread flags, tags) for the human's own eyes — the
// manual half of test-plan.md's common verification items.
//
// This is the whole of what scripts/verify-store.py used to do (#60). That
// script was a second, Python implementation of this same comparison, still
// written against the pre-#5 assumption that a record's picture is one `image`
// field and that only X / Bluesky / Misskey exist; it is gone, and its two
// unique abilities (target one captureId, print the stored fields) live here.

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');
const { configDir, defaultLibraryDir } = require('../native-host/paths.mts');

const POLL_MS = 2000;

// Read-only handle: never take the writer role away from the running app.
// #176: hologram.db lives inside the save folder now, not configDir (ADR 0025).
function openReadOnly() {
  const file = path.join(saveFolder(), 'hologram.db');
  if (!fs.existsSync(file)) {
    console.error('ライブラリのデータベースが見つかりません: ' + file);
    process.exit(1);
  }
  return new Database(file, { readonly: true, fileMustExist: true });
}

// The fields this tool compares, plus the ones it only prints for the human.
// Selected explicitly (not SELECT *) so a schema change surfaces here as a
// missing column rather than as a silently absent check.
const COLUMNS = 'captureId, image, video, url, platform, text, title, displayName, screenName, userId, avatarFile, likes, reposts, replies, bookmarks, views, date, capturedAt, mediaType, lang, isReply, isQuote, isThread, quotedUrl, trashedAt';

// Attach the media rows and tag names the record shape carries, so a DB row
// reads the same way as the inbox envelope e2e-capture-test.cts passes in.
function attach(db, rows) {
  const media = db.prepare('SELECT url, alt, width, height, file, posterFile FROM media WHERE postId = ? ORDER BY seq');
  // rowid = insertion order, which is the order writePost() stored tags[] in
  // (post_tags has no seq column) — same read order lib-db-query.ts uses.
  const tags = db.prepare('SELECT t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid');
  for (const rec of rows) {
    rec.media = media.all(rec.captureId);
    rec.tags = tags.all(rec.captureId).map((t: any) => t.name);
  }
  return rows;
}

// Newest capture first, matching the app's own ordering. Trashed posts are
// excluded: their files have physically moved into .trash/, so every one of
// them would report its pictures missing.
function readRecords(db, limit) {
  return attach(db, db.prepare(`SELECT ${COLUMNS} FROM posts WHERE trashedAt IS NULL ORDER BY capturedAt DESC LIMIT ?`).all(limit));
}

// One record by captureId — the "check exactly this capture" entry point. A
// trashed record is returned here on purpose: asking for it by name is asking
// about that record, not about the newest N.
function readRecordById(db, captureId) {
  return attach(db, db.prepare(`SELECT ${COLUMNS} FROM posts WHERE captureId = ?`).all(captureId));
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

// A tri-state flag, printed as itself: null ("not this kind of post") is a
// distinct answer from false and has to stay readable as one.
const flag = (v) => (v == null ? 'null' : v ? 'true' : 'false');

// Every local file the record points at. `image` alone stopped being that set
// when media[] became the home of a post's own originals (#377): a record can
// name several downloads and hold none of them while the screenshot slot still
// looks fine. ugoira frames are entries INSIDE the saved zip, not files on
// disk, so they are not listed here. avatarFile is folder-relative
// ('avatars/<hash>.<ext>') and joins the same way.
function pointedFiles(rec: any): string[] {
  const media = (rec.media || []).flatMap((m: any) => [m && m.file, m && m.posterFile]);
  return [rec.image, rec.video, ...media, rec.avatarFile].filter(Boolean);
}

async function verifyRecord(rec: any, dir: string) {
  if (!rec || !rec.captureId) return null;
  const base = rec.captureId;
  const issues: any[] = [];
  const info: any[] = [];

  const files = pointedFiles(rec);
  if (rec.trashedAt) {
    // Its files live in .trash/ now, so looking for them beside the library
    // would report every one of them missing.
    info.push('ゴミ箱の中（ファイル検査はスキップ）');
  } else if (!files.length) {
    issues.push('保存ファイルを1つも指していない');
  } else {
    for (const name of files) {
      if (!fs.existsSync(path.join(dir, name))) issues.push(`ファイルなし: ${name}`);
    }
  }

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
    // Did the re-fetch actually reach the platform? screenName/handle is NOT
    // evidence that it did — every extractor derives it from the post URL
    // BEFORE the network call, so a failed fetch comes back carrying one (the
    // same trap backfill-metadata.cts's audit #2 documents). Gate on the
    // API-only fields instead, and on metaError, which is the extractor's own
    // word for why it has no post. Getting this wrong is quiet in the worst
    // way: the tool prints PASS after comparing the record's author against a
    // value re-derived from that record's own url.
    const reached = live && !live.metaError && (live.text != null || live.date != null || live.likes != null);
    if (!reached) {
      info.push(`liveメタ取得不可（API照合スキップ${live && live.metaError ? `: ${live.metaError}` : ''}）`);
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

      const counts = ['likes', 'reposts', 'replies', 'bookmarks', 'views'].filter((k) => rec[k] != null && live[k] != null).map((k) => `${k} ${rec[k]}→${live[k]}`);
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
  // The fields no API can confirm, printed for the human beside the automatic
  // checks — test-plan.md's common verification items keeps these as a manual row, and it can
  // only stay manual if the values are actually in front of the person reading.
  const tags = (rec.tags || []).join(',');
  console.log(`   保存値: capturedAt=${rec.capturedAt || 'null'} mediaType=${rec.mediaType || 'null'} lang=${rec.lang || 'null'} isReply=${flag(rec.isReply)} isQuote=${flag(rec.isQuote)} isThread=${flag(rec.isThread)}${rec.quotedUrl ? ` quotedUrl=${rec.quotedUrl}` : ''}${tags ? ` tags=${tags}` : ''}`);
  console.log(`   進捗行: | A-?? | ${ok ? 'OK' : 'NG'} | ${rec.url || ''}${issues.length ? ' — ' + issues.join('、') : ''} |`);
  return ok;
}

// Guarded so scripts/e2e-capture-test.cts can `require()` this file for
// verifyRecord alone (its records come from inbox envelopes, not hologram.db —
// see #486) without also running the DB-backed CLI body below.
if (require.main === module) {
  (async () => {
    const dir = saveFolder();
    if (!fs.existsSync(dir)) {
      console.error('保存先フォルダが見つかりません: ' + dir);
      process.exit(1);
    }
    const db = openReadOnly();

    const idIdx = process.argv.indexOf('--id');
    const recentIdx = process.argv.indexOf('--recent');
    if (idIdx >= 0 || recentIdx >= 0) {
      const captureId = idIdx >= 0 ? process.argv[idIdx + 1] : null;
      if (idIdx >= 0 && !captureId) {
        console.error('--id には captureId が要ります');
        process.exit(2);
      }
      const n = recentIdx >= 0 ? Number.parseInt(process.argv[recentIdx + 1], 10) || 1 : 1;
      const records = captureId ? readRecordById(db, captureId) : readRecords(db, n);
      if (!records.length) {
        console.error(captureId ? `レコードが見つかりません: ${captureId}` : 'ライブラリにレコードがありません');
        db.close();
        process.exit(2);
      }
      let okAll = true;
      let checked = 0;
      for (const rec of records) {
        const r = await verifyRecord(rec, dir);
        if (r === null) continue;
        checked++;
        if (!r) okAll = false;
      }
      console.log(`\n${checked} 件検証 → ${okAll ? 'ALL PASS' : 'FAIL あり'}`);
      db.close();
      process.exit(okAll ? 0 : 1);
    }

    console.log(`監視中: ${path.join(saveFolder(), 'hologram.db')}`);
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
}

module.exports.verifyRecord = verifyRecord;
