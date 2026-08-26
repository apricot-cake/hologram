'use strict';

// ライブラリの整理の状態を、より前の DB 世代へ巻き戻す (#233)。
//
// #233 は線をはっきり引いている。世代はデータベースのスナップショットであり、メディアは
// 一度書いたら終わり。だから巻き戻しは「整理をその日の状態に戻す」ことであって、
// 「それ以降に保存した投稿を保存しなかったことにする」ことでは決してない。この線を保つ
// 仕掛けは2つあり、どちらもここで動く:
//
//   退避       まず生きたデータベースを世代ストアへスナップショットするので、これから
//              捨てられる状態そのものが復元ポイントになる（取り消しに対する取り消し）。
//              下の掃き寄せの材料でもある＝実在のデータベースからレコードを読み直す方が、
//              ファイルから導出し直すより良い。導出し直すと、ライブラリが持っていて
//              どのファイルも運ばない欄が全部消える。
//   掃き寄せ   退避には在るが世代には無い投稿を、復元したデータベースへ登録し直す。
//              ライブラリは今の今まで持っていたものを持ったまま。所属が一緒に付いて
//              くるのは、入れ物が巻き戻しを生き延びた場合だけ (#233:
//              「所属だけ外れ、投稿自体は残る」)。restoreMemberships はもともと、
//              フォルダが消えている所属を失敗にせず落とす。
//
// 呼び出し元が持つべきものは全部渡してもらう。このモジュールは生きたハンドルを自分から
// 取りに行かない（index.ts が持っている）し、ウィンドウとも話さない。

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type Database from 'better-sqlite3';

import { commitFileAtomic } from './lib-atomic.ts';
import { createGeneration, generationsDir, listGenerations, parseGenerationName, pruneGenerations } from './lib-db-generations.ts';
import { postsByIds } from './lib-db-query.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { createDbWriter, ensureLibraryId } from './lib-db-write.ts';
import { openDatabase } from './lib-db.ts';

export interface RollbackDeps {
  /** 世代ストアが置かれているライブラリのフォルダ。未設定なら null。 */
  saveFolder(): string | null;
  /** 生きたデータベースファイルの絶対パス。 */
  dbFile(): string;
  /** DB を開いて取込キューを送り出す（index.ts の ensurePostsSynced）。 */
  ensurePostsSynced(): { sqlite: Database.Database } | null;
  /** 生きたハンドルを閉じて忘れる。次の ensure* が開き直す。 */
  closeDb(): void;
}

export interface RollbackResult {
  ok: boolean;
  error?: string;
  /** 巻き戻し先になった世代のファイル名。 */
  generation?: string;
  /** 巻き戻し前に自動で取ったスナップショットのファイル名。 */
  stash?: string;
  /** 世代より後にできたために持ち越した投稿の数。 */
  reregistered?: number;
}

export interface GenerationListing {
  name: string;
  /** ファイル名から読み取った ISO の時刻（ローカルの壁時計。ストア側を参照）。 */
  at: string;
  size: number;
}

function listRestorableGenerations(saveFolder: string | null): GenerationListing[] {
  if (!saveFolder) return [];
  return listGenerations(saveFolder).map((g) => ({ name: g.name, at: g.at, size: g.size }));
}

/** 呼び出し元から渡された世代の名前がパスになる、唯一の場所。 */
function resolveGeneration(saveFolder: string, name: unknown): string | null {
  if (typeof name !== 'string' || !parseGenerationName(name)) return null;
  const file = path.join(generationsDir(saveFolder), name);
  return fs.existsSync(file) ? file : null;
}

/**
 * その世代が知らなかったレコードを `stashFile` から取り出し、復元したばかりの
 * データベースへ写す。登録し直した数を返す。
 *
 * 読み取りはアプリの他の場所と同じ、組み立て済みレコードの形を通す。だから投稿が持つ
 * 列は全部そのまま渡る。もう一方の道（サイドカーを読み直す、ファイルを解析し直す）は、
 * #233 が退けたメタデータの目減りそのもの。
 */
async function reregisterNewerPosts(sqlite: Database.Database, stashFile: string): Promise<number> {
  const stash = openDatabase(stashFile, { readonly: true });
  try {
    const restored = new Set((sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((r) => r.captureId));
    const ids = (stash.sqlite.prepare('SELECT captureId FROM posts').all() as Array<{ captureId: string }>).map((r) => r.captureId).filter((id) => !restored.has(id));
    if (!ids.length) return 0;

    const stmts = preparePostStmts(sqlite);
    const resolveTagId = makeTagResolver(sqlite);
    const writer = createDbWriter(sqlite);
    const stashWriter = createDbWriter(stash.sqlite);
    let done = 0;
    // 塊に分ける。世代の時点から何千件も投稿が増えたライブラリでも IN(...) の並びが
    // SQLite の変数上限に十分収まるようにするため、そして読み取り（非同期）が書き込みの
    // トランザクション（同期）の中に居座らないようにするため。
    for (let i = 0; i < ids.length; i += 200) {
      const records = await postsByIds(stash.sqlite, ids.slice(i, i + 200));
      sqlite.transaction(() => {
        for (const rec of records) {
          writePost(stmts, resolveTagId, rec);
          const flags = stashWriter.getPostFlags(rec.captureId);
          if (flags) writer.restorePostFlags(rec.captureId, { userKind: flags.userKind, tagReviewed: flags.tagReviewed, folders: flags.folders, manualGroups: flags.manualGroups });
        }
      })();
      done += records.length;
    }
    return done;
  } finally {
    stash.sqlite.close();
  }
}

/**
 * ライブラリの整理の状態を `name` の時点へ戻す。
 *
 * 順序が要で、安全性の話はこれで全部。閉じる前に退避する（スナップショットには生きた
 * ハンドルが要る）、差し替えは不可分に行う（半分だけ写ったデータベースは、どちらの版
 * より悪い）、掃き寄せの前に開き直す（掃き寄せはファイルへの生の SQL ではなく、通常の
 * レコードライターを通して書く）。
 */
async function rollbackToGeneration(name: unknown, deps: RollbackDeps): Promise<RollbackResult> {
  const folder = deps.saveFolder();
  if (!folder) return { ok: false, error: 'not-configured' };
  const target = resolveGeneration(folder, name);
  if (!target) return { ok: false, error: 'no-such-generation' };

  const handle = deps.ensurePostsSynced();
  if (!handle) return { ok: false, error: 'not-configured' };

  // 同一性は巻き戻しを越えて残る。どちらにせよこれは同じライブラリだから。
  const libraryId = ensureLibraryId(handle.sqlite);

  let stashFile: string;
  try {
    stashFile = await createGeneration(handle.sqlite, folder);
  } catch (err: any) {
    log.error('rollback: could not stash the current database:', err);
    return { ok: false, error: 'stash-failed' };
  }

  const live = deps.dbFile();
  deps.closeDb();
  try {
    await commitFileAtomic(live, (tmp) => fs.promises.copyFile(target, tmp), { tmpSuffix: `.tmp-${Date.now()}` });
    // 今閉じた接続が残した WAL は、直前までそこに在ったファイルのもの。復元した方に
    // 被せて適用すると、巻き戻しが取り消したはずの書き込みをそのまま連れ戻す。
    for (const suffix of ['-wal', '-shm']) {
      try {
        await fs.promises.rm(live + suffix, { force: true });
      } catch {
        /* できる範囲で */
      }
    }
  } catch (err: any) {
    log.error('rollback: could not replace the live database:', err);
    // commitFileAtomic は失敗しても元のファイルをそのまま残すので、開き直せば無ではなく
    // 巻き戻し前のライブラリに着地する。
    deps.ensurePostsSynced();
    return { ok: false, error: 'replace-failed' };
  }

  const restored = deps.ensurePostsSynced();
  if (!restored) return { ok: false, error: 'reopen-failed' };
  createDbWriter(restored.sqlite).stateSet('libraryId', libraryId);

  let reregistered = 0;
  try {
    reregistered = await reregisterNewerPosts(restored.sqlite, stashFile);
  } catch (err: any) {
    // 巻き戻し自体は成立している。失敗したのは新しい投稿の持ち越し。握り潰さずに報告
    // する＝「N 件を登録し直した」は嘘になる。
    log.error('rollback: re-registration sweep failed:', err);
    return { ok: false, error: 'sweep-failed', generation: path.basename(target), stash: path.basename(stashFile) };
  }

  // 退避も他と変わらない世代なので、ストアの保持の方針はこれにも当たる。そうでないと、
  // 巻き戻しを続けたときにストアが際限なく膨らむ。
  await pruneGenerations(folder);
  log.info(`rolled back to ${path.basename(target)} (stash ${path.basename(stashFile)}, ${reregistered} post(s) re-registered)`);
  return { ok: true, generation: path.basename(target), stash: path.basename(stashFile), reregistered };
}

export { listRestorableGenerations, resolveGeneration, reregisterNewerPosts, rollbackToGeneration };
