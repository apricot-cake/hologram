'use strict';

// アプリのハーネス向けにサンドボックスライブラリをシードする: 保存フォルダに
// メディアファイル、アプリが開くデータベースにレコード。
//
// アプリはSQLite（#5）から投稿を読み、#302以降は保存フォルダを一切スキャン
// しない＝だからそこに投稿ごとのJSONを書いても何もシードしない。レコードは、
// 実際の全プロデューサー（inboxの消費者、インポーター、orphan回復）が使うのと
// 同じwritePost + fillCardDimsの組を通る。これにより、ハーネスのフィクスチャが
// アプリが実際に保存する形からずれずに済む。保存フォルダはハーネスが既に
// 書いたconfigから読むので、呼び出し側が2度名指しする必要はない。
//
//   const { seedLibrary } = require('./lib-seed-library.cts');
//   seedLibrary(configDir, [{ captureId: 'a1', image: 'a1.jpg', ... }]);

const fs = require('node:fs');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { makeTagResolver, preparePostStmts, writePost } = require(path.join(appDir, 'src', 'main', 'lib-db-record-writer.ts'));
const { fillCardDims } = require(path.join(appDir, 'src', 'main', 'lib-card-dims.ts'));
const { fillMediaDims } = require(path.join(appDir, 'src', 'main', 'lib-media-dims.ts'));

function saveFolderOf(configDir: string): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
    return typeof cfg.saveFolder === 'string' && cfg.saveFolder ? cfg.saveFolder : null;
  } catch {
    return null; // まだconfigが無い＝レコードは寸法未測定のまま書かれる
  }
}

// 開いたハンドルを返す。呼び出し側がそれを閉じる前にcreateDbWriterで
// シードを続けられるように（フォルダ、タグ種別）。開いたままにするには
// `close: false`を渡す。
//
// #176: hologram.dbは今は保存フォルダの「中」にあり、configDirにはない
// （ADR 0025）＝アプリ自身のdbFile()はconfig.saveFolderから解決するので、
// ここでconfigDir/hologram.dbへ書くハーネスは、アプリが決して開かないファイルを
// シードしてしまう。だから呼び出し側は、これを呼ぶ「前」に（明示的な
// saveFolderを添えて）config.jsonを書かなければならない＝既存のハーネスは
// メディアファイルのために既にそうしている。
function seedLibrary(configDir: string, records: any[], opts: { close?: boolean } = {}) {
  const saveFolder = saveFolderOf(configDir);
  if (!saveFolder) throw new Error('seedLibrary: config.jsonにまだsaveFolderがありません＝先に書いてください（ハーネスはhologram.dbを置くフォルダが必要です）');
  const handle = openDatabase(path.join(saveFolder, 'hologram.db'));
  const stmts = preparePostStmts(handle.sqlite);
  const resolveTagId = makeTagResolver(handle.sqlite);
  for (const rec of records) writePost(stmts, resolveTagId, fillMediaDims(saveFolder, fillCardDims(saveFolder, rec)));
  if (opts.close !== false) handle.sqlite.close();
  return handle;
}

module.exports = { seedLibrary };
