'use strict';

// SQLite の Online Backup API による DB スナップショット (#5 St8 / #301)。生きた DB が
// WAL の書き込み下にあってもコピーして安全な、一貫したファイルを1つ作る。hologram.db
// （と -wal/-shm）を fs.copyFile で生コピーすると、書きかけの千切れた状態を掴みうる。
// better-sqlite3 の Database#backup() は sqlite3_backup_init/step/finish をそのまま包む
// （13.0.1 で確認済み＝SQLite の C API であって、アプリ層のコピーループではない）。
// 生きたデータベースを写す方法として認められているのはこれだけ。#97 の「生きた .db の
// 生ファイルコピーは禁止」と、唯一の呼び出し元である index.ts の runBackup を参照。
//
// Electron 非依存（better-sqlite3 と node の組み込みだけ）で、lib-db.ts に倣う。

import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

// `sqlite` のデータベースを丸ごと一貫した状態で `destFile` に書く。親ディレクトリが
// なければ作る。前のスナップショットは上書きする＝間引き（最新1世代だけを残す、ファイル
// バックアップジョブと同じ）が欲しい呼び出し元は、自分の間隔でこれを繰り返し呼ぶだけ。
async function snapshotDatabase(sqlite: Database.Database, destFile: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destFile), { recursive: true });
  await sqlite.backup(destFile);
}

export { snapshotDatabase };
