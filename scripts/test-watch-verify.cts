'use strict';

// ライブラリを監視して新しいcaptureを見つけ、それぞれをプラットフォームの公開API
// （extension/utils/extractor/index.ts経由で再取得）に対して自動検証する。captureごとに
// PASS/FAILと理由、1行サマリーを出力する。
//
//   node scripts/test-watch-verify.cts                  # Ctrl+Cまで監視
//   node scripts/test-watch-verify.cts --recent 5       # 単発: 最新N件のレコード
//   node scripts/test-watch-verify.cts --id <captureId> # 単発: レコード1件
//
// レコードはライブラリのデータベースから読む。読み取り専用で開くので、アプリが
// 開いたままでも実行できる（アプリが唯一の書き込み手）。監視モードはポーリング
// する: captureは今やDBの行として着地し、SQLiteにはフックできるファイルシステム
// イベントが無い＝inboxファイルが現れる瞬間と、アプリがそれを適用する瞬間は
// 同じではない。
//
// レコードごとの検査:
//   - レコードが指す全てのローカルファイルが存在する（ローカル画像、動画、
//     各media[]の原本とそのposter、投稿者のアバター）
//   - urlがプラットフォームの正規のパーマリンク形式である（/photo/N、/liked-by
//     などではない）
//   - 身元系のフィールドが実際のAPI再取得と一致する（screenName/displayName/
//     userId/本文の先頭/date）＝エンゲージメント数は変動するので情報として報告する
//     だけ
//   - メディア数の健全性（saved ≤ live、imageCountの範囲内のimageIndex）
// に加えて、どのAPIでも確認できないフィールド（capturedAt、mediaType、lang、
// 返信/引用/スレッドのフラグ、tags）の「保存値」行を人間の目のために出す＝
// test-plan.mdの共通検証項目のうち手動で残る半分。
//
// これはかつてscripts/verify-store.pyがしていたことの全て（#60）。あのスクリプト
// は同じ比較のPythonによる二重実装で、レコードの画像は`image`フィールド1つのみ、
// 存在するプラットフォームを固定列挙する#5以前の前提のまま書かれて
// いた。今は無く、その2つの固有の能力（1つのcaptureIdを狙う、保存済みフィールドを
// 表示する）がここに生きている。

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');
const { configDir, defaultLibraryDir } = require('../native-host/paths.mts');

const POLL_MS = 2000;

// 読み取り専用ハンドル: 稼働中のアプリから書き込み手の役割を絶対に奪わない。
// #176: hologram.db は今は configDir ではなく保存フォルダの中にある。
function openReadOnly() {
  const file = path.join(saveFolder(), 'hologram.db');
  if (!fs.existsSync(file)) {
    console.error('ライブラリのデータベースが見つかりません: ' + file);
    process.exit(1);
  }
  return new Database(file, { readonly: true, fileMustExist: true });
}

// このツールが比較するフィールドと、人間向けに表示するだけのフィールド。
// （SELECT *ではなく）明示的に選ぶことで、スキーマ変更がここでは列の欠落として
// 表面化する。黙って検査が抜け落ちるのではなく。
const COLUMNS = 'captureId, image, video, url, platform, text, title, displayName, screenName, userId, avatarFile, likes, reposts, replies, bookmarks, views, date, capturedAt, mediaType, lang, isReply, isQuote, isThread, quotedUrl, trashedAt';

// レコードの形が運ぶmediaの行とタグ名を添付し、DBの行がe2e-capture-test.ctsが
// 渡すinboxエンベロープと同じように読めるようにする。
function attach(db, rows) {
  const media = db.prepare('SELECT url, alt, width, height, file, posterFile FROM media WHERE postId = ? ORDER BY seq');
  // rowid = 挿入順で、これはwritePost()がtags[]を保存した順（post_tagsにseq列は
  // 無い）＝lib-db-query.tsが使うのと同じ読み取り順。
  const tags = db.prepare('SELECT t.name AS name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid');
  for (const rec of rows) {
    rec.media = media.all(rec.captureId);
    rec.tags = tags.all(rec.captureId).map((t: any) => t.name);
  }
  return rows;
}

// アプリ自身の並び順に合わせ、新しいcaptureを先頭に。ゴミ箱に入った投稿は除外
// する: そのファイルは物理的に.trash/へ移動済みなので、全件が画像なしとして
// 報告されてしまう。
function readRecords(db, limit) {
  return attach(db, db.prepare(`SELECT ${COLUMNS} FROM posts WHERE trashedAt IS NULL ORDER BY capturedAt DESC LIMIT ?`).all(limit));
}

// captureId1件を狙う＝「まさにこのcaptureだけを検査する」入口。ゴミ箱に入った
// レコードもここでは意図的に返す: 名前で頼むことは、そのレコードそのものについて
// 聞いているのであって、最新N件について聞いているのではない。
function readRecordById(db, captureId) {
  return attach(db, db.prepare(`SELECT ${COLUMNS} FROM posts WHERE captureId = ?`).all(captureId));
}

function saveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch {
    /* 下の既定値へ */
  }
  return defaultLibraryDir();
}

const CANON = {
  x: /^https:\/\/x\.com\/(?:[^/]+\/status\/\d+|i\/web\/status\/\d+)$/,
  bluesky: /^https:\/\/bsky\.app\/profile\/[^/]+\/post\/[^/?#]+$/,
  pixiv: /^https:\/\/www\.pixiv\.net\/artworks\/\d+$/,
};

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

// 三値フラグをそのまま表示する: null（「この種の投稿ではない」）はfalseとは別の
// 答えであり、そう読めるままにしておかなければならない。
const flag = (v) => (v == null ? 'null' : v ? 'true' : 'false');

// レコードが指す全てのローカルファイル。media[]が投稿自身の原本の置き場になって
// 以降（#377）、`image`だけではその集合ではなくなった: レコードは複数のダウン
// ロードを名指ししつつ、そのどれも保持しないことがありうる。ugoiraのフレームは保存されたzipの
// 「中」のエントリであってディスク上のファイルではないので、ここには列挙しない。
// avatarFileはフォルダ相対（'avatars/<hash>.<ext>'）で、同じ流儀で結合する。
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
    // そのファイルは今は.trash/にあるので、ライブラリの隣で探すと全件が
    // 見つからないと報告されてしまう。
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
      /* 下で処理 */
    }
    // 再取得は実際にプラットフォームへ届いたか？ screenName/ハンドルはそれの
    // 証拠には「ならない」＝どのextractorもネットワーク呼び出しの「前」に投稿
    // URLからそれを導出するので、失敗した取得もそれを持って帰ってくる（これは
    // backfill-metadata.ctsのaudit #2が記録しているのと同じ罠）。代わりにAPI
    // だけが持つフィールドと、投稿を得られなかった理由をextractor自身が語る
    // metaErrorでゲートする。ここを間違えると最悪の形で静かに壊れる: ツールは、
    // レコードの投稿者をそのレコード自身のurlから再導出した値と比較した上で
    // PASSを出してしまう。
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
  // どのAPIでも確認できないフィールドを、自動検査の隣に人間向けに表示する＝
  // test-plan.mdの共通検証項目はこれらを手動の行として残していて、値が実際に
  // 読む人の目の前にあって初めて手動のままでいられる。
  const tags = (rec.tags || []).join(',');
  console.log(`   保存値: capturedAt=${rec.capturedAt || 'null'} mediaType=${rec.mediaType || 'null'} lang=${rec.lang || 'null'} isReply=${flag(rec.isReply)} isQuote=${flag(rec.isQuote)} isThread=${flag(rec.isThread)}${rec.quotedUrl ? ` quotedUrl=${rec.quotedUrl}` : ''}${tags ? ` tags=${tags}` : ''}`);
  console.log(`   進捗行: | A-?? | ${ok ? 'OK' : 'NG'} | ${rec.url || ''}${issues.length ? ' — ' + issues.join('、') : ''} |`);
  return ok;
}

// 単体テストがこのファイルを verifyRecord だけのために `require()`できるよう、
// 下のDB前提のCLI本体まで一緒に動かさないようガードする。
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
        console.error('読み取りエラー:', e.message);
        return;
      }
      for (const rec of fresh.reverse()) {
        seen.add(rec.captureId);
        await verifyRecord(rec, dir).catch((e: any) => console.error('検証エラー:', e.message));
      }
    }, POLL_MS);
  })();
}

module.exports.verifyRecord = verifyRecord;
