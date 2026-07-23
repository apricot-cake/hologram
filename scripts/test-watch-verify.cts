'use strict';

// Watch the Hologram save folder and AUTO-VERIFY every new capture against the
// platform's public API (re-fetched via extension/metadata.js). Per capture it
// prints PASS/FAIL with the reasons and a ready-to-paste test-progress row —
// the human only opens pages and clicks/drags; selection criteria come from
// scripts/test-select-posts.cts.
//
//   node scripts/test-watch-verify.cts              # watch until Ctrl+C
//   node scripts/test-watch-verify.cts --recent 5   # one-shot: latest N sidecars
//
// Checks per sidecar:
//   - the paired image file exists
//   - url is the platform's CANONICAL permalink form (no /photo/N, /liked-by …)
//   - identity fields match a live API re-fetch (screenName/displayName/userId/
//     text-prefix/date) — engagement counts drift and are reported as info
//   - media count sanity (saved ≤ live, imageIndex within imageCount)

const fs = require('node:fs');
const path = require('node:path');
// extension/ is TypeScript source; `npm run build` (extension/) compiles it to
// extension/dist/, which this requires directly.
const { fetchPostMetadata } = require('../extension/dist/metadata');
const { configDir, defaultLibraryDir } = require('../native-host/paths.cts');

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

async function verifySidecar(file) {
  let rec: any;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!rec || !rec.captureId) return null; // tag-types.json などの管理ファイル

  const dir = path.dirname(file);
  const base = path.basename(file, '.json');
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

function sidecars(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(dir, f))
    .map((p) => ({ p, m: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.m - a.m)
    .map((e) => e.p);
}

(async () => {
  const dir = saveFolder();
  if (!fs.existsSync(dir)) {
    console.error('保存先フォルダが見つかりません: ' + dir);
    process.exit(1);
  }

  const recentIdx = process.argv.indexOf('--recent');
  if (recentIdx >= 0) {
    const n = Number.parseInt(process.argv[recentIdx + 1], 10) || 1;
    let okAll = true;
    let checked = 0;
    for (const f of sidecars(dir)) {
      if (checked >= n) break;
      const r = await verifySidecar(f);
      if (r === null) continue; // management json — doesn't count
      checked++;
      if (!r) okAll = false;
    }
    console.log(`\n${checked} 件検証 → ${okAll ? 'ALL PASS' : 'FAIL あり'}`);
    process.exit(okAll ? 0 : 1);
  }

  console.log(`監視中: ${dir}`);
  console.log('キャプチャすると自動で検証します（Ctrl+C で終了）\n');
  const seen = new Set(fs.readdirSync(dir));
  const timers = new Map();
  fs.watch(dir, (_event, fname) => {
    if (!fname || !fname.endsWith('.json') || seen.has(fname)) return;
    // bridge は画像/メディアDL後にサイドカーを書く — 書き込み完了を少し待つ
    clearTimeout(timers.get(fname));
    timers.set(
      fname,
      setTimeout(() => {
        seen.add(fname);
        verifySidecar(path.join(dir, fname)).catch((e) => console.error('verify error:', e.message));
      }, 1200),
    );
  });
})();
