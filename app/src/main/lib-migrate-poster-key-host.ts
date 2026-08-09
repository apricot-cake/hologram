'use strict';

// ⚠️ 足場＝リリース前に削除する（削除は #791 が追う）。
//
// インスタンス単位の2つのプラットフォーム（misskey / mastodon）について、保存済みの posterKey を
// #791 より前のホスト無しの形（`<platform>:<id>`）から、query.ts の userKey() が今作るホスト付き
// の形（`<platform>:<host>:<id>`）へ、1回だけ書き換える＝そもそもアクターの id になぜホストが要る
// のかは、あの関数のヘッダのコメントを参照。データベースごとに1回だけ走り（下の store_state の
// ゲート）、index.ts の ensureDb() から、ハンドルを開いた直後に呼ばれる。
//
// 触るのは、posterKey を投稿から実時間で導くのではなくデータとして永続化しているテーブルだけ。
// poster_tags、poster_folder_items、poster_alias_group_members、それと
// poster_alias_groups.primaryKey（aliases.ts の merge() により、これは常にそのグループの成員の
// キーのどれかなので、poster_alias_group_members と歩調を揃えて動かないと、グループの「主キーは
// 成員である」という不変条件が壊れる）。
//
// 古いキーに対するホストは、userKey() が今日それを計算するのと同じ posts の行から読み戻す
// （platform ＋ userId、userId が空なら platform ＋ screenName）＝query.ts の userKey が使うのと
// 同一の id の規則。ホストを解決できないキー（一致する投稿がすべて既に削除されているか、どれも
// URL を持たない）はそのままにする。userKey() はまさにその場合に同じホスト無しの形を代わりに
// 使うので、移行していない古い形の行は、今のところホスト無しでは何も作られない生きたキーと今も
// 一致する。孤児になることはない。
//
// 既に衝突しているデータ（#791 より前、1つの古い形のキーの下で見分けの付かなかった、別々の
// インスタンスの同名の投稿者）を、このマイグレーションが解きほぐすことはできない＝書き換える
// 保存済みの行は1つしか無く、それはキーの対応表が解決した方のインスタンス（最初に見つかった
// 一致する投稿）へ移る。それはこの不具合が既に引き起こしていた既存のデータの喪失であって、この
// マイグレーションが持ち込むものではない。#791 の修正は、今後それが二度と起きないという点。

import type Database from 'better-sqlite3';

const MIGRATED_KEY = 'posterKeyHostMigrated';
const INSTANCE_PLATFORMS = ['misskey', 'mastodon'] as const;

function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// このデータベース自身の投稿からホストを解決できる古い形の posterKey の全部を、新しい形の
// 置き換え先へ対応付けたもの。ある古いキーについて最初に見つかった投稿が勝つ（ここでの投稿に
// 決まった反復の順序は無い＝ホストを選ぶ目的では、そのキーの下のどのインスタンスの投稿でも同じ
// だけ役に立つ）。
function buildKeyMap(sqlite: Database.Database): Map<string, string> {
  const map = new Map<string, string>();
  for (const platform of INSTANCE_PLATFORMS) {
    const rows = sqlite.prepare('SELECT userId, screenName, url FROM posts WHERE platform = ?').all(platform) as Array<{ userId: string | null; screenName: string | null; url: string | null }>;
    for (const row of rows) {
      const id = row.userId || '@' + (row.screenName || '');
      const oldKey = `${platform}:${id}`;
      if (map.has(oldKey)) continue;
      const host = hostOf(row.url);
      if (host) map.set(oldKey, `${platform}:${host}:${id}`);
    }
  }
  return map;
}

function rewriteColumn(sqlite: Database.Database, table: string, column: string, keyMap: Map<string, string>) {
  const update = sqlite.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`);
  for (const [oldKey, newKey] of keyMap) update.run(newKey, oldKey);
}

/** 何度実行しても同じ＝store_state がこの移行を済みと記録した後は何もしない。 */
export function migratePosterKeyHost(sqlite: Database.Database): void {
  const already = sqlite.prepare('SELECT value FROM store_state WHERE key = ?').get(MIGRATED_KEY) as { value: string } | undefined;
  if (already?.value === '1') return;
  const keyMap = buildKeyMap(sqlite);
  const run = sqlite.transaction(() => {
    if (keyMap.size) {
      rewriteColumn(sqlite, 'poster_tags', 'posterKey', keyMap);
      rewriteColumn(sqlite, 'poster_folder_items', 'posterKey', keyMap);
      rewriteColumn(sqlite, 'poster_alias_group_members', 'posterKey', keyMap);
      rewriteColumn(sqlite, 'poster_alias_groups', 'primaryKey', keyMap);
    }
    sqlite.prepare("INSERT INTO store_state (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(MIGRATED_KEY);
  });
  run();
}
