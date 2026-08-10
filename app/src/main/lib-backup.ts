'use strict';

// バックアップ処理本体（#227 で index.ts から抜き出し、#233 で形を作り直した）。
//
// エンジンは1つ、レーンは2つ、その下に置き場アダプタがある:
//
//   media レーン  ライブラリが持つすべてのファイル——root、avatars/、emoji/、そして
//               #233 以降は .trash/ も。書いたら変わらないので、増分実行は
//               まだ置き場に無いものだけを運べばよい。保存の直後にも走る
//               （noteLibraryMutation）。ウェブから消えた投稿は二度と取得できない
//               ので、メディアの損失の窓はゼロであるべきで、1インターバル分では
//               ない。
//   DB レーン    稼働中のデータベースをファイルとしてコピーすることは絶対にない
//               （#97）。バックアップに届くのは、SQLite の Online Backup API を
//               通してローカルの世代ストア（lib-db-generations.ts）へ書かれる
//               世代であり、これが正本。置き場は同じストアをただ受け取るだけ。
//
// どちらのレーンも最後は同じ場所に行き着く: 置き場が何を持つべきかの絵を作り、
// 置き場に実際に何を持っているか尋ね、差分を書く（lib-backup-plan.ts）。
// #233 は「何をバックアップするか」と「どう書くか」（lib-backup-destination.ts）を
// 分けたので、OAuth のクラウド置き場は2つ目のエンジンではなく2つ目のアダプタになる。
//
// 整合性チェックがここにあるのは、それがバックアップだからではなく、ここに
// 「住んでいた」から: #301 が意図してこのブロックに置いた（「検出の仕組みは
// #100 の項目1と共有し、実装を重複させない」）。おかげで、実行が既に走査した
// ファイル集合を再利用でき、日次の突き合わせに余分な readdir がかからない。
//
// このエンジンが持てないのはレコードのパイプライン: DB をスナップショットしたり
// 孤児を数えたりする前に DB を同期させる必要があり、そのパイプラインは index.ts に
// 留まる。この3つの呼び出しは import ではなく createBackupEngine の deps 経由で
// 届く。だからこのモジュールから組み立て側へ戻る辺は無い。

import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import type Database from 'better-sqlite3';

import { INBOX_DIRNAME } from '../../../native-host/inbox.mts';
import { configDir } from './native-host.ts';
import { getSaveFolder, readLibraryBackupConfig, writeLibraryBackupConfig, readLibraryIntegrityStatus, writeLibraryIntegrityStatus } from './lib-config.ts';
import { BACKUP_SUBDIR, backupRoot, TMP_RE } from './lib-backup-destination.ts';
import type { BackupDestination } from './lib-backup-destination.ts';
import { isDestinationConfigured, overlaps, pathIsInside, resolveBackupDestination } from './lib-backup-destinations.ts';
import { createSafeStorageCipher } from './lib-oauth-safe-storage.ts';
import { ensureLibraryId } from './lib-db-write.ts';
import { groupOf, planBackup } from './lib-backup-plan.ts';
import type { SourceFile } from './lib-backup-plan.ts';
import { GENERATIONS_DIRNAME, createGeneration, latestGeneration, listGenerations, pruneGenerations } from './lib-db-generations.ts';
import { listWithDestination, rollbackToGeneration } from './lib-db-rollback.ts';
import { checkOrphans, recoverOrphanRecords } from './lib-db-integrity.ts';
import type { DbHandle } from './ipc-context.ts';

/** index.ts が持つレコードパイプラインから、このエンジンが必要とするもの。 */
export interface BackupEngineDeps {
  /** DB を開いて取込キューを送り出す。保存フォルダが未設定なら null。 */
  ensurePostsSynced(): DbHandle | null;
  scheduleSavedIndexWrite(handle: { sqlite: Database.Database }): void;
  /** 主ウィンドウのレンダラーへ push する。ウィンドウが無ければ何もしない。 */
  send(channel: string, ...args: unknown[]): void;
  /** 稼働中のデータベースの絶対パス——ロールバックが置き換えるファイル。 */
  dbFile(): string;
  /** 稼働中のハンドルを手放し、次の ensurePostsSynced がディスクから開き直すようにする。 */
  closeDb(): void;
}

// ライブラリのゴミ箱。#233 以降ミラーする（以前はスキップしていた）ので、復元は
// 削除待ちの投稿を、削除待ちのまま持ち帰る。削除日時を失って生きた投稿として
// 復活させたりはしない。
const TRASH_SUBDIR = '.trash';
// 稼働中のデータベースとその WAL の sidecar は、media レーンでは絶対に運ばない:
// 書き込み中のデータベースをファイル単位でコピーすれば、構造上必ず不整合になる
// （#97）し、整合性のあるコピーは既に世代ストアとして存在する。ここに名前で
// 列挙しているのは、走査で見つけるのではなく明示するため。#176 でデータベースを
// ライブラリフォルダの内側に置いたので、この除外が無ければ下の root の走査が
// それを拾ってしまい、本物と一緒に不整合なコピーを送ってしまう。
const LIVE_DB_NAMES = new Set(['hologram.db', 'hologram.db-wal', 'hologram.db-shm']);
// （LIBRARY_SUBDIR——移動先ライブラリの名前付きサブフォルダ——は、それを持つ
// pick-save-folder ハンドラと一緒に ./ipc-transfer.ts にある。）

// バックアップの置き場と整合性状態は、以前は config.json 上のそれぞれ独立した
// フラットな1つのキーだった。#176 で両方とも現在のライブラリの libraries[] の
// エントリ（lib-config.ts）の下へ移し、切り替えるとアプリ全体で共有するのではなく
// 自分の置き場と状態を持ち運ぶようにした。ここの引数無しの呼び出しの形は
// 変えていない——どの呼び出し元も元から「現在のライブラリ」を意味していたため。
const readBackupConfig = readLibraryBackupConfig;
const writeBackupConfig = writeLibraryBackupConfig;
const readIntegrityStatus = readLibraryIntegrityStatus;
const writeIntegrityStatus = writeLibraryIntegrityStatus;

// 設定 UI は、利用者が選んだフォルダを config へ書く前に検証する。実行時に
// リゾルバが適用するのと同じ規則（ライブラリと入れ子の置き場は、バックアップが
// 自分自身を食べることになる）。
function validateBackupDir(dir: string | null | undefined) {
  if (!dir) return { ok: true };
  return overlaps(dir, getSaveFolder()) ? { ok: false, error: 'overlap' } : { ok: true };
}

/** 置き場リゾルバが必要とするもののうち、アプリだけが供給できるもの。 */
function destinationDeps() {
  return { saveFolder: getSaveFolder(), vaultDir: configDir(), cipher: createSafeStorageCipher() };
}

// --- 保存フォルダの移動 ---
// ライブラリを壊したり、循環したりする移動先は拒む: 現在のフォルダ自身、それと
// 入れ子になっている何か（フォルダを自分の子の中へは移動できない）、設定
// ディレクトリ、バックアップの置き場。最後に、書き込み可能であることを確認する。
function validateSaveFolder(dir) {
  if (!dir || typeof dir !== 'string' || !dir.trim()) return { ok: false, error: 'invalid' };
  const cur = getSaveFolder();
  if (path.resolve(dir) === path.resolve(cur)) return { ok: false, error: 'same' };
  if (pathIsInside(dir, cur) || pathIsInside(cur, dir)) return { ok: false, error: 'nested' };
  if (pathIsInside(dir, configDir()) || pathIsInside(configDir(), dir)) return { ok: false, error: 'config-overlap' };
  const b = readBackupConfig();
  if (b && b.dir && (pathIsInside(dir, b.dir) || pathIsInside(b.dir, dir))) return { ok: false, error: 'backup-overlap' };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.hologram-write-probe-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch {
    return { ok: false, error: 'not-writable' };
  }
  return { ok: true };
}

// Node の setInterval は 2^31-1 ms を超える遅延を 1ms に切り詰めてしまうため、
// 大きなインターバル（週×4 以上、年、など）をそのまま渡すと暴走する。短い
// ハートビート（1分）で期限が来たかどうかを判定し、しきい値を超えた時だけ
// 実行する方式に変えた。
const BACKUP_HEARTBEAT_MS = 60 * 1000;
function backupIntervalMs(b) {
  // 'year' は UI からは無くなったが、古い設定値との後方互換のために残してある
  const unitMs = { day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 };
  return Math.max(60000, (Number(b.intervalValue) || 1) * (unitMs[b.intervalUnit] || unitMs.day));
}

// 最後のライブラリ変更からこれだけ経つと、保存が media レーンに落ち着く。
// 一括インポートが数百回ではなく1回の実行で済むだけの長さがありつつ、利用者が
// 思う意味で「保存した直後にバックアップされる」と言えるだけの短さ。
const IMMEDIATE_BACKUP_DELAY_MS = 15 * 1000;
// DB レーンの時間によらないトリガー（「変更N件」）: 時計に関わらず次の世代を
// 書くまでに、ライブラリの変更がどれだけ積み上がってよいか。
const GENERATION_CHANGE_THRESHOLD = 50;
// ……とその時間トリガー: 1日1世代が #233 の「日次」境界。
const GENERATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * ライブラリがバックアップに差し出すすべて。置き場からの相対パスをキーにする。
 * ディレクトリ名はライブラリ自身のものなので、置き場は再構成した形式ではなく、
 * ライブラリをそのまま読めるコピーになる。
 */
async function collectLibraryFiles(src: string): Promise<Map<string, SourceFile>> {
  const out = new Map<string, SourceFile>();
  const add = async (rel: string, abs: string, mutable?: boolean) => {
    try {
      const st = await fs.promises.stat(abs);
      if (st.isFile()) out.set(rel, { abs, size: st.size, mtimeMs: st.mtimeMs, mutable });
    } catch {
      /* アクセスできないエントリはスキップ */
    }
  };
  const collectDir = async (sub: string, mutable?: (name: string) => boolean) => {
    let names: string[];
    try {
      names = await fs.promises.readdir(path.join(src, ...sub.split('/')));
    } catch {
      return; // 存在しない（そのフォルダが一度もできなかったライブラリ）
    }
    for (const f of names) {
      if (TMP_RE.test(f)) continue;
      await add(`${sub}/${f}`, path.join(src, ...sub.split('/'), f), mutable ? mutable(f) : undefined);
    }
  };

  let rootNames: string[];
  try {
    rootNames = await fs.promises.readdir(src);
  } catch {
    rootNames = [];
  }
  for (const f of rootNames) {
    if (TMP_RE.test(f) || LIVE_DB_NAMES.has(f)) continue;
    await add(f, path.join(src, f));
  }
  // 共有ストアは単一階層で書いたら変わらないので、自分の名前のままミラーして
  // 復元でも投稿者アイコンを保つ（#290 が同じ形で emoji/ を追加）。
  await collectDir('avatars');
  await collectDir('emoji');
  // ゴミ箱の sidecar JSON は投稿がそこへ着地した時に `trashedAt` を得るので、
  // ライブラリの中で書いたら変わらないとは言えない唯一のファイル。
  await collectDir(TRASH_SUBDIR, (f) => /\.json$/i.test(f));
  await collectDir(`${INBOX_DIRNAME}/new`);
  await collectDir(`${INBOX_DIRNAME}/segments`);
  // 隔離されたエンベロープ（#920）は DB に一度も届かなかった保存済みコンテンツ
  // なので、それをバックアップから外すと、そのバイト列が失われる唯一の場所になる。
  await collectDir(`${INBOX_DIRNAME}/failed`);
  await collectDir(GENERATIONS_DIRNAME);
  return out;
}

/**
 * このエンジンと、実行を共有する整合性チェック。index.ts の ctx 組み立てから
 * 一度だけ呼ばれる——実行中フラグとハートビートのタイマーはモジュールレベルでは
 * なくこのクロージャの状態なので、2つ目のエンジンが1つ目と黙って共有すること
 * はできない。
 */
function createBackupEngine({ ensurePostsSynced, scheduleSavedIndexWrite, send, dbFile, closeDb }: BackupEngineDeps) {
  // 唯一の共有 DB↔media 突き合わせ処理（#301 の設計:「検出の仕組みは #100 の
  // 項目1と共有し、実装を重複させない」）——起動時（バックアップ設定とは無関係に）と
  // runBackup から（インターバル実行に「日次の突き合わせ」として相乗り）の両方から
  // 呼ばれる。`knownFiles` を渡した場合、それはその実行が既に集めたライブラリの
  // 一覧で、保存フォルダの2回目の readdir を省く。
  function runIntegrityPass(folder: string, sqlite: any, knownFiles?: Set<string>) {
    let dbOk = true;
    try {
      const check = sqlite.pragma('integrity_check', { simple: true });
      dbOk = check === 'ok';
      if (!dbOk) log.error(`integrity_check failed: ${check}`);
    } catch (err) {
      dbOk = false;
      log.error('integrity_check threw:', err);
    }
    const { orphanMedia, missingMedia } = checkOrphans(folder, sqlite, knownFiles);
    const status = writeIntegrityStatus({ lastCheckAt: new Date().toISOString(), dbOk, orphanCount: orphanMedia.length, missingCount: missingMedia.length });
    send('integrity-check-done', status);
    return { dbOk, orphanMedia, missingMedia };
  }

  // 単独の起動時チェック（armBackupSchedule() の呼び出し箇所）——置き場が未設定でも
  // 動く必要があるので、runBackup（`!b.dir` の時は何も開かずに早期リターンする）に
  // 相乗りせず自分で DB を開く。
  async function runStartupIntegrityCheck() {
    const folder = getSaveFolder();
    if (!folder) return;
    // #37: ディスク上に存在しないフォルダだと、すべての投稿のメディアが
    // 「missing」として読み返されてしまう——本物の DB↔media の不一致ではなく、
    // フォルダが使えないことによるノイズ。ライブラリに手が届かない間に何千もの
    // 誤検出を報告させるより、このチェック自体を丸ごとスキップする。
    if (!fs.existsSync(folder)) return;
    try {
      // ensurePostsSynced（生の ensureDb ではない）——runBackup と同一の理屈を
      // 参照: 孤児を数える前に DB がディスクの状態を反映していなければならず、
      // このタイマーはレンダラーの最初の listPosts() 呼び出しより前に発火する
      // ことがある。
      const handle = await ensurePostsSynced();
      if (!handle) return;
      runIntegrityPass(folder, handle.sqlite);
    } catch (err) {
      log.error('startup integrity check failed:', err);
    }
  }

  // 手動トリガーの孤児復旧（#301 の設計: 自動では絶対にやらない——保存がまだ
  // 進行中のものを、恒久的な損失と誤読してはいけない理由は
  // lib-db-integrity.ts の recoverOrphanRecords のコメント参照）。実行後に
  // 整合性チェックをやり直し、表示上の orphanCount が即座に下がるようにする。
  // `adopted` は、最小限のレコードに要約する（#511）のではなく自身の sidecar を
  // 読み戻した孤児の数を数える——2つの結果は件数以外すべて異なるので、記録する
  // 価値がある。
  async function runOrphanRecovery() {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    // #37: 実際には存在しないフォルダに対して「復旧した」レコードを絶対に
    // 合成しない——すべての投稿が間違った理由で孤児／missing に見えてしまい、
    // 復旧は本物の読み戻し先を何も持たないことになる。
    if (!fs.existsSync(folder)) return { ok: false, error: 'library-missing' };
    const handle = await ensurePostsSynced();
    if (!handle) return { ok: false, error: 'not-configured' };
    const written = recoverOrphanRecords(folder, handle.sqlite);
    if (written.length) scheduleSavedIndexWrite(handle);
    runIntegrityPass(folder, handle.sqlite);
    const adopted = written.filter((w) => w.via === 'sidecar').length;
    if (written.length) log.info(`orphan recovery: ${written.length} recovered (${adopted} from a sidecar, ${written.length - adopted} synthesized)`);
    return { ok: true, recovered: written.length, adopted };
  }

  // --- DB レーン ------------------------------------------------------------
  let generationRunning = false;
  let mutationsSinceGeneration = 0;

  /** 最新の世代を書いてから境界を越えたか？ */
  function generationDue(folder: string): boolean {
    const list = listGenerations(folder);
    if (!list.length) return true;
    if (mutationsSinceGeneration >= GENERATION_CHANGE_THRESHOLD) return true;
    return Date.now() - Date.parse(list[0].at) >= GENERATION_INTERVAL_MS;
  }

  /**
   * ローカルストアへ世代を1つ書き、その後ストアを間引く。`force` は手動の
   * 「今すぐ復元ポイントを作る」経路。無ければ境界（1日経過、または変更が
   * 十分積み上がった）が決める。
   */
  async function runDbGeneration(reason: string, force = false) {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    if (!fs.existsSync(folder)) return { ok: false, error: 'src-missing' };
    if (generationRunning) return { ok: false, error: 'busy' };
    if (!force && !generationDue(folder)) return { ok: false, error: 'not-due' };
    generationRunning = true;
    const startedAt = Date.now();
    try {
      const handle = await ensurePostsSynced();
      if (!handle) return { ok: false, error: 'not-configured' };
      const file = await createGeneration(handle.sqlite, folder);
      mutationsSinceGeneration = 0;
      const removed = await pruneGenerations(folder);
      // media 実行と同じ理由で時間を計る（runBackup 末尾のログ参照）: これらの
      // 境界値は実運用の様子を待つ暫定的な数字。
      log.info(`db generation written (${reason}) in ${Date.now() - startedAt}ms: ${path.basename(file)}${removed.length ? ` — thinned ${removed.length}` : ''}`);
      return { ok: true, file, thinned: removed.length };
    } catch (err: any) {
      log.error('db generation failed:', err);
      return { ok: false, error: err?.message || 'failed' };
    } finally {
      generationRunning = false;
    }
  }

  /**
   * #176 の要求で、#233 が置き場を所有するのでここで課す: 置き場はどのライブラリに
   * 属するかを記録し、別のライブラリに対する実行は backup-guard に任せるのではなく
   * ここで明確に拒む。
   *
   * この番人は内側ではなく手前に置く必要がある: ライブラリ A の置き場がライブラリ B の
   * ずっと小さい（あるいは単に異なる）内容を持っていても、それは「元データが
   * 縮小した」形には見えないので、縮小率チェックは剪定を通してしまい、A の
   * バックアップが B に合わせて剪定されることになる。まだ id を持たない置き場は
   * そのまま受け入れる——この仕組みは、それが守る置き場より後からできたものだから。
   */
  async function claimDestination(destination: BackupDestination): Promise<{ ok: true; libraryId: string } | { ok: false; error: string }> {
    const handle = await ensurePostsSynced();
    if (!handle) return { ok: false, error: 'not-configured' };
    const libraryId = ensureLibraryId(handle.sqlite);
    const identity = await destination.readIdentity();
    if (identity && identity.libraryId !== libraryId) {
      log.warn(`backup refused: ${destination.location} belongs to another library (${identity.libraryId})`);
      return { ok: false, error: 'library-mismatch' };
    }
    if (!identity) await destination.writeIdentity({ libraryId, lastRunAt: null });
    return { ok: true, libraryId };
  }

  /**
   * 復元 UI の一覧（#233）: ローカルストアに加え、設定済みの置き場が各世代を
   * 持っているかどうか。この区別こそが要点——ここにしか無い世代もライブラリを
   * ロールバックはできるが、この機器を生き延びるコピーではない。
   */
  function listDbGenerations() {
    const b = readBackupConfig();
    // 置き場をこの機器上のフォルダとして読むので、クラウドの置き場はコピーが
    // 実際にそこにあっても、すべての世代について「この PC のみ」と報告する。
    // 両者を API 越しに区別するのは非同期の一覧取得になり、このハンドラは
    // レンダラーまで一貫して同期的——復元 UI は #911 の担当分。
    return listWithDestination(getSaveFolder(), b.dir ? backupRoot(b.dir) : null);
  }

  /**
   * 利用者に見えるロールバック。レーンが使うのと同じ2つのフラグに掛けて
   * あるので、スケジュール実行がデータベースを書いて（あるいは
   * スナップショットして）いる最中に、その足元で置き換えられることはない。
   */
  async function rollbackDbGeneration(name: unknown) {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, error: 'not-configured' };
    if (backupRunning || generationRunning) return { ok: false, error: 'busy' };
    generationRunning = true;
    try {
      const result = await rollbackToGeneration(name, { saveFolder: getSaveFolder, dbFile, ensurePostsSynced, closeDb });
      // stash はこのライブラリの最新世代そのものなので、その裏の掃き寄せが成功したか
      // どうかに関わらず、変更カウンタは最初からやり直す。
      if (result.stash) mutationsSinceGeneration = 0;
      return result;
    } finally {
      generationRunning = false;
    }
  }

  // --- media レーン ---------------------------------------------------------
  let backupRunning = false;
  async function runBackup(reason) {
    const b = readBackupConfig();
    const src = getSaveFolder();
    if (!src) return { ok: false, error: 'not-configured' };
    // #37: 行方不明のライブラリを「空のライブラリを正常にバックアップした」と
    // 絶対に読ませない——0件のファイルを収集して、それをこの実行の lastResult
    // として書く代わりに拒む（backup-guard の剪定スキップは「置き場」の既存
    // ファイルを守るだけで、この紛らわしい「成功」という結果は止められない）。
    if (!fs.existsSync(src)) return { ok: false, error: 'src-missing' };
    if (backupRunning) return { ok: false, error: 'busy' };
    // フォルダとクラウドアカウントで異なるものすべて——設定済みか、ドライブが
    // そこにあるか、アカウントがまだ繋がっているか——はリゾルバ（#909）が決める。
    // 下のエンジンは返ってきたものが何であれそのまま扱い、どちらの種類を
    // 受け取ったかは知らない。
    const resolved = resolveBackupDestination(b, destinationDeps());
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const destination = resolved.destination;
    // 実行が告知されるより前に: ここでの拒否は開始したバックアップとして
    // 読まれてはいけないし、実は他人のものだと分かった置き場には何も書いては
    // いけない。クラウドの置き場は答えるためにネットワークへ出るので、
    // 「アカウントとまったく話せない」もここに落ちる——それでも何も書かれない。
    let claim: Awaited<ReturnType<typeof claimDestination>>;
    try {
      claim = await claimDestination(destination);
    } catch (err) {
      log.warn(`backup could not reach ${destination.location}:`, err);
      return { ok: false, error: 'dest-unreachable' };
    }
    if (!claim.ok) return { ok: false, error: claim.error };
    backupRunning = true;
    send('backup-start'); // sidebar status → running
    const startedAt = Date.now();
    const result: any = { ok: true, reason: reason || 'manual', fileCount: 0, written: 0, moved: 0, pruned: 0 };
    try {
      // 境界が来ていれば DB レーンを先に走らせる。そうすればそこで書く世代が、
      // この同じ実行が置き場へ運ぶものの一部になる。
      await runDbGeneration(reason || 'manual');

      const source = await collectLibraryFiles(src);
      const present = await destination.list();
      const prevSummary = b.lastResult || {};
      const baseline = Number(prevSummary.lastGoodCount) || Number(prevSummary.fileCount) || 0;
      const plan = planBackup(source, present, baseline);

      // 移動を先に: 移動すれば、そうしなければコピーが着地するはずだった名前が
      // 空くし、これはバイト列の再転送に絶対に化けてはいけない操作。
      for (const m of plan.move) {
        try {
          await destination.move(m.from, m.to);
          result.moved++;
        } catch (e: any) {
          // 失敗した移動はデータ損失ではない——次の実行がそのファイルをコピーし、
          // 古い名前を剪定する。
          if (!result.firstError) result.firstError = e.message;
        }
      }
      let segmentCopyFailed = false;
      for (const c of plan.copy) {
        try {
          await destination.put(c.rel, c.abs, c.mtimeMs);
          result.written++;
        } catch (e: any) {
          // 最初のコピーエラーを表に出しつつ、残りは続行する
          if (!result.firstError) result.firstError = e.message;
          if (groupOf(c.rel) === 'inbox-segments') segmentCopyFailed = true;
        }
      }
      const toPrune = segmentCopyFailed ? plan.prune : [...plan.prune, ...plan.pruneLoose];
      for (const rel of toPrune) {
        try {
          await destination.remove(rel);
          result.pruned++;
        } catch {
          /* 既に無い、あるいは他の何かが握っている */
        }
      }

      result.fileCount = plan.mediaCount;
      result.pruneSkipped = plan.pruneSkipped;
      result.baselineCount = plan.baselineCount;
      result.lastGoodCount = plan.lastGoodCount;

      // 日次の突き合わせはこの実行に相乗りし（#301）、既に集めた一覧を再利用
      // するので、孤児／missing の走査に余分な readdir はかからない。
      // ensurePostsSynced（生の ensureDb ではない）にすることで、孤児を計算する
      // 前に DB が実際にディスク上にあるものを反映するようにする——そうしないと、
      // レンダラーの最初の listPosts() より前に発火したバックアップが空の
      // posts テーブルを見て、すべてのファイルを孤児扱いしてしまう。
      try {
        const handle = await ensurePostsSynced();
        if (!handle) throw new Error('save folder unavailable');
        // ルート直下の名前のみ: findOrphanMedia の契約対象はライブラリの root
        // （ゴミ箱行きのキャプチャにも posts 行は残っているし、共有ストアは
        // キャプチャ単位の成果物ではない）なので、この実行が集めたサブフォルダの
        // エントリはその管轄ではない。
        const known = new Set([...source.keys()].filter((rel) => !rel.includes('/')));
        const pass = runIntegrityPass(src, handle.sqlite, known);
        result.orphanCount = pass.orphanMedia.length;
        result.missingCount = pass.missingMedia.length;
      } catch (e: any) {
        if (!result.firstError) result.firstError = e.message;
      }
    } catch (err) {
      result.ok = false;
      result.error = err.message;
    } finally {
      backupRunning = false;
    }
    const at = new Date().toISOString();
    const summary = {
      fileCount: result.fileCount,
      written: result.written,
      moved: result.moved,
      pruned: result.pruned,
      reason: result.reason,
      ok: result.ok,
      error: result.error || result.firstError || null,
      at: at,
      pruneSkipped: result.pruneSkipped || null,
      baselineCount: result.baselineCount || 0,
      lastGoodCount: typeof result.lastGoodCount === 'number' ? result.lastGoodCount : 0,
      orphanCount: result.orphanCount || 0,
      missingCount: result.missingCount || 0,
    };
    try {
      writeBackupConfig({ lastRunAt: at, lastResult: summary });
    } catch {
      /* 無視する */
    }
    try {
      await destination.writeIdentity({ libraryId: claim.libraryId, lastRunAt: at });
    } catch {
      /* claim 自体は既に成立している。遅れているのはそのタイムスタンプだけ */
    }
    // #233（2026-08-02）: インターバルと変更しきい値は v1 の数字のまま出荷され、
    // 実際の「感触」でチューニングされていく。だから、1回の実行にどれだけ
    // かかったか、前回からどれだけ経ったかを、どこかで読めるようにしておく
    // 必要がある。そのどこかがこのログ——これが無ければ、どの数字を動かすべきか
    // 知るすべが無い。
    const sinceLast = b.lastRunAt ? Math.round((startedAt - Date.parse(b.lastRunAt)) / 1000) : null;
    log.info(`backup run (${summary.reason}) took ${Date.now() - startedAt}ms${sinceLast === null ? '' : `, ${sinceLast}s since the last run`} — ${summary.fileCount} file(s), +${summary.written} copied, ${summary.moved} moved, ${summary.pruned} pruned${summary.ok ? '' : ` — FAILED: ${summary.error}`}`);
    send('backup-done', Object.assign({}, result, { at: at }));
    return result;
  }

  // ライブラリが変わるたびにレコードパイプラインから呼ばれる。仕事は2つ: DB
  // レーンの変更カウンタを維持することと、media レーンに「保存の直後」の実行を
  // 与えるカウントダウンを始めること。どちらも構造上デバウンスされる——一括
  // インポートはこれを数百回呼ぶが、実行は1回で済む。
  let immediateTimer: any = null;
  function noteLibraryMutation(count = 1) {
    mutationsSinceGeneration += Math.max(1, Number(count) || 1);
    // エンジンが arm されるまで何もスケジュールされない——スモークテストの
    // ハーネスは arm せずにアプリを起動するので、テストの裏でバックアップが
    // 勝手に始まるのは、まさにそこから来るであろう不安定さそのもの。
    if (!scheduleArmed) return;
    if (mutationsSinceGeneration >= GENERATION_CHANGE_THRESHOLD) void runDbGeneration('changes');
    if (!isDestinationConfigured(readBackupConfig())) return;
    clearTimeout(immediateTimer);
    immediateTimer = setTimeout(() => {
      void runBackup('changed');
    }, IMMEDIATE_BACKUP_DELAY_MS);
  }

  let backupIntervalTimer: any = null;
  let scheduleArmed = false;
  function armBackupSchedule() {
    scheduleArmed = true;
    if (backupIntervalTimer) {
      clearInterval(backupIntervalTimer);
      backupIntervalTimer = null;
    }
    // ハートビートは今は無条件: 置き場が未設定でも DB レーンの日次境界は
    // 越える必要がある。ロールバックが読むのはローカルの世代ストア（#233）
    // であり、利用者がバックアップフォルダを選ぶより前から存在していなければ
    // ならないため。
    backupIntervalTimer = setInterval(() => {
      const cur = readBackupConfig();
      if (isDestinationConfigured(cur) && cur.interval) {
        const last = cur.lastRunAt ? Date.parse(cur.lastRunAt) : 0;
        if (Date.now() - last >= backupIntervalMs(cur)) {
          void runBackup('interval');
          return; // この実行が自分の世代を書く
        }
      }
      void runDbGeneration('daily');
    }, BACKUP_HEARTBEAT_MS);
  }

  // #176 の switchLibrary は、両レーンが待機状態になるまで待ってから、その足元で
  // 稼働中の DB を閉じる（実行中に閉じることは、runDbGeneration 自身の
  // `generationRunning` によるロールバック防止の番人が既に防いでいる対象——
  // 切り替えは3つ目のフラグを新しく作らず、同じ2つを再利用する）。
  const isBusy = () => backupRunning || generationRunning;

  return { runBackup, runDbGeneration, listDbGenerations, rollbackDbGeneration, armBackupSchedule, runStartupIntegrityCheck, runOrphanRecovery, noteLibraryMutation, isBusy };
}

/**
 * 復元に使える最新のデータベースコピー。無ければ null。ローカルの世代ストアを
 * 優先する。置き場にあるそのコピーは、ストアが本来想定するケース——この機器の
 * ライブラリが消えた場合——のためのフォールバック。
 */
function latestRestorableSnapshot(): string | null {
  const folder = getSaveFolder();
  if (folder) {
    const local = latestGeneration(folder);
    if (local) return local;
  }
  const b = readBackupConfig();
  // 起動時にディスクから直接読めるのはフォルダの置き場だけ。クラウドアカウントから
  // 最新世代を引っ張ってくるのは、それ自身の進捗と失敗モードを持つダウンロードで
  // あり、起動から1秒以内に決めなければならないこの経路ではなく、復元 UI
  // （#911）が担うべきもの。
  if (!b.dir) return null;
  // listGenerations はストアを「含む」フォルダを取る。置き場ではそれが root に
  // なる——置き場は、ライブラリが使うのと同じ名前でストアのコピーを持つ。
  const list = listGenerations(backupRoot(b.dir));
  return list.length ? list[0].file : null;
}

export { BACKUP_SUBDIR, backupRoot, collectLibraryFiles, latestRestorableSnapshot, readBackupConfig, writeBackupConfig, readIntegrityStatus, validateBackupDir, validateSaveFolder, backupIntervalMs, createBackupEngine };
