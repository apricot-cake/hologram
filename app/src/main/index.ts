'use strict';

import { app, BrowserWindow, dialog, protocol } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { openDatabase, DatabaseCorruptError } from './lib-db.ts';
import { migratePosterKeyHost } from './lib-migrate-poster-key-host.ts';
import { backfillPosterProfiles } from './lib-backfill-poster-profiles.ts';
import { computeDelta } from './lib-post-delta.ts';
import { indexCandidateIds, indexRecordsByIds, postsFromDb, savedPosterProfilesFromDb, searchPostsFts } from './lib-db-query.ts';
import { createDbWriter } from './lib-db-write.ts';
import { buildSavedIndex, SAVED_INDEX_FILE } from './lib-saved-index.ts';
import { listTrashRecords } from './lib-trash-capture.ts';
import { drainInbox } from './lib-db-inbox.ts';
import { applyPendingReplacements } from './lib-db-replaces.ts';
import { compactInbox } from './lib-db-inbox-compact.ts';
import { inboxNewDir, ensureInboxDirs } from '../../../native-host/inbox.mts';
import { parseJsonLoose } from './lib-json.ts';
import { writeFileAtomicSync } from './lib-atomic.ts';
import { TRASH_SUBDIR, resolveInSaveFolder } from './lib-save-folder-path.ts';
// 保存先フォルダの移設エンジン（コピー＋追いつき → 切り替え → 検証済みの後始末 → 掃き寄せ）。
import { relocateLibrary } from './lib-migrate.ts';
// このファイルから切り出したサブシステム（#227）＝機械的な移動で、ロジックは変えていない。
// 各モジュールのヘッダに、何を持って行き、何を意図して残したかが書いてある。ここに残るのは
// 組み立てと、そのすべてが共有するレコードのパイプライン（設定 → DB → 取込キュー →
// レンダラー）。
import { configDir, defaultLibraryDir, installer, pixivRefererFor, downloadAvatar, clearAllBlockReason } from './native-host.ts';
import { checkForRedirect } from './lib-storage-redirect-guard.ts';
import { readConfig, writeConfig, getSaveFolder, readSavePointer, initSaveFolderRedundancy, isConfigCorrupt, invalidateConfigCache, saveFolderStatus, migrateToLibraries, recordLibraryOpened, listRecentLibraries, removeRecentLibrary, readAiConfig, writeAiConfig } from './lib-config.ts';
import { mimeForFile, registerImageProtocol, thumbnailBytes } from './lib-thumbnails.ts';
import { sharedJobPool } from './lib-job-pool.ts';
import { clearIndexQueue, notifyRecordsChanged, requestBackfill, startIndexQueue } from './lib-index-queue.ts';
import { registerAiTagsJob } from './lib-ai-tags-job.ts';
import { ensureDerivedDb, readDerivedProgress, writeDerivedProgress } from './lib-derived-db.ts';
import { backupIntervalMs, createBackupEngine, latestRestorableSnapshot, readBackupConfig, readIntegrityStatus, validateBackupDir, validateSaveFolder, writeBackupConfig } from './lib-backup.ts';
import { classifyLibraryFolder } from './lib-switch-library.ts';
import { ensureLibraryId } from './lib-db-write.ts';
import { APP_ICON, DEV_ORIGIN, DEV_SERVER_URL, RELOAD_AFTER_LIBRARY_SWAP_MS, createWindow, devServer, getWin, getWindows, installNavigationGuards, sendToOtherWins, sendToWin, sendWindowToBack } from './lib-window.ts';
import { pinSend, takeInitial as pinTakeInitial, toggleAlwaysOnTop as pinToggleAlwaysOnTopImpl } from './lib-pin-window.ts';
import { installDevRendererCsp, registerAppProtocol } from './app-protocol.ts';
import { runMlSmoke } from './ml-smoke.ts';
import { runAiTagsModelSmoke, runAiTagsSmoke } from './ai-tags-smoke.ts';
import { stopMlRuntime } from './lib-ml-runtime.ts';
import { shouldWarnMissingDebugPort } from './startup-debug-port.ts';
import { EXIT_NO_INSTANCE, EXIT_SIGNALLED, hasQuitSignal } from './restart-signal.ts';
// このファイルから切り出した IPC ハンドラのモジュール（機械的な移動＝ロジックは変えていない）。
// それぞれ register(ctx) を公開する。ctx は下のコア関数の後で組み立て、トップレベルの登録箇所で
// 渡す（whenReady の前、registerExtractedIpc を参照）。
import * as ipcOrganize from './ipc-organize.ts';
import * as ipcPosts from './ipc-posts.ts';
import * as ipcConfig from './ipc-config.ts';
import * as ipcWindow from './ipc-window.ts';
import * as ipcPin from './ipc-pin.ts';
import * as ipcTrash from './ipc-trash.ts';
import * as ipcBackup from './ipc-backup.ts';
import * as ipcTransfer from './ipc-transfer.ts';
import * as ipcTagVocab from './ipc-tag-vocab.ts';
import * as ipcHistory from './ipc-history.ts';
import * as ipcWatchImport from './ipc-watch-import.ts';
import * as ipcAi from './ipc-ai.ts';
import * as ipcIndexQueue from './ipc-index-queue.ts';
import * as ipcModel from './ipc-model.ts';
import { createWatchImportManager } from './lib-watch-import.ts';
import type { IpcContext } from './ipc-context.ts';

// userData を、Native Messaging ブリッジが設定を読むのと同じディレクトリに固定する。ブリッジ
// （Chrome が起動する素の Node）とこのアプリの見ている先が常に一致するように。
// app が ready になる前に走らせる必要がある。
app.setPath('userData', configDir());

// 診断は Electron の AppData 既定ではなく、ブリッジと共有している設定の隣に置く。説明の対象で
// ある設定と別の場所にあるログは、設定と突き合わせて読みにくい。（元は MSIX のストレージ仮想化が
// 両者を引き離すという話だった＝2026-08-06 以降は起きない、#1003＝が、設定の隣というのは
// それとは関係なく正しい置き場。）
log.transports.file.resolvePathFn = () => path.join(configDir(), 'logs', 'main.log');
// preload のブリッジはこちらが持っているので、electron-log にセッションごとの2本目の preload
// スクリプトを登録させない。代わりに app/src/preload/index.ts が electron-log/preload を
// import する。
log.initialize({ preload: false });
log.errorHandler.startCatching({ showDialog: false });

// 弾いた ELECTRON_RENDERER_URL を報告するのは、それを解決する lib-window.ts ではなくここ。
// あのモジュールの本体は上の行より先に走るため、同じ警告をあちらに書くと、このアプリが設定の隣に
// 置いているログではなく electron-log の既定ファイルへ出てしまう（#381 / #227）。
if (process.env.ELECTRON_RENDERER_URL && devServer.rejected) {
  log.warn('Ignoring ELECTRON_RENDERER_URL, loading the bundled renderer', { reason: devServer.rejected });
}

// このアプリが提供する2つのカスタムスキームを、1回の呼び出しで宣言する。Electron は
// registerSchemesAsPrivileged を ready の前に、かつ1回だけ呼ぶことを求めるので、2か所目の登録
// 箇所は取れない（スキームを増やすならこの配列に足す）。
//   asset:// ＝（任意の場所にある）保存先フォルダの画像と動画。レンダラーが webSecurity を切る
//     ことも、全画像を JS のメモリに抱えることもなく、ファイル名で遅延読み込みできる。ハンドラは
//     lib-thumbnails.ts。
//   app://   ＝ ビルド済みのレンダラーそのもの（#7）。ハンドラは app-protocol.ts。どちらの
//     スキームにも corsEnabled を付けない理由もそこに書いてある。
protocol.registerSchemesAsPrivileged([
  { scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// --- 設定 ---
// config.json の読み書き、破損の番人、冗長化した保存先フォルダのポインタは ./lib-config.ts へ
// 切り出した（上で import している）。

// .hologram-inbox/new を監視する（#5 St6 / #299）＝アプリの外からライブラリへ書き込む唯一の
// 経路。#302 以降、保存先フォルダ自体を見る2本目の監視は無い。投稿ごとの JSON をそこへ書くものは
// もう無いので（#298 でアプリ内の編集は DB へ、#299 で native host の保存はこのキューへ回った）、
// レコードの変化を求めてフォルダを見張るのは、もう起こり得ないことを見張ることになる。メディア
// ファイルは今もそこへ着地するが、取込キューのエンベロープの一部として届き、それ越しに見える。
//
// ここでの変化は、狙いを絞った照合ではなく全件の照合に値する。drainInbox は再実行が安く（適用
// 済みのイベントは索引の効いた SELECT 1回ずつ＝lib-db-inbox.ts のモジュールコメント）、取込
// キューのファイル名はイベント単位のヒントとして安全ではない（tmp/ からの rename、書き込み途中の
// 断片、セグメント圧縮による削除のどれでもここが発火し得る）。監視対象が常に存在するよう、
// ディレクトリを先に作る（設計コメント: "at startup, create the inbox directory first, then set
// up the watcher"）。
// 保留中の `replaces` マーカー（#34）があれば消化する＝重複保存の警告に対する「置き換える」の
// 回答で、native host は書き留めること（write-once）しかできず、実行するのはアプリの側。先に
// 取込キューを流し込む。マーカーを持つレコードは通常まだそこに残っているため。例外は投げない。
// 完了できなかった置き換えはマーカーを立てたまま残り、次のパスで再試行される。呼び出し元を
// 失敗させるよりそちらが確実に良い。
async function sweepReplacements() {
  const folder = getSaveFolder();
  const trashDir = getTrashDir();
  if (!folder || !trashDir) return;
  const handle = ensurePostsSynced();
  if (!handle) return;
  try {
    const report = await applyPendingReplacements({ sqlite: handle.sqlite, folder, trashDir, mediaExts: LIBRARY_MEDIA_EXTS });
    for (const r of report.applied) log.info(`replaced capture ${r.oldId} with ${r.newId} (#34) — the old capture is in the trash`);
    for (const f of report.failed) log.warn(`replacement ${f.oldId} -> ${f.newId} failed, will retry: ${f.error}`);
    // 印の索引は、作り直されるまで退役したキャプチャを名指ししたままになる。
    if (report.applied.length) scheduleSavedIndexWrite(handle);
  } catch (err) {
    log.error('replacement sweep failed:', err);
  }
}

let inboxWatcher: FSWatcher | null = null;
let inboxWatchDebounce: any = null;
// fs.watch ではなく chokidar（#11）。プラットフォーム差の正規化と、rename 検出の筋が1本に
// まとまる。プラットフォーム固有の fs.watch の癖を自前で追い回さずに済む。このディレクトリに
// 入るのは取込キューへ到着したファイルだけなので depth: 0（このディレクトリ直下のエントリだけ、
// 再帰しない）で足り、ignoreInitial は「監視を始めた時点で既にあったものには発火しない」という
// fs.watch の挙動に合う。
function watchInboxFolder() {
  if (inboxWatcher) {
    const closing = inboxWatcher;
    void closing.close().catch(() => {
      /* 既に閉じている */
    });
    inboxWatcher = null;
  }
  const folder = getSaveFolder();
  if (!folder) return;
  // #37: ここで保存先フォルダを mkdir で作り直すことは一切しない。getSaveFolder() は、そこに
  // もう何も無くても（アプリの外で移動・改名・アンマウントされた）設定の明示値をそのまま返す。
  // このチェックを入れる前は、下の ensureInboxDirs が起動のたびに無条件でフォルダを（空の
  // .hologram-inbox の木ごと）作り直していた。この Issue が止めようとしている「まっさらな空の
  // ライブラリに見える」不具合そのもの。監視は丸ごと省く。これをレンダラーへ出すのは
  // refreshLibraryStatus()。
  if (!fs.existsSync(folder)) {
    log.warn('save folder is missing — not watching or recreating it', { folder });
    return;
  }
  try {
    ensureInboxDirs(folder);
    inboxWatcher = chokidar.watch(inboxNewDir(folder), { depth: 0, ignoreInitial: true });
    inboxWatcher.on('all', () => {
      clearTimeout(inboxWatchDebounce);
      inboxWatchDebounce = setTimeout(() => {
        // 掃き寄せはイベントより前に走らせる。レンダラーの再取得の時点で置き換えが片付いて
        // いるように。そうしないと「置き換える」で保存したとき、1回の更新周期だけ両方の
        // レコードが見えて、その後に片方が黙って消える。
        void sweepReplacements().finally(() => {
          // null ＝ 全件の照合。この監視が狙いを絞ったヒントを送ろうとしない理由は関数の
          // コメントを参照。
          broadcast('posts-changed', null);
        });
      }, 400);
    });
  } catch (err) {
    console.error('Failed to watch inbox folder:', err);
  }
}

// レンダラーへの配信を通す唯一の口。'posts-changed' を投げるモジュールは全部ここを通る
// （ctx.send、バックアップエンジン、監視取り込みのマネージャ、このファイル自身の取込キューの
// 監視）。そのおかげで、レコードにジョブが要るかもしれないと索引キュー（#834）が知る場所が1か所
// で済む＝5か所の呼び出し側がそれぞれ伝え忘れないよう気を配らずに済む。ほかのチャンネルは
// そのまま sendToWin へ中継する。
function broadcast(channel: string, ...args: unknown[]) {
  if (channel === 'posts-changed') notifyRecordsChanged();
  sendToWin(channel, ...args);
}

// --- 投稿（DB が裏、#5） ---
// レンダラーが持つ投稿の配列は SQLite から来る（lib-db-query.ts）。コールドな起動は SELECT 1回
// であって、数万回の readFileSync+JSON.parse ではない。#302 以降、フォルダの走査はもう一切ない
// ＝DB が正本なので、読む前にディスクと突き合わせる必要はなく、拾わなければならない取り込みは
// 取込キューだけ（drainInbox、適用済みのイベント1件につき索引の効いた SELECT 1回）。
//
// hologram.db は保存先フォルダの中にある（#176）。今やデータベースこそが
// ライブラリの実体なので、ライブラリは自己完結した1つのフォルダになる＝コピーすればコピーが
// 自分の投稿を連れて行くし、バックアップすれば世代ストア（lib-db-generations.ts）が復元先と同じ
// フォルダについて回る。2026-07-21 のクラウド同期の懸念（同期
// クライアントが生きた書き込みと競合する）は、ライブラリの残りについて #95/#101 が既にやって
// いるのと同じ扱いにする＝選択時の警告（save-folder-guard.ts の cloudSyncProviderOf）であって、
// 1ファイルのための特別な置き場ではない。thumb-cache は configDir に残る＝データベースと違って
// 本当にローカルで、持ち運べない。

// DB の世代が残っていれば、その最新を `file` へ上書きコピーする。呼ばれるのは `file` がこれから
// 新規に作られるときだけ（存在しない、または破損していて今削除した）で、空のデータベースより
// 本物の復元ポイントが勝つように。作り直しの元になるディスク上の正本はもう無いので、世代がある
// ならそれは空より確実に良い。この後、#299 の取込キューの再生（ensurePostsSynced の
// drainInboxLogged）がスナップショット以降に起きたことを追いつかせ、#301 の孤児の合成
// （run-orphan-recovery）がスナップショットにも取込キューにも見えなかったものを回収できる。
// （latestRestorableSnapshot は lib-backup.ts のもの。ライブラリ自身の世代ストアを優先し、
// 無ければバックアップ先にあるその複製を代わりに使う＝#233。）
function restoreFromSnapshotIfAvailable(file: string): boolean {
  const snapshot = latestRestorableSnapshot();
  if (!snapshot || !fs.existsSync(snapshot)) return false;
  try {
    fs.copyFileSync(snapshot, file);
    log.warn(`restored hologram.db from DB generation: ${snapshot}`);
    return true;
  } catch (err) {
    log.error('failed to restore DB snapshot:', err);
    return false;
  }
}

// #37: レンダラーの get-library-status IPC 向けに、保存先フォルダの現在の状態（ディスク上に
// 無いかどうか）を返す＝呼ばれるたびに saveFolderStatus() を読み直すのであって、キャッシュした
// 旗ではない。レンダラーは起動時と、再試行・指し直しの後にこれを呼び直す。このモジュールがやる
// 「検出」はそれで全部で、専用のポーリングは無い（そもそも fs.watch はディレクトリが消えたことに
// 気づかない）。
function refreshLibraryStatus() {
  const status = saveFolderStatus();
  if (status.missing) log.warn('save folder is missing', { folder: status.folder });
  return { missing: status.missing, path: status.folder };
}
// 書き込みの防ぎ（clear-all / import* / relocate）が使う生きた確認＝上のキャッシュされた通知
// ではなく statSync を打ち直すので、セッションの途中で戻ってきたドライブ（再マウント、フォルダの
// 復旧）は、再起動を求めずに書き込みを解放する。
function isLibraryMissing() {
  return saveFolderStatus().missing;
}

let dbHandle: { db: any; sqlite: any } | null = null;
// 生きているデータベースファイルの名前を1か所に。今は複数の呼び出し元が要る（#233 のロール
// バックはこれを丸ごと置き換える）。場所は現在の保存先フォルダの中（#176）＝ライブラリを
// 切り替えると、config.saveFolder が切り替わった瞬間にこれは別の場所を指す。下の switchLibrary
// が頼っているのはまさにそこ。
function dbFile() {
  return path.join(getSaveFolder(), 'hologram.db');
}
// 今開いている dbHandle のライブラリを、この open で config.libraries[] へ記録済みかどうか
// （#176 の "最近使ったライブラリ" の一覧＋ライブラリごとのバックアップ・整合性の置き場）。
// closeDb() で dbHandle 自体と一緒にリセットするので、別々の open ＝コールドスタート、ロール
// バックのファイル差し替え、switchLibrary＝は、そのどれが次の ensureDb() を引くにせよ、ちょうど
// 1回ずつ記録する。
let libraryRecorded = false;
// 生きているハンドルを閉じて忘れる。次の ensureDb() がディスク上にあるものを開くように。
// 呼び出し元は #233 のロールバック（足元でファイルを差し替える＝開いたままの接続はそれを見る
// ことも許容することもできない）と #176 の switchLibrary（フォルダ自体がこれから変わる）。
function closeDb() {
  try {
    dbHandle?.sqlite.close();
  } catch (err) {
    log.warn('could not close the database cleanly:', err);
  }
  dbHandle = null;
  libraryRecorded = false;
}
// #176: データベースは保存先フォルダの中に入ったので、ディスク上に無いフォルダ（アプリの外で
// 移動・改名・アンマウントされた、#37）はデータベースにも届かないことを意味する。#176 より前は
// configDir にあり、DB を裏に持つハンドラ（get-tabs、get-tag-types、…）はメディアフォルダの
// 状態に関係なく動き続けていた。better-sqlite3 自身の "Cannot open database because the
// directory does not exist"（さらに悪く、黙って空のものを mkdir すること）が不透明な IPC の
// 拒否としてレンダラーへ届くより、何が起きたかを名指しするメッセージを付けてここできれいに断る
// 方が確実に良い。まさにこの状態のために、LibraryMissingState.tsx が本文の列を丸ごと差し替える。
function ensureDb() {
  if (dbHandle) return dbHandle;
  // 後片付けがすでにライブラリを閉じている（before-quit、このファイルの末尾）。起動時に仕掛けた
  // タイマーは終了処理の最中も発火し続ける。そのうちの1つのために新しい接続を開けば、もう誰も
  // 見ていないライブラリに対してマイグレーション・履歴の刈り込み・recordLibraryOpened を
  // 走らせることになる。
  if (quitting) throw new Error('the app is quitting — not reopening the library database');
  if (saveFolderStatus().missing) throw new Error('save folder is missing — cannot open the library database');
  const file = dbFile();
  if (!fs.existsSync(file)) restoreFromSnapshotIfAvailable(file);
  try {
    dbHandle = openDatabase(file);
  } catch (err) {
    if (!(err instanceof DatabaseCorruptError)) throw err;
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(file + suffix, { force: true });
      } catch {
        /* できる範囲で */
      }
    }
    restoreFromSnapshotIfAvailable(file);
    dbHandle = openDatabase(file);
  }
  if (!libraryRecorded) {
    libraryRecorded = true;
    try {
      recordLibraryOpened(getSaveFolder(), ensureLibraryId(dbHandle.sqlite));
    } catch (err) {
      log.warn('could not record the opened library in the recent list:', err);
    }
  }
  migratePosterKeyHost(dbHandle.sqlite);
  backfillPosterProfiles(dbHandle.sqlite);
  // #145 設計 §5:「掃除＝DB を開いた時に1回」＝ensureDb はメモ化されている（上の早期リターン）
  // ので、これが走るのは本当に新しく開いたときだけ。アプリの起動と、#176 のライブラリ切り替え
  // （closeDb() が dbHandle を消し、次の呼び出しがここで開き直す）。
  try {
    createDbWriter(dbHandle.sqlite).pruneHistory();
  } catch (err) {
    log.warn('history prune failed:', err);
  }
  return dbHandle;
}

// リリース前の1回限りのマイグレーション（#176）。この変更より前のインストールは hologram.db が
// configDir にある（以前の場所）。どちらのパスも開かれる前に、それを＝古いジャーナルが
// 孤立して残らないよう WAL/SHM のサイドカーごと＝保存先フォルダへ移す。走るのは古いファイルが
// あって新しいファイルが無いときだけ。新規インストールや移行済みのものは、それぞれ
// fs.existsSync 1回で何もしない。#176 より前のインストールが1つも残らなくなったらこれは削除する
// （プロジェクトの作法として、1回限りのマイグレーションは作業の工程であって設計の一部ではない
// を参照）。
function migrateDbIntoSaveFolder() {
  const folder = getSaveFolder();
  if (!folder || !fs.existsSync(folder)) return;
  const oldBase = path.join(configDir(), 'hologram.db');
  const newBase = dbFile();
  if (!fs.existsSync(oldBase) || fs.existsSync(newBase)) return;
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(oldBase + suffix)) fs.renameSync(oldBase + suffix, newBase + suffix);
    }
    log.info('migrated hologram.db from the config directory into the library folder (#176)');
  } catch (err) {
    log.error('failed to migrate the database into the library folder — leaving it where it was:', err);
  }
}

function getDbWriter() {
  return createDbWriter(ensureDb().sqlite);
}

// ブリッジが出す "saved" の印（#5 St6 / #299＝bridge.mts の "Saved-post index" コメントを参照）
// のもう半分。DB から作り直した小さな postKey→captureId の対応表を、保存先フォルダではなく
// configDir へ書く（ライブラリのメディアの隣に落ちないように）。デバウンス＋アトミック（tmp ＋
// rename）。できる範囲でよく、古かったり無かったりするファイルは、ブリッジをその先のジャーナル
// ＋loose な取込キューの再走査を代わりに使わせるだけ。間違うことはなく、アプリ側の変更が反映される
// のが遅くなるだけ。
let savedIndexTimer: any = null;
// このプロセスで ensurePostsSynced がスナップショットを一度用意したら立てる（#466）。これが
// 無いと、取込キューから何も流し込まず孤児も回収しなかった起動では scheduleSavedIndexWrite が
// 一度も呼ばれず、DB 自体にはレコードがあるのに、ブリッジは保存状態の問い合わせにいつまでも
// ジャーナル＋loose な取込キューという代わりの手段から答えることになる。
let savedIndexPrimed = false;
// バックアップエンジンの noteLibraryMutation ができ次第そこへ繋ぐ（もっと下＝このパイプラインを
// 必要とするので、これより上では組み立てられない）。この関数は、ライブラリへの変更がすでに全部
// 通っている唯一の口（取込キューの流し込み、ゴミ箱の操作、取り込み、孤児の回収）なので、何かが
// 変わったとバックアップのレーンが知る場所として正直なところ。メディアのレーンは「保存の直後」
// のカウントダウンを始め、DB のレーンは次の世代へ向けて数える（#233）。
let onLibraryMutation: (() => void) | null = null;
// 書き込みそのもの。#176 の switchLibrary が、下のデバウンスを待たずに新しいライブラリを開いた
// 直後すぐ走らせられるよう切り出した＝拡張機能の "saved" の印は、最大1.5秒遅れではなく即座に
// 新しいライブラリを映さなければならない（その間に、このライブラリに既にあるものを保存し直すと、
// 新規だと誤って報告されてしまう）。
async function writeSavedIndexNow(handle: { sqlite: any }) {
  try {
    // ゴミ箱の側（#158）は DB ではなくファイルシステムから来る。ゴミ箱へ入れた投稿には
    // posts の行がそもそも無い。listTrashRecords はゴミ箱の表示自体が読むのに使うものなので、
    // 仕込まれたレコードもここで正規化される（#324）。読めないゴミ箱フォルダは、書き込み全体を
    // 失敗させるのではなく通知を1件も出さない＝保存済みの側の方が重要。
    const trashDir = getTrashDir();
    const trash = trashDir ? (await listTrashRecords(trashDir)).map((r) => ({ captureId: r.captureId, url: r.url, trashedAt: r.trashedAt })) : [];
    const data = buildSavedIndex(handle.sqlite, trash);
    const dir = configDir();
    fs.mkdirSync(dir, { recursive: true });
    writeFileAtomicSync(path.join(dir, SAVED_INDEX_FILE), JSON.stringify(data));
  } catch {
    /* できる範囲で＝ブリッジはジャーナル＋loose な取込キューの走査を代わりに使う */
  }
}
// デバウンスがまだ抱えているもの。終了処理がそれを完了できるように（下）。状態を2つに分けて
// あるのは、どちらでも書き込みが失われるため。`pending` はタイマーがまだ発火していない変更、
// `inFlight` は発火済みだが書き込みがまだ着地していないもの（ゴミ箱の側は `.trash/` を非同期に
// 読む）。
let savedIndexPending: { sqlite: any } | null = null;
let savedIndexInFlight: Promise<void> | null = null;
function scheduleSavedIndexWrite(handle: { sqlite: any }) {
  onLibraryMutation?.();
  clearTimeout(savedIndexTimer);
  savedIndexPending = handle;
  savedIndexTimer = setTimeout(() => {
    savedIndexPending = null;
    savedIndexInFlight = writeSavedIndexNow(handle).finally(() => {
      savedIndexInFlight = null;
    });
  }, 1500);
}
// 投稿を削除して1.5秒のデバウンスの内にアプリを閉じると、以前は書き直しが丸ごと落ちていた。
// タイマーはプロセスと一緒に死ぬので、ゴミ箱にある投稿について拡張機能は次の起動まで "saved" と
// 答え続けた＝#158 が防ぐために存在する、まさにその古くなった印。before-quit から await する。
async function flushSavedIndexWrite() {
  clearTimeout(savedIndexTimer);
  const handle = savedIndexPending;
  savedIndexPending = null;
  // 飛行中のものが先。そちらの方が先に予約されていて、ファイルには2つの状態のうち後の方が
  // 残らなければならない。
  if (savedIndexInFlight) await savedIndexInFlight;
  if (handle) await writeSavedIndexNow(handle);
}

// .hologram-inbox/new を DB へ流し込む（#5 St6 / #299）＝エンベロープ1件につき受領記録の付いた
// トランザクション適用が1回、その後も loose ファイルは残す（lib-db-inbox.ts を参照）。飛ばした
// ものは何であれログに出す（メディアが無い、ハッシュ／投稿の衝突、壊れたか版の分からない
// エンベロープ、例外を投げた適用）ので、詰まったキャプチャは追える。例外は投げない＝drainInbox
// 自体、1つの悪いファイルで残りを止めることは決してないし（#920 で、エンベロープを
// .hologram-inbox/failed/ へ隔離することにより、想定外の例外についてもそれが成り立つように
// なった）、ここでの同期的な fs エラー（フォルダが一時的に使えない）は、このパスが何も見つけ
// なかったという意味でしかなく、呼び出し元の同期を失敗させる理由ではない。
function drainInboxLogged(folder: string, sqlite: any) {
  try {
    const report = drainInbox(folder, sqlite);
    // 実際にライブラリまで届いた captureId を名指しする（#519）。以前は飛ばしたものと失敗した
    // ものしかログに出ておらず、「保存は成功したのに投稿がライブラリに無い」はこちら側に記録が
    // 一切なかった。host 自身が capture.log に出す `bridge/ok` の行も「ディスクに書いた」で
    // 止まる。2つのログを繋ぐのが captureId で、だからこそ保存の経路全体が両者にまたがって
    // 読める。これを、別のプロセスが持つファイルへ追記するのではなく main.log に置いているのは
    // そのため。
    if (report.applied.length) log.info(`inbox applied ${report.applied.length}: ${report.applied.join(' ')}`);
    for (const s of report.skipped) {
      const line = `inbox drain skipped ${s.file}: ${s.reason}${s.detail ? ` (${s.detail})` : ''}`;
      // 列挙された skip は想定内の状態（メディアがまだ同期中、衝突する再生）。apply-failed は
      // 説明が付かず隔離したエンベロープ（#920）なので、こちらは大きく出す。毎回の流し込みでは
      // なく1回だけ現れ、いま failed/ にあるファイルを指す。
      if (s.reason === 'apply-failed') log.error(line);
      else log.warn(line);
    }
    if (report.segmentsReplayed.length) log.info(`inbox replayed ${report.segmentsReplayed.length} segment(s) with no DB receipt yet (DB-loss recovery path)`);
    scheduleInboxCompaction(folder, sqlite);
    return report;
  } catch (err) {
    log.error('inbox drain failed:', err);
    return { scanned: 0, applied: [], receiptOnly: [], noop: 0, skipped: [], segmentsReplayed: [] };
  }
}

// 暇なときの圧縮（#5 St6 / #299 の設計コメント "retention volume and compaction"）。
// scheduleSnapshot / scheduleSavedIndexWrite と同じくデバウンスしてあるので、保存が固まって来て
// も、流し込みのたびではなく落ち着いてから1回だけ動く。compactInbox 自体、loose なイベント
// 1,000件のしきい値を下回れば何もしないので、流し込みのたびにこれを呼んでも普通は COUNT 相当の
// 問い合わせ1回で済む。
let compactionTimer: any = null;
function scheduleInboxCompaction(folder: string, sqlite: any) {
  clearTimeout(compactionTimer);
  compactionTimer = setTimeout(() => {
    try {
      const report = compactInbox(folder, sqlite);
      if (report.compacted) log.info(`inbox compacted ${report.eventCount} event(s) into segment ${report.segmentId}`);
    } catch (err) {
      log.error('inbox compaction failed:', err);
    }
  }, 1500);
}

// DB を開いて取込キューを流し込む＝posts テーブルを最新と見なせるようになるまでに起きなければ
// ならないこと全部。開いたハンドルを返す（保存先フォルダがまだ設定されていなければ null）。
// 書き込みのハンドラがこれを共有するのは、投稿単位の DB 書き込みが、その captureId に posts の
// 行が既にあることを前提とするため。IPC の呼び出しがレンダラー自身の最初の listPosts() より後に
// 届く保証は無い。
function ensurePostsSynced() {
  const folder = getSaveFolder();
  if (!folder) return null;
  // #176: switchLibrary() が飛行中（古いデータベースを閉じてから新しいものを開くまでの間）。
  // ここへ紛れ込んだ呼び出し元（具体的には起動時に仕掛けた sweepReplacements / purgeOldTrash /
  // 整合性チェックのタイマー。旗を見るような作りではなく一発ものなので、switchLibrary 自身の
  // 「書き込みを止める」相には入っていない）が、自分で ensureDb() を呼んではいけない。
  // switchLibrary 自身の writeConfig がポインタを切り替える直前に古いライブラリを開き直すか、
  // 閉じる／開き直すの組と正面から競合するかのどちらかになる。これを「ライブラリが無い」と
  // まったく同じに扱えば、どの呼び出し元も既に対応できている。データベースを閉じ終えた終了処理も
  // 同じ（ensureDb を参照）。以前は同じ一発もののタイマーが閉じたハンドルへ届き、終了のたびに
  // "inbox drain failed: TypeError: The database connection is not open" の2行を出していた。
  if (switching || quitting) return null;
  const handle = ensureDb();
  // このパスが流し込むものを見つけたかどうかに関係なくスナップショットを用意する＝
  // buildSavedIndex は索引の効いた SELECT 2回で、DB の最終書き込みに対してファイルの鮮度を
  // 追いかけるより、起動のたびに無条件で走らせて構わない程度に安い。
  if (!savedIndexPrimed) {
    savedIndexPrimed = true;
    scheduleSavedIndexWrite(handle);
  }
  const inboxReport = drainInboxLogged(folder, handle.sqlite);
  if (inboxReport.applied.length) scheduleSavedIndexWrite(handle);
  return handle;
}
async function listPosts() {
  const handle = ensurePostsSynced();
  if (!handle) return { saveFolder: null, posts: [], profiles: [] };
  const posts = await postsFromDb(handle.sqlite);
  return { saveFolder: getSaveFolder(), posts, profiles: savedPosterProfilesFromDb(handle.sqlite) };
}

// レンダラー向けの差分版。更新のたびに約9千件のレコード全部を IPC 越しに直列化すると約450ms
// かかるので、ウィンドウが全件を持ち、main は追加・更新・削除されたレコードだけを送る。
// `haveBaseline` は、最後の全件をまだ持っているというレンダラーの申告。どちらかの側にそれが無い
// とき（main が冷えている、フォルダの切り替え、読み込み直してキャッシュを失ったレンダラー）は
// 全件のスナップショットを送り直し、両側で同期を取り直す。
//
// 形は1つ、ヒントは無し。今や全投稿を読むのは SELECT 1回なので、差分は常に読み直した全件に対して
// 計算され、常に信頼できる。#302 より前はここが fs-watch のファイル名ヒントで分岐していた。何が
// 動いたかを知る代わりの手段が、数万件のサイドカーを読み直すことだったため＝ヒントは、DB には
// 無いコストを避けるために存在していた。
//
// #32 St1（設計文書で最優先の正しさの修正）: この基準はかつてプロセス全体で
// `_deltaFolder`/`_lastSent` の1組だった。呼んでくるレンダラーが1つしかない間はそれで良かった。
// 2つ目のウィンドウが出た時点で黙って壊れた＝ウィンドウ B の差分呼び出しがウィンドウ A の
// 「最後に何を見たか」の帳簿を上書きし、A の次の呼び出しは自分のではなく B の基準に対して差分を
// 計算して、実際には一度も見せていない更新を落とし得た。代わりに呼び出し元の webContents の id を
// キーにしてあるので、同じティックでポーリングする2つのウィンドウが互いを踏むことはない。
// ウィンドウが閉じたらそのエントリは捨てる（下の 'web-contents-created' のリスナーを参照）ので、
// ウィンドウを何度も開閉するセッションでもここが無制限に育つことはない。
interface DeltaBaseline {
  folder: string | null;
  lastSent: Map<string, unknown>; // captureId → このレンダラーへ最後に届けた updatedAt
}
const _deltaBySender = new Map<number, DeltaBaseline>();
async function listPostsDelta(haveBaseline: boolean, senderId: number) {
  const folder = getSaveFolder();
  if (!folder) {
    _deltaBySender.delete(senderId);
    return { saveFolder: null, full: true, posts: [], profiles: [] };
  }
  const handle = ensurePostsSynced();
  if (!handle) return { saveFolder: null, full: true, posts: [], profiles: [] };

  const posts = await postsFromDb(handle.sqlite);
  const profiles = savedPosterProfilesFromDb(handle.sqlite);
  const stamps = new Map<string, unknown>(posts.map((p: any) => [p.captureId, p.updatedAt]));
  const baseline = _deltaBySender.get(senderId);
  if (!haveBaseline || !baseline || baseline.folder !== folder) {
    _deltaBySender.set(senderId, { folder, lastSent: stamps });
    return { saveFolder: folder, full: true, posts, profiles };
  }
  const { added, removed } = computeDelta(baseline.lastSent, posts, stamps);
  _deltaBySender.set(senderId, { folder, lastSent: stamps });
  return { saveFolder: folder, full: false, added, removed, profiles };
}
// このプロセスが作る webContents は全部（すべてのウィンドウと、単体の画像ビューアのポップアップ
// ＝害は無い、list-posts-delta を呼ばない）ここで見張る。閉じたウィンドウの上のエントリを、
// 永遠に持ち続けるのではなく捨てるため。
app.on('web-contents-created', (_e, contents) => {
  contents.once('destroyed', () => _deltaBySender.delete(contents.id));
});

// #29: タブをまたぐ全文検索。listPosts が使うのと同じ同期済みの DB に対する読み取り専用＝別の
// 同期の経路は無いので、ヒットがグリッド自体より古くなることはない。どの投稿が一致するかを
// 決めるのはレンダラー（services/fulltext.ts が、posts_fts のまだ索引していない欄も含めて、
// タブ内のクイック検索と同じ照合を走らせる＝#288）。ここが供給するのは、そのヒットのうち
// posts_fts も覆っているものについての bm25() の関連順だけ。
async function searchFullText(query: string, limit?: number) {
  const handle = ensurePostsSynced();
  if (!handle) return [];
  return searchPostsFts(handle.sqlite, query, limit);
}

// --- ストレージのリダイレクトの番人（#1009） ---
// configDir か実効の保存先フォルダが OS のストレージ仮想化に黙ってリダイレクトされているなら、
// ブロッキングのダイアログを出して起動を止める＝なぜ、どうやって検出するかは
// lib-storage-redirect-guard.ts を参照。whenReady の中で最初に呼ぶ。initSaveFolderRedundancy
// より前、どちらのディレクトリを読み書きするものより前。
//
// ログの1行ではなくダイアログにしてある。2026-06-23 の事故（約9082件、paths.mts のヘッダ）は、
// その間ずっと main.log に警告が読まれないまま置かれた状態で起きた＝誰も読まない警告は対策では
// ない。showMessageBoxSync は閉じられるまでブロックし、その直後の app.exit(1) は、ここから先
// （ウィンドウの生成、host の登録、データベースを開くこと）がリダイレクト先に触れることは一切
// ないことを意味する。止めたときは true を返すので、呼び出し元は whenReady のコールバックの
// 残りを打ち切れる。
function haltIfStorageRedirected(): boolean {
  const targets: Array<{ label: string; dir: string; ensureDir: boolean }> = [
    // configDir を作るのはこちらの仕事で、新規インストールではまだ作られていない＝初回起動で
    // 走れない番人は番人ではない。
    { label: '設定フォルダ', dir: configDir(), ensureDir: true },
    // ⚠️ 保存先フォルダを作ることは一切しない。それが無いことは、ドライブが外れたか同期フォルダ
    // が消えたという #37 の合図で、clear-all／移設／バックアップはいずれもそれを根拠に断る。
    // この番人の最初の版は両方を mkdir し、その合図を黙って消していた（2026-08-07:
    // test-app-library-missing.cts の5件のチェックが、緑だが誤りの状態になった）。本当に
    // 無くなった保存先フォルダは下の 'check-failed' に落ち、#37 の管轄のままになる。
    { label: 'ライブラリの保存先', dir: getSaveFolder(), ensureDir: false },
  ];
  const hits: string[] = [];
  for (const { label, dir, ensureDir } of targets) {
    const result = checkForRedirect(dir, { ensureDir });
    // check-failed（ディレクトリが無い、権限が無い、…）は意図してヒット扱いにしない＝#1009 の
    // 3つ目の受け入れ基準。走れなかったチェックが、問題を見つけたチェックと同じように起動を
    // 止めてはいけない。
    if (result.status !== 'redirected') continue;
    log.error(`storage redirect detected (#1009): ${label} (${dir}) resolves to ${result.realPath}`);
    hits.push(`${label}\n本来の場所: ${dir}\n実際の書き込み先: ${result.realPath}`);
  }
  if (!hits.length) return false;
  dialog.showMessageBoxSync({
    type: 'error',
    title: 'Hologram を起動できません',
    message: 'データが本来と違う場所へ保存される状態を検出しました',
    detail: `${hits.join('\n\n')}\n\nこのまま起動するとデータが見えない場所に保存されるため、起動を中止しました。`,
  });
  app.exit(1);
  return true;
}

// --- native host の登録（何度実行しても同じ、起動ごと） ---
function ensureHostRegistered() {
  try {
    // ランチャーは毎回書き（直）す。install() は今や非 ASCII の Electron パスを ASCII の
    // ディレクトリジャンクション経由にする（native-host/install.js を参照）ので、起動ごとの
    // 書き直しは安全で、化けた非 ASCII のパスを直に指していた古い壊れたランチャーを自分で
    // 直せる。extensionId は、設定にあれば install() が読む。
    installer.install({ exe: process.execPath, runAsNode: true });
  } catch (err) {
    console.error('Failed to register native messaging host:', err);
  } finally {
    // install() は writeConfig を通さずに config.json を書き得る（#61＝install.mts の
    // persistExtensionId）。ここでは id を渡さないので今のところ実際には書かない。それでも
    // キャッシュは捨てる。キャッシュの正しさが、lib-config.ts から遠い呼び出し箇所の引数に
    // 依存しないように。
    invalidateConfigCache();
  }
}

// --- 画像のプロトコル ---
// asset:// のハンドラ、MIME の表、?w=N の裏にあるサムネイルのプールとキャッシュは
// ./lib-thumbnails.ts へ切り出した（下の registerImageProtocol 経由で登録する。あちらは
// ここから resolveInFolder を受け取る）。

// --- IPC ---
// 設定・環境設定・タブのハンドラ（get-config / get-extension-contact / get-prefs / set-pref /
// app-info / get-tabs / set-tabs / window-control）は ./ipc-config.js へ切り出した（下の
// ipcConfig.register 経由で登録する）。

// 投稿のハンドラ（list-posts / list-posts-delta / image-data-url）は ./ipc-posts.js へ
// 切り出した（下の ipcPosts.register 経由で登録する）。

// 整理の層のハンドラ（tag-types / ungrouped / manual-groups / folders / collections /
// poster-folders / poster-tags）は ./ipc-organize.js へ切り出した（下の
// registerOrganize(ipcCtx) 経由で登録する）。

// ウィンドウ・シェルのハンドラ（open-external / open-image-window）は ./ipc-window.js へ
// 切り出した（下の ipcWindow.register 経由で登録する）。

// --- ファイルの補助（すべて保存先フォルダの中に閉じる） ---
// 規則そのもの（名前が取り得る形と、解決先に対する内包の確認）は lib-save-folder-path.ts に
// ある＝Electron に依存しないので単体テストでき、取込キューの流し込みとゴミ箱の掃き寄せが同じ実体を
// 共有する。
//
// ここに残るのは、生きている保存先フォルダへの束縛。これはすべてのファイルハンドラが共有する
// 規則（image-data-url、ゴミ箱の掃き寄せ、ドラッグでの持ち出し）なので、束縛済みの形は、最初の
// 呼び出し元ではなく、それを全員へ渡す組み立ての側に属する。
function resolveInFolder(name: string): string | null {
  return resolveInSaveFolder(getSaveFolder(), name);
}

// ダウンロードしたライブラリのファイルが取り得る拡張子の全部。「表示側が表示できるか」の一覧
// ではない。pixiv のうごイラのアーカイブは、直接表示するものが何も無い .zip だが（#119 St3）、
// 下の掃き寄せがキャプチャのファイルを列挙するのでここに属する＝拡張子を1つ取りこぼせば孤児が残る。
const LIBRARY_MEDIA_EXTS = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'svg', 'mp4', 'webm', 'mov', 'm4v', 'zip'];

// ファイル名から captureId の base を取り戻す。引数は主画像（<base>.<ext>）、poster 画像
// （<base>-poster.<ext>）、メディアファイルそのもののいずれでもよい。先に -poster の印を
// 剥がし、次に拡張子を剥がす。
function baseOf(name) {
  return path
    .basename(name || '')
    .replace(/-poster\.[a-z0-9]+$/i, '')
    .replace(/\.[a-z0-9]+$/i, '');
}

// --- ゴミ箱（ソフト削除） ---
// TRASH_SUBDIR はここで宣言せず import する。ここが書き込むディレクトリと、resolveInFolder が
// 配信元にするディレクトリは同じでなければならない（#267）。
const TRASH_DAYS = 30;
function getTrashDir() {
  const folder = getSaveFolder();
  return folder ? path.join(folder, TRASH_SUBDIR) : null;
}
// ゴミ箱の中で TRASH_DAYS より古いものを削除する。起動時に呼ぶ。
async function purgeOldTrash() {
  const trashDir = getTrashDir();
  if (!trashDir) return;
  let names: string[];
  try {
    names = await fs.promises.readdir(trashDir);
  } catch {
    return;
  }
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  const toPurge = new Set();
  for (const f of names) {
    if (!f.toLowerCase().endsWith('.json')) continue;
    const id = f.slice(0, -5);
    try {
      const rec = parseJsonLoose(await fs.promises.readFile(path.join(trashDir, f), 'utf8'));
      if (rec.trashedAt && Date.parse(rec.trashedAt) < cutoff) toPurge.add(id);
    } catch {
      /* 壊れたサイドカー＝飛ばす */
    }
  }
  if (!toPurge.size) return;
  for (const f of names) {
    for (const id of toPurge) {
      if (f.startsWith(id + '.') || f.startsWith(id + '-')) {
        try {
          await fs.promises.unlink(path.join(trashDir, f));
        } catch {}
        break;
      }
    }
  }
  // 期限切れのレコードについての「ゴミ箱にある」という通知も、一緒に期限切れにしなければ
  // ならない（#158）。投稿はもう完全に消えていて、ブリッジが読むのは索引だけ。ほかに書き直す
  // ものは無い＝このパスは DB の行に触れない。purgeOldTrash は投げっぱなし（起動時のタイマーで、
  // 誰も await しない）なので、開けないデータベースが未処理の拒否としてここに出てこないよう
  // 囲ってある。どちらにせよファイルはもう消えている。
  try {
    scheduleSavedIndexWrite(ensureDb());
  } catch {
    /* 索引は次の書き込みまで古い通知を持ち続ける。削除そのものは成立している */
  }
}

// ゴミ箱とタグ更新のハンドラ（delete-post / list-trash / restore-post / empty-trash /
// delete-from-trash / update-tags）は ./ipc-trash.js へ切り出した（下の ipcTrash.register
// 経由で登録する）。

// 移送のハンドラ（import-legacy-zip / clear-all / export-save / export-complete /
// import-complete）は ./ipc-transfer.js へ切り出した（下の ipcTransfer.register 経由で
// 登録する）。exportStamp もそちらへ移した。

// --- バックアップ ---
// 2レーンのエンジン、その予定、宛先の検証、#301 の整合性のパスは ./lib-backup.ts へ切り出した。
// エンジンをここで生成するのは、上のレコードのパイプラインを必要とするため（実行は、スナップ
// ショットを取る前・それに対して孤児を数える前に DB を同期しなければならない）。
const { runBackup, listDbGenerations, rollbackDbGeneration, armBackupSchedule, runStartupIntegrityCheck, runOrphanRecovery, noteLibraryMutation, isBusy: isBackupEngineBusy } = createBackupEngine({ ensurePostsSynced, scheduleSavedIndexWrite, send: broadcast, dbFile, closeDb });
onLibraryMutation = noteLibraryMutation;
const watchImport = createWatchImportManager({ readConfig, writeConfig, getSaveFolder, isLibraryMissing, ensurePostsSynced, send: broadcast });

// --- ライブラリの切り替え（#176） ---------------------------------------
// データベースがライブラリフォルダの中へ移った今（dbFile() のコメントを参照）、#37 の指し直しを
// 一般化したもの。指し直しはかつてコピーの要らないポインタの切り替えだった。saveFolder が何を
// 指していてもデータベースは configDir に留まったので、ほかに何も起きる必要が無かった。今は
// データベース自体を閉じ、ポインタを切り替え、新しい場所でデータベースを開く（あるいは作る、
// あるいはスナップショットから復元する＝ensureDb() が既に3つともやっている）。関数は1つ。
// どのライブラリが開いているかを変える呼び出し元は全部ここを通る。設定の "切り替え"/"新規作成"
// の流れ、"最近使ったライブラリ" の行、そして下の apply-repoint（保存先フォルダが無いときの
// #37 の逃げ道）。
let switching = false;
async function waitForBackupEngineIdle(maxMs = 15000) {
  const start = Date.now();
  while (isBackupEngineBusy() && Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 150));
  }
}
async function switchLibrary(dest: string): Promise<{ ok: true; saveFolder: string } | { ok: false; error: string }> {
  const v = validateSaveFolder(dest);
  if (!v.ok) return { ok: false, error: v.error || 'invalid' };
  const classification = classifyLibraryFolder(dest);
  if (classification === 'reject') return { ok: false, error: 'not-a-library' };
  if (switching) return { ok: false, error: 'busy' };
  switching = true;
  const from = getSaveFolder();
  try {
    // 現在のライブラリへ書き込むものを、閉じる前に全部止める。取込キューの監視はきっぱり閉じる
    // （新しいライブラリが開くまで仕掛け直さない）。バックアップエンジンの2つのレーンは中断では
    // なく待つ＝世代の書き込みの途中で closeDb() を呼べば、DB のレーンがスナップショットを
    // 取っている当のファイルを引き裂くことになる。
    if (inboxWatcher) {
      const closing = inboxWatcher;
      inboxWatcher = null;
      await closing.close().catch(() => {});
    }
    await waitForBackupEngineIdle();

    closeDb();
    savedIndexPrimed = false; // 次のライブラリは自分の saved-index のスナップショットを自分で用意する

    const cfg = readConfig();
    cfg.saveFolder = dest;
    writeConfig(cfg);

    try {
      // 分類が示していたことは、ensureDb() が既に全部やっている。hologram.db をそのまま開く
      // （'has-db'）、ファイルが無ければ開く前に最新の世代のスナップショットを復元する
      // （'evidence-no-db'＝既にある回収の経路で、新しい仕掛けは無い）、新しく作る（'empty'）。
      // recordLibraryOpened（ensureDb の中）もここで動く。
      ensureDb();
    } catch (err: any) {
      // ここまでに、ただ指し直して戻すだけでは取り消せないような永続的なことは何も起きて
      // いない。ポインタを戻し、離れたライブラリを開き直す。
      log.error(`switchLibrary: could not open the database at ${dest} — rolling back to ${from}:`, err);
      const back = readConfig();
      back.saveFolder = from;
      writeConfig(back);
      try {
        ensureDb();
      } catch {
        /* dbHandle は null のまま＝LibraryMissingState と空状態の UI が引き継ぐ */
      }
      switching = false;
      watchInboxFolder();
      void watchImport.refresh();
      return { ok: false, error: 'open-failed' };
    }
    // ここから先、新しいデータベースは開いていて安定している＝外側の finally ではなく今すぐ
    // 番人を下ろす。下の ensurePostsSynced()（と、起動時のタイマーが同時に動かすもの）が、この
    // 関数全体が返るまで待たされず、すぐ新しいライブラリを見られるように。
    switching = false;

    // 上で止めたものを全部、新しいライブラリに対して繋ぎ直す。
    watchInboxFolder();
    void watchImport.refresh();
    _deltaBySender.clear();
    // #834: キューがまだ抱えていた captureId は全部、今閉じたライブラリのもの。（走り切らせる
    // のではなく）捨てることで走査の境界もリセットされるので、下の全件の歩き直しが新しい
    // ライブラリのレコードに対してゼロから始まる。
    clearIndexQueue();
    // 前のライブラリのハンドルをまだ抱えているデバウンスは、吐き出さずに捨てる。下の書き込みが
    // それに取って代わるし、後から着地させると＝自分のタイマーで、あるいは終了時の吐き出しで＝
    // 利用者がたった今離れたライブラリを、拡張機能が読む索引へ戻してしまう。
    clearTimeout(savedIndexTimer);
    savedIndexPending = null;
    const synced = ensurePostsSynced();
    // デバウンスされた scheduleSavedIndexWrite ではなく即時＝writeSavedIndexNow の
    // コメントを参照。
    if (synced) await writeSavedIndexNow(synced);
    requestBackfill({ full: true });

    // すべてのウィンドウを新しいライブラリに対して読み込み直す。ただし、この呼び出し自身の返答が
    // 着地する余地を作った後で、その場ではない。ここで読み込み直すと呼び出し元のフレームが先に
    // 壊れ、switch-library を await していたレンダラーは値も拒否も受け取れなかった（単に決着
    // しなかった）。"切り替えました" のトーストも一緒に片付けられ、呼び出し元が次にやることは
    // 飛行中に死んだ。#233 のロールバックがまさに同じ理由で既にこの遅延で読み込み直している＝
    // 定数と残りの論拠は lib-window.ts が持つ。夜間のスイートで見つかった。遅いランナーで
    // ハーネスの切り替え後の IPC 呼び出しが競争に負け、60秒のスモークの受け皿まで止まっていた
    // （Refs #917）。
    setTimeout(() => {
      for (const w of getWindows()) {
        if (!w.isDestroyed()) w.webContents.reload();
      }
    }, RELOAD_AFTER_LIBRARY_SWAP_MS);

    return { ok: true, saveFolder: dest };
  } finally {
    switching = false;
  }
}

// --- ウィンドウ ---
// 位置と大きさの永続化、ナビゲーションの封鎖、createWindow は ./lib-window.ts へ切り出した。
// あちらは `win` の束縛（getWin / sendToWin）も持つ。

// --- 切り出した IPC の登録 ---
// 下のハンドラは、かつてこのファイルの中に直に書かれた ipcMain.handle(...) の呼び出しだった。
// 一字一句そのまま ./ipc-*.js のモジュールへ移し、それぞれが register(ctx) を公開している。
// ハンドラが閉じ込めているコアの補助と状態を出す ctx を1つ組み立て、直書きのハンドラが走って
// いたのと同じトップレベルの地点（whenReady の前）でここに登録する＝ipcMain.handle は app-ready
// に対する順序の依存を持たないし、登録をトップレベルに置けば早すぎるレンダラーの IPC と競争せずに
// 済む。書き換わる状態（win、設定破損の旗、差分）は値ではなくアクセサ経由で出すので、クロージャは
// 生きている束縛を読む。型注釈こそが要点（#228）。すべての register(ctx) が型付けされる相手が
// `IpcContext`（./ipc-context.ts）なので、ここで補助を改名したり形を変えたりすれば、clear-all /
// import-complete / move-save-folder を運ぶこの境界で、実行時ではなくビルドのエラーになる。
function registerExtractedIpc() {
  const ctx: IpcContext = {
    getSaveFolder,
    getDbWriter,
    ensurePostsSynced,
    scheduleSavedIndexWrite,
    sweepReplacements,
    listPosts,
    listPostsDelta,
    searchFullText,
    resolveInFolder,
    mimeForFile,
    readConfig,
    writeConfig,
    invalidateConfigCache,
    readAiConfig,
    writeAiConfig: (patch) => {
      const next = writeAiConfig(patch);
      // #834: AI の機能が切れていたために飛ばしたレコードは痕跡を一切残さない＝それが要点
      // （利用者が断ったときに片付けるものが無い）。だからゲートが開いた瞬間、そのレコードを
      // もう一度見つける手立てはライブラリをもう一度歩くことだけ。
      if (next.enabled) requestBackfill({ full: true });
      return next;
    },
    APP_ICON,
    getTrashDir,
    defaultLibraryDir,
    baseOf,
    LIBRARY_MEDIA_EXTS,
    readBackupConfig,
    writeBackupConfig,
    validateBackupDir,
    armBackupSchedule,
    runBackup,
    listDbGenerations,
    rollbackDbGeneration,
    readIntegrityStatus,
    runOrphanRecovery,
    readSavePointer,
    clearAllBlockReason,
    getLibraryStatus: refreshLibraryStatus,
    isLibraryMissing,
    pixivRefererFor,
    downloadAvatar,
    validateSaveFolder,
    relocateLibrary,
    switchLibrary,
    classifyLibraryFolder,
    listRecentLibraries,
    removeRecentLibrary,
    closeDb,
    openDb: () => {
      ensureDb();
    },
    watchInboxFolder,
    watchImportFolders: () => watchImport.refresh(),
    getWatchImportConfig: () => ({ folders: watchImport.folders(), status: watchImport.status() }),
    setWatchImportFolders: async (folders, markExisting = []) => {
      const result = await watchImport.setFolders(folders, markExisting);
      return { folders: result.folders, status: result.status };
    },
    getWin,
    isConfigCorrupt,
    resetDelta: () => {
      _deltaBySender.clear();
    },
    send: broadcast,
    sendExcept: sendToOtherWins,
    // #32 St1: tabs.json の番人（ipc-config.ts の get-tabs/set-tabs）＝主ウィンドウの送り手
    // だけが読み書きできる。だからこれは（主ウィンドウにとっては）何もしない確認であって、
    // 将来の呼び出し元が忘れ得る呼び出し箇所ごとの分岐ではない。
    isPrimarySender: (webContentsId) => getWin()?.webContents.id === webContentsId,
    openNewWindow: () => {
      createWindow(true, { secondary: true });
    },
    pinSend: (items, newWindow) => pinSend(items, newWindow),
    pinGetInitial: (webContentsId) => pinTakeInitial(webContentsId),
    pinToggleAlwaysOnTop: (webContentsId) => pinToggleAlwaysOnTopImpl(webContentsId),
  };
  ipcOrganize.register(ctx);
  ipcPosts.register(ctx);
  ipcConfig.register(ctx);
  ipcWindow.register(ctx);
  ipcPin.register(ctx);
  ipcWatchImport.register(ctx);
  ipcTrash.register(ctx);
  ipcBackup.register(ctx);
  ipcTransfer.register(ctx);
  ipcTagVocab.register(ctx);
  ipcHistory.register(ctx);
  ipcAi.register(ctx);
  ipcIndexQueue.register();
  ipcModel.register(ctx);
}
registerExtractedIpc();

// #834: 索引キューとこの組み立ての接続。依存は全部、このファイルが既に持っている読みか書き。
// だからこそキュー自体は Electron に依存せず、レコードやファイルがどこから来るのかを何も知らずに
// 済む。
//
// データベースの読みはハンドルへ直行せず ensurePostsSynced を通す。その #176 の番人のため＝
// switchLibrary の途中で発火した走査の塊は、閉じかけのデータベースではなく null（「ライブラリが
// 無い」として扱われる）を受け取る。
function startIndexQueueForApp() {
  // import の時ではなくここで登録するので、種別は最初の計画より前に、しかしそれより一瞬でも
  // 早くはならずに揃う。#50 の種別は requiresModel を宣言しているため、オプトインが切れて
  // いるかモデルが無い間は、登録しても何のコストにもならない。
  registerAiTagsJob();
  startIndexQueue({
    pool: sharedJobPool,
    aiEnabled: () => readAiConfig().enabled === true,
    listCaptureIds: (since) => {
      const handle = ensurePostsSynced();
      return handle ? indexCandidateIds(handle.sqlite, since) : { ids: [], maxUpdatedAt: null };
    },
    recordsByIds: (ids) => {
      const handle = ensurePostsSynced();
      return handle ? indexRecordsByIds(handle.sqlite, ids) : [];
    },
    progressOf: (captureId, assetRef, jobKind) => readDerivedProgress(ensureDerivedDb(configDir()).sqlite, captureId, assetRef, jobKind),
    saveProgress: (row) => writeDerivedProgress(ensureDerivedDb(configDir()).sqlite, row),
    resolve: {
      resolveInFolder,
      stat: async (absPath) => {
        try {
          const st = await fs.promises.stat(absPath);
          return { size: st.size };
        } catch {
          return null; // 走査が行を見てからディスクから消えた
        }
      },
      readFile: (absPath) => fs.promises.readFile(absPath),
      // グリッド自身のサムネイルのキャッシュ＝#98 の設計は索引に自前のラスタライザを与えない
      // ので、視覚のジョブはタイルが読むのとまったく同じ絵を読む（lib-thumbnails.ts の
      // thumbnailBytes）。
      thumbnail: thumbnailBytes,
    },
    onJobError: (candidate, err) => log.warn('[index] job failed', { jobKind: candidate.jobKind, captureId: candidate.record.captureId, assetRef: candidate.asset.ref, error: (err as Error)?.message }),
    // broadcast ではなく sendToWin。これはキューの進捗であって、ライブラリのレコードが変わった
    // という主張ではない。
    onStatusChange: (status) => sendToWin('index-queue-progress', status),
  });
}

// 副作用の無い起動チェック。host の登録を飛ばし、ウィンドウを隠し、レンダラーが読み込まれたら
// 終了する。HOLOGRAM_SMOKE=1 を付けて走らせる。
const SMOKE = process.env.HOLOGRAM_SMOKE === '1';
const E2E = process.env.HOLOGRAM_E2E === '1';

// ハーネスは日本語のラベルで操作子を引く。そして得られる言語は普通そのマシンのもの＝'auto' の
// 言語設定は navigator.language を通して解決される（src/renderer/src/services/i18n.ts）。だから
// 日本語の開発機で通る同じスイートが en-US の CI ランナーで赤になり、英語の UI は別の言語では
// なく操作子が無いように読める。ハーネスの実行では言語を固定する。もう一方で走らせたいときは
// HOLOGRAM_LANG が上書きする。app が ready になる前に設定しなければならず、だからここにある。
//
// HOLOGRAM_LANG は SMOKE の下だけでなく単独でも効く。Playwright のスイート（e2e/）が同じラベルを
// 見えているウィンドウから読むため＝あちらはスモークの経路ではなくサンドボックスの経路で起動する
// ので、そうしないとランナーの言語になってしまう。
const HARNESS_LANG = process.env.HOLOGRAM_LANG || (SMOKE ? 'ja' : '');
if (HARNESS_LANG) app.commandLine.appendSwitch('lang', HARNESS_LANG);

// サンドボックスの検証用インスタンス（scripts/sandbox-app.cts）。隔離した
// HOLOGRAM_CONFIG_DIR の上で動く、見えていて残り続ける2つ目のインスタンス。SMOKE と違って
// 対話できるままだが、SMOKE と同じくマシン共有の状態には一切触れてはいけない＝host の登録を
// すると、本物の Chrome の HKCU のマニフェスト項目がサンドボックスの設定ディレクトリを指し、
// 本物の保存が壊れる。
const SANDBOX = process.env.HOLOGRAM_SANDBOX === '1';

// 単一インスタンス。2回目の起動は、重複を開く（共有の userData とキャッシュを取り合う）のでは
// なく既にあるウィンドウへフォーカスする。隔離したヘッドレスのテスト実行が互いを塞がないよう、
// SMOKE の下では飛ばす。
//
// restart-app.ps1 がアプリを止めるのも同じロック。--hologram-quit を持った使い捨ての起動が
// ロックを取り損ね、その argv がロックの保持者へ届き、保持者が自分で終了する。それがマシンの
// electron.exe の一覧からプロセスを選ぶやり方に取って代わった理由は restart-signal.ts にある。
const QUIT_SIGNAL = hasQuitSignal(process.argv);
const gotSingleInstanceLock = SMOKE || app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // requestSingleInstanceLock の中で保持者へこちらの argv を渡してあるので、もうやることは
  // 無い。app.quit ではなく app.exit。このプロセスは吐き出すべき状態を持たないし、スクリプトは
  // 何かが動いていたかを終了コードで知る。
  app.exit(QUIT_SIGNAL ? EXIT_SIGNALLED : 0);
} else if (QUIT_SIGNAL) {
  // ロックを取れた＝何も動いていなかったということ。この起動はアプリになってはいけない＝
  // デバッグポートを持たないし、誰もウィンドウを求めていない。「止めるものが無い」と報告するのが
  // 仕事の全部。
  app.exit(EXIT_NO_INSTANCE);
} else {
  if (!SMOKE) {
    app.on('second-instance', (_event, argv) => {
      // restart-app.ps1 の止める側。app.exit ではなく app.quit。before-quit の後片付け
      // （saved-index の吐き出し、ウィンドウの位置と大きさ、db を閉じる）こそ、古い
      // CloseMainWindow() の呼び出しが守っていたもの。
      if (hasQuitSignal(argv)) {
        app.quit();
        return;
      }
      // #32 St1: 2回目の起動は、最初のウィンドウにフォーカスするだけでなく別のウィンドウを開く
      // （設計: "2回目起動＝新規ウィンドウを開く"）。ただし、この実行自体が最小化・非アクティブで
      // 始まった場合（検証ハーネスの再起動）は別で、そこでは古い「既に動いているものを前に出す」
      // 挙動が今も望みのもの。新しいウィンドウを開くと元のウィンドウが見えないままになり、
      // ハーネスの「再起動でウィンドウが戻ったか」の確認が成り立たなくなる。
      const launchedHidden = process.env.HOLOGRAM_START_MINIMIZED === '1' || process.env.HOLOGRAM_START_INACTIVE === '1';
      if (launchedHidden) {
        const w = getWin();
        if (w) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        }
        return;
      }
      createWindow(true, { secondary: true });
    });
  }

  app.whenReady().then(() => {
    // #1009: 何より先に。ほかの何かが configDir や保存先フォルダに触れる前（すぐ下の
    // eventLogger の行自体が configDir/logs への書き込み）。
    if (haltIfStorageRedirected()) return;
    // タスクバーと Alt-Tab の同一性を appId に結び付け、開発中も Windows が（electron.exe の
    // ではなく）こちらのウィンドウアイコンを出すようにする。インストール済みの exe には
    // electron-builder がこれを設定する。ここで設定するのは restart-app.ps1 の開発実行を
    // 覆うため。
    app.setAppUserModelId('com.hologram.app');
    log.eventLogger.startLogging();
    log.info('Starting Hologram', { packaged: app.isPackaged, version: app.getVersion() });
    // #1004: これがなぜ効くのか、どんな起動を捕まえられるのか（Issue を立てるに至った件では、
    // 古い引数の付いたスタートメニューのショートカット）は startup-debug-port.ts を参照。
    if (shouldWarnMissingDebugPort(process.argv, app.isPackaged)) {
      log.warn('Launched without --remote-debugging-port: CDP verification cannot attach to this process (#1004). Stopping it still works — restart-app.ps1 asks the app to quit over the single-instance lock, not by matching this flag.');
    }
    // 冗長化した保存先フォルダのポインタの回復・更新を最初にやる。起動の残り（監視、listPosts、
    // native host）が、設定が切り詰められていたときに空の既定ではなくポインタから直した設定を
    // 見るように。（2026-06-23 の事故。）
    initSaveFolderRedundancy();
    // #176: #176 より前の平坦なバックアップ・整合性の設定があれば libraries[] へ畳み込み、
    // 次に #176 より前の hologram.db を configDir から保存先フォルダへ移す。順序が効く＝下の
    // マイグレーションは libraries[] が既に配列であることを必要とする（項目自体は作らない。
    // それをやるのは、このライブラリが実際に初めて開かれたときの recordLibraryOpened で、下）。
    migrateToLibraries();
    migrateDbIntoSaveFolder();
    // #37: 起動時に最初の判定を1回だけログへ出す＝refreshLibraryStatus() 自体は、載せるときに
    // レンダラーの get-library-status からもう一度呼ばれるので、これは観測のため（main.log）
    // だけであって、UI が読む正本ではない。
    refreshLibraryStatus();
    // 新規インストール（保存先フォルダの明示が無い）では、既定のライブラリのディレクトリが
    // あることを確かめる。最初のキャプチャより前にフォルダやタグの書き込みが失敗しないように。
    // 利用者が明示して選んだフォルダには手を触れない。
    try {
      if (!readConfig().saveFolder) fs.mkdirSync(defaultLibraryDir(), { recursive: true });
    } catch {
      /* 無視する */
    }
    // 開発サーバーとサンドボックスの実行は保存しないので、host の登録を飛ばす＝HKCU への
    // 書き込みも、共有の設定ディレクトリへの native-host のコピーも無い。
    if (!SMOKE && !SANDBOX && !DEV_SERVER_URL) ensureHostRegistered();
    // createWindow より前。ウィンドウの一番最初の読み込みが app:// のリクエストそのもの。
    registerAppProtocol();
    registerImageProtocol({ resolveInFolder });
    // 本番はレンダラーの CSP を app:// の応答自体に載せて配る。開発では同じ方針を Vite の
    // 開発サーバーの応答に留め付ける（renderer-csp.ts）。
    installDevRendererCsp(DEV_ORIGIN);
    installNavigationGuards();
    const startMin = !SMOKE && process.env.HOLOGRAM_START_MINIMIZED === '1';
    // 検証のための起動（サンドボックスの2つ目のインスタンス、セッションから駆動する再起動）は、
    // 画面で利用者がやっていることを邪魔してはいけない。ここで最小化は選べない。CSS の遷移と
    // 実際のレイアウトを観測できるよう、ウィンドウは合成を続けなければならず、検証の実行が
    // SMOKE の隠しウィンドウを使わずにウィンドウを開くのはまさにそのため。
    const startInactive = !SMOKE && !startMin && process.env.HOLOGRAM_START_INACTIVE === '1';
    createWindow(!SMOKE && !startMin && !startInactive); // どちらも → 隠して作り、下でアクティブにせずに見せる
    // 本物のライブラリから種を取ったサンドボックス（#286）は、本物の投稿テキストのスナップ
    // ショットを持ち、キャプチャを名指しした場合は本物のメディアも持つ＝このウィンドウから
    // 撮ったものは何であれ個人データ。注意書きはコンソールへ出さずページの中に描く。スクリーン
    // ショットがそれを載せなければならないため。読み込みのたびに当て直すので、レンダラーの
    // 読み込み直しがそれを落とすことはできない。
    if (SANDBOX && process.env.HOLOGRAM_SANDBOX_NOTICE && getWin()) {
      const notice = process.env.HOLOGRAM_SANDBOX_NOTICE;
      (getWin() as BrowserWindow).webContents.on('did-finish-load', () => {
        const w = getWin();
        if (!w || w.isDestroyed()) return;
        w.webContents
          .executeJavaScript(
            `(() => { const id = 'hologram-sandbox-notice'; const old = document.getElementById(id); if (old) old.remove();
               const el = document.createElement('div'); el.id = id; el.textContent = ${JSON.stringify(notice)};
               el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;background:#b3261e;color:#fff;font:12px/1.7 system-ui,sans-serif;text-align:center';
               document.body.appendChild(el); })()`,
          )
          .catch((err) => log.warn('could not install the sandbox notice', { error: err.message }));
      });
    }
    watchInboxFolder();
    void watchImport.refresh();
    // #34: アプリが閉じている間に答えた「置き換える」は、今までは新しいレコードの上のマーカー
    // でしかない＝ここで置き換えになる。下の SMOKE の囲いの外、かつ purgeOldTrash より前。
    // これが退役させるキャプチャはゴミ箱の30日を今日から始めるべきだし、アプリが閉じている経路が
    // 働くことを示すハーネスはまさにそのモードで起動する。
    setTimeout(() => void sweepReplacements(), 1500);
    if (!SMOKE) {
      armBackupSchedule(); // 一定間隔の予定を始める
      // 起動時の追いつき。前回から間隔より長く経っていれば1回走らせる（閉じている間に逃した実行）。
      const bk = readBackupConfig();
      if (bk.dir && bk.interval) {
        const last = bk.lastRunAt ? Date.parse(bk.lastRunAt) : 0;
        if (!last || Date.now() - last >= backupIntervalMs(bk)) setTimeout(() => runBackup('startup-overdue'), 4000);
      }
      setTimeout(() => purgeOldTrash(), 6000); // 起動時に古いゴミ箱の項目を期限切れにする
      // #834: 途中から再開できる埋め戻し。意図して遅く、意図してウィンドウができた後に。
      // プールの優先規則が成り立たなければならないのは最初のスクロールの瞬間で、競合するものが
      // 何も無いうちに歩き始めても何も示せない。機能がジョブの種別を登録するまで
      // （#48/#49/#50/#51）、そもそも何もキューに入らない。
      setTimeout(() => startIndexQueueForApp(), 8000);
      // 起動時の整合性チェック（#301）。バックアップが設定されていなくても働く必要があるので、
      // runBackup とは独立に自分で DB を開く（runBackup は !b.dir で早期リターンし、DB を
      // 開かない）。
      setTimeout(() => runStartupIntegrityCheck(), 5000);
    }

    if (SMOKE) {
      const shot = process.env.HOLOGRAM_SMOKE_SHOT;
      // Electron 36 はこのイベントの位置引数を1つの details オブジェクトに置き換えた。そのため
      // 古い `(_e, level, message)` の形は、レンダラーのメッセージすべてについて黙って
      // `[renderer:undefined] undefined` を出していた＝まったく転送しないより悪い。ハーネスの
      // 出力が、レンダラーが単に黙っていたように見えるため（#986）。今は待ちの処理が、何を待って
      // いたのかをこのチャンネルで報告する。
      (getWin() as BrowserWindow).webContents.on('console-message', (details) => {
        console.log(`[renderer:${details.level}] ${details.message}`);
      });
      let done = false;
      const quit = (tag) => {
        if (done) return;
        done = true;
        console.log(tag);
        app.quit();
      };
      // executeJavaScript の promise は、スクリプトが走ったフレームのもの。評価の途中でその
      // フレームが別の場所へ遷移すれば、promise は決着しない＝解決もしないし拒否もしない。
      // そうなるとハーネスは下の60秒の受け皿しか待つものが無く、EVAL_RESULT が無いまま
      // チェックを報告する。それは「ページが評価の足元で読み込み直された」ではなく「機能が
      // undefined を返した」と読める（Refs #917）。読み込み直しで評価を失うこと自体は正当な
      // 結末＝ライブラリの切り替えは意図してすべてのウィンドウを読み込み直す。それを伝えるのに
      // 1分かけるのは正当ではない。
      // 合図は 'did-start-navigation' ではなく 'did-navigate'＝コミットされたメインフレームの
      // 遷移。評価がどこにも行かない遷移を始めるのは許されていて、そのうち1つは意図して
      // やっている。test-app-renderer-origin.cts は、ナビゲーションの番人がそれを断ることを
      // 示すために location.href へ代入し、その後まったく同じフレームで続きを進める。
      // スクリプトの足元で文書を差し替えるのはコミットだけ。
      const evalInRenderer = (wc: Electron.WebContents, script: string) =>
        new Promise((resolve, reject) => {
          const onNavigated = (_e: Electron.Event, url: string) => reject(new Error(`the renderer navigated to ${url} while the eval was still running`));
          wc.on('did-navigate', onNavigated);
          wc.executeJavaScript(script)
            .then(resolve, reject)
            .finally(() => wc.off('did-navigate', onNavigated));
        });
      (getWin() as BrowserWindow).webContents.once('did-finish-load', () =>
        setTimeout(async () => {
          // #831: utilityProcess のランタイム経由でローカル推論を1回、同時にウィンドウを
          // 忙しくさせたまま。このチェックが本物のアプリの中で走らなければならない理由は
          // ml-smoke.ts に書いてある。
          if (process.env.HOLOGRAM_ML_SMOKE_MODEL) {
            try {
              console.log('ML_SMOKE_RESULT', JSON.stringify(await runMlSmoke(process.env.HOLOGRAM_ML_SMOKE_MODEL, getWin())));
            } catch (e) {
              console.log('ML_SMOKE_ERR', e.message);
            }
          }
          // #50: nativeImage が実際に使うチャンネルの並びと、本物の画像スタックが作るテンソル。
          // オフラインでモデルも要らない＝なぜ単体テストにできないかは ai-tags-smoke.ts を
          // 参照。
          if (process.env.HOLOGRAM_AI_TAGS_SMOKE === '1') {
            try {
              console.log('AI_TAGS_SMOKE_RESULT', JSON.stringify(runAiTagsSmoke()));
            } catch (e) {
              console.log('AI_TAGS_SMOKE_ERR', e.message);
            }
          }
          // #50: モデルも含めた本物の推論を1回。初回はネットワークが要るので、
          // run-app-tests.cts ではなく「ネットワークが要る」組に入る。
          if (process.env.HOLOGRAM_AI_TAGS_SMOKE_IMAGE) {
            try {
              console.log('AI_TAGS_MODEL_RESULT', JSON.stringify(await runAiTagsModelSmoke(process.env.HOLOGRAM_AI_TAGS_SMOKE_IMAGE.split(path.delimiter))));
            } catch (e) {
              console.log('AI_TAGS_MODEL_ERR', e.message);
            }
          }
          if (process.env.HOLOGRAM_SMOKE_EVAL) {
            try {
              const r = await evalInRenderer((getWin() as BrowserWindow).webContents, process.env.HOLOGRAM_SMOKE_EVAL);
              console.log('EVAL_RESULT', JSON.stringify(r));
            } catch (e) {
              console.log('EVAL_ERR', e.message);
            }
          }
          if (shot) {
            try {
              const img = await (getWin() as BrowserWindow).webContents.capturePage();
              fs.writeFileSync(shot, img.toPNG());
            } catch (err) {
              console.error('capture failed:', err);
            }
          }
          quit('SMOKE_OK');
        }, 1300),
      );
      // 答えを返さないレンダラーのための受け皿であって、評価の予算ではない。評価スクリプトは
      // 自分の waitFor のタイムアウトを持っているので、本物のハングは今もここで終わる一方、
      // 正当に長い流れ（複数手順の UI ハーネス）は途中で切られない＝切られると「評価の結果が
      // 無い」と読め、不具合と取り違えやすい。その受け皿として25秒は近すぎた。夜間の Windows
      // ランナーは test-app-import-dedup（手元では3.6秒、自前の待ちは無く、ランナーのディスク
      // 越しの ZIP 取り込みだけ）をそのまま SMOKE_TIMEOUT に落とし、test-app-image-zoom も
      // 同じ壁に当てた（#818）。ハングは今も run-app-tests.cts 自身の120秒の spawn タイム
      // アウトの十分内側で終わる。遅いが正直な実行は、切られずに完走するようになった。
      setTimeout(() => quit('SMOKE_TIMEOUT'), 60000);
      return;
    }

    // 利用者に代わって起動されたときは最小化で始める。フォーカスを奪わず、タスクバーのボタンも
    // 光らせない。非アクティブで見せ（フォーカス無し → FlashWindowEx 無し）、最小化し、保留中の
    // 注意喚起の点滅を明示的に消す。（通常の起動はフォーカスの当たったウィンドウを開く。）
    if (startMin && getWin()) {
      (getWin() as BrowserWindow).once('ready-to-show', () => {
        const w = getWin() as BrowserWindow;
        w.showInactive();
        w.minimize();
        w.flashFrame(false);
      });
    }

    // 見えてはいるが、利用者が既に開いているものの後ろで始める。showInactive() が覆うのはその
    // 半分だけ＝アクティブ化は飛ばすが、ウィンドウは今も z 順の最前面に着地する（Windows 11 で
    // 実測）。これは不具合ではなく上流の確定した立場で、"showInactive() should maintain the Z
    // order" は wontfix として閉じられ（electron#9941）、Electron は moveTop() を出しているのに
    // 対になるものを出していない。だからウィンドウは、Windows がそのために用意している Win32 の
    // 呼び出しで下へ押し下げる。
    if (startInactive && getWin()) {
      (getWin() as BrowserWindow).once('ready-to-show', () => {
        const w = getWin() as BrowserWindow;
        w.showInactive();
        w.flashFrame(false);
        // Playwright が Electron をデバッグ接続している間は、Win32 の SetWindowPos
        // 呼び出しが例外ダイアログを出してプロセスを止めることがある。E2E では
        // showInactive() を保ち、ネイティブの z 順操作だけを避ける。
        if (!E2E) sendWindowToBack(w);
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 保留中の saved-index の書き込みを吐き出したら立てる。下で出し直す終了が、アプリをもう一度
// 引き止めるのではなく後片付けへ抜けるように。
let quitFlushed = false;
// 下の後片付けがライブラリを閉じたら立てる。プロセスが畳まれていく間に何かがそれを開き直したり
// 使い回したりしないように（ensureDb / ensurePostsSynced が読む）。最初の、先送りするパスでは
// 意図して立てない。あのパスは、保留中の saved-index の書き込みがまだ DB を読めるようにと、
// まさにそのために終了を引き止めている。
let quitting = false;

app.on('before-quit', (e) => {
  // Electron 自身のドキュメントが非同期の終了処理をやらせている形（preventDefault して、
  // 終わらせて、もう一度 quit）に倣い、終了を1往復だけ引き止める。吐き出しはデータベースを読む
  // ので、下の close より前に起きなければならない。上限を切ってある。ゴミ箱の側は保存先フォルダ
  // に触れ、そこはネットワークのパスであり得るし、終了がそれに人質に取られてはいけない＝落ちた
  // 書き込みは古くなった印にすぎないが、止まった終了はもっと悪い。
  if (!quitFlushed && (savedIndexPending || savedIndexInFlight)) {
    e.preventDefault();
    quitFlushed = true;
    void Promise.race([flushSavedIndexWrite(), new Promise((r) => setTimeout(r, 2000))]).finally(() => app.quit());
    return;
  }
  quitting = true;
  // 素の sqlite.close() ではなく closeDb。あちらはハンドルを忘れもする。閉じた接続をその場に
  // 残しておくと、終了より長く生きた起動時のタイマー（一番目立つのは #34 の置き換えの掃き寄せ）が
  // 揃って better-sqlite3 へ死んだ接続を渡し、それぞれが出際に TypeError のスタックをログへ
  // 出していた＝夜間実行の末尾を読むとき、本物の障害と見分けの付かない雑音。開き直すものは
  // 無い。`quitting` は上で立ててある。
  closeDb();
  // utilityProcess はアプリの終了経路の子ではない。放っておくと、そのために起こしたウィンドウ
  // より長く生き得る（#831）。
  stopMlRuntime();
});
