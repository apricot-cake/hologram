'use strict';

// メタデータが欠けているレコード（例えば拡張機能の service worker が古く
// なっている間にキャプチャされたもの）に対し、保存済みの投稿 URL を使って
// メタデータを取り直す。ライブラリのデータベース内の各レコードを書き換える。
// captureId/image/capturedAt/tags は保つ。
//
//   node scripts/backfill-metadata.cts          # メタデータが欠けているレコードだけ
//   node scripts/backfill-metadata.cts --all     # すべてのレコードを取り直す
//   node scripts/backfill-metadata.cts --avatars # API は叩かない: 欠けているアバターをDLするだけ
//
// アプリを「閉じた」状態で実行すること: データベースの書き手は1つだけ
// （メインプロセス）であり、このツールは実行中その役を引き受ける。
//
// アバター: 取り直し（または --all）は、レコードにアバター URL があるのに
// まだローカルファイルが無い場合、投稿者アバターを <base>-avatar.<ext> へ
// ダウンロードする — キャプチャ時に native host がやることをなぞっている
// ので、後追い・インポートされたレコードもアバターを得る。--avatars は、
// メタデータはすでにある既存レコード向けの近道（ネットワークでのメタデータ
// 取得は無く、アバター画像のダウンロードだけ）。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configDir } = require('../native-host/paths.mts');
const { fetchPostMetadata } = require('../extension/utils/extractor/index.ts');
const { downloadAvatar, pixivRefererFor } = require('../native-host/media-download.mts');
const { openDatabase } = require('../app/src/main/lib-db.ts');
const { postsFromDb } = require('../app/src/main/lib-db-query.ts');
const { makeTagResolver, preparePostStmts, writePost } = require('../app/src/main/lib-db-record-writer.ts');

function saveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg.saveFolder) return cfg.saveFolder;
  } catch {
    /* no config */
  }
  return path.join(os.homedir(), 'Hologram');
}

// レコードにアバター URL はあるがローカルファイルが無い場合、投稿者アバターを
// 共有の avatars/ ストアへダウンロードする。ベストエフォート: 成功すれば
// フォルダ相対パス（'avatars/<hash>.<ext>'）を返し、失敗すれば null。pixiv
// には Referer が要る。保存済みのものを使うか、i.pximg.net のホストから
// 導出する。
async function ensureAvatarFile(folder, avatarUrl, referer) {
  if (!avatarUrl) return null;
  const ref = referer || pixivRefererFor(avatarUrl);
  try {
    return await downloadAvatar(avatarUrl, ref, folder);
  } catch {
    return null;
  }
}

(async () => {
  const folder = saveFolder();
  const all = process.argv.includes('--all');
  const avatarsOnly = process.argv.includes('--avatars');
  // #176: hologram.db は今や configDir ではなく保存フォルダの中にある。
  const dbFile = path.join(folder, 'hologram.db');
  if (!fs.existsSync(dbFile)) {
    console.log('データベースが無い:', dbFile);
    return;
  }
  const handle = openDatabase(dbFile);
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  const save = (rec: any) => writePost(stmts, resolveTagId, rec);
  const records = await postsFromDb(handle.sqlite);

  // --avatars: メタデータ取得はせず、欠けているアバター画像を埋めるだけ。
  if (avatarsOnly) {
    let filled = 0,
      skipped = 0,
      failed = 0;
    for (const rec of records) {
      if (!rec.avatar || rec.avatarFile) {
        skipped++;
        continue;
      }
      const af = await ensureAvatarFile(folder, rec.avatar, rec.avatarReferer);
      if (!af) {
        failed++;
        console.log('  アバター無し:', rec.captureId, rec.avatar);
        continue;
      }
      rec.avatarFile = af;
      save(rec);
      filled++;
      console.log('  アバター:', rec.captureId, '->', af);
    }
    console.log(`\nアバター: 埋めた${filled}件、スキップ${skipped}件、データ無し${failed}件（フォルダ: ${folder}）`);
    handle.sqlite.close();
    return;
  }

  let updated = 0,
    skipped = 0,
    failed = 0;
  for (const rec of records) {
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
    // 成功＝取り直しが API 専用のフィールドを生んだこと。screenName/handle は
    // ネットワーク呼び出しの「前」に投稿 URL から導出される（X は
    // parsed.screenName を、Bluesky は parsed.handle を設定する）ので、
    // これらは取得成功の証拠には「ならない」— 失敗した X/Bluesky の取得でも
    // screenName は運ばれる。実際の API 応答でしか埋まらない text/likes/date
    // をゲートにする。そうでなければ保存済みのレコードをそのまま保つ
    // （text/author/userId/stats/lang を null で破壊しない）。（監査 #2）
    if (m.text == null && m.likes == null && m.date == null) {
      failed++;
      console.log('  データ無し:', rec.captureId, rec.url);
      continue;
    }

    // 非破壊的なマージ: `m.X ?? rec.X` は、取り直しにそのフィールドが無い場合
    // 既存の値を保つ。これにより部分的な取得が保存済みのフィールドを消すことは
    // 決して無い。
    const merged = Object.assign({}, rec, {
      url: m.url || rec.url,
      platform: m.platform || rec.platform,
      text: m.text ?? rec.text,
      title: m.title ?? rec.title, // 取り直しに無ければ既存を保つ（例: pixiv の作品タイトル）
      displayName: m.displayName ?? rec.displayName,
      screenName: m.screenName ?? rec.screenName,
      userId: m.userId ?? rec.userId,
      avatar: m.avatar ?? rec.avatar, // 取り直しに無ければ既存のアバターを保つ
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
      // 返信/引用/スレッドのフラグは3値（null＝「この種別ではない」）。ここへ
      // 到達するのは取り直しが成功した時だけ（text/likes/date が存在する）
      // なので、新しいフラグの方が権威を持つ — 保存済みの `true` が新しい
      // `null` を覆い隠してはならない（例えば、その投稿が本当にもう返信として
      // 検出されなくなった場合）。`?? rec` にしないこと。
      isReply: m.isReply,
      isQuote: m.isQuote,
      isThread: m.isThread,
      quotedUrl: m.quotedUrl ?? rec.quotedUrl,
    });

    // URL はあるがまだローカルファイルが無ければアバター画像を埋める
    // （merged はスプレッド経由で rec.avatarFile を保っている）。新しい取得は
    // pixiv 向けの avatarReferer を運ぶ。
    if (merged.avatar && !merged.avatarFile) {
      const af = await ensureAvatarFile(folder, merged.avatar, m.avatarReferer);
      if (af) merged.avatarFile = af;
    }

    save(merged);
    updated++;
    console.log('  更新:', rec.captureId, '->', m.screenName, JSON.stringify((m.text || '').slice(0, 30)));
  }

  console.log(`\n後追い更新${updated}件、スキップ${skipped}件、データ無し${failed}件（フォルダ: ${folder}）`);
  handle.sqlite.close();
})();
