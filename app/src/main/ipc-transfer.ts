'use strict';

// Transfer 系の IPC ハンドラ。main.js から抽出した（機械的な移動＝ロジックは変えていない）。
// export-save / export-complete / import-complete（ZIP の往復）、pick-save-folder
// （クラッシュ安全なライブラリ移動＝コピー→設定切り替え→旧データ削除、その後ウォッチャーを
// 再設定してレンダラーを全同期）。重い処理（validateSaveFolder、
// copyLibraryInto、watchSaveFolder、設定/ポインタ層、clearAllBlockReason、
// アバター取得）はこのモジュールの外にあり（#227: lib-library-safety.ts、lib-migrate.ts、
// lib-config.ts、native-host.ts）、ctx 経由で届く。可変状態には
// send/isConfigCorrupt/resetDelta のアクセサ経由で触れる。ダイアログはすべて呼び出した
// ウィンドウを親にする（#32 St1: BrowserWindow.fromWebContents(e.sender)）。共有された
// 「唯一の」ウィンドウではない。
import { app, dialog, clipboard, BrowserWindow, type WebContents } from 'electron';
import { ipcMain } from './activity-ipc.ts';
import fs from 'node:fs';
import path from 'node:path';

import * as archive from './lib-archive.ts';
import { cloudSyncProviderOf } from './save-folder-guard.ts';
import { libraryDestinationDir } from './native-host.ts';
import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { imageSize } from './lib-imgsize.ts';
import { prepareImageBytes } from './image-processing.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { createDbWriter } from './lib-db-write.ts';
import { IMPORTABLE_MEDIA, buildLocalRecord, importLocalFile, localCaptureId } from './lib-local-intake.ts';
import { classifyLibraryFolder } from './lib-library-folder.ts';
import { collectDroppedPaths } from './lib-drop-import.ts';
import type { PostRecordInput } from '../../../native-host/post-record.mts';
import { ITEMS_SUBDIR, itemDirectoryAbsolute, itemFileRelative } from '../../../native-host/item-storage.mts';
import { isStoredCaptureId } from '../../../native-host/capture-id.mts';
import type { IpcContext } from './ipc-context.ts';
import { withLibraryRelocationPaused } from './lib-library-relocation-lifecycle.ts';
import { runLibraryBackgroundTask } from './lib-library-background-activity.ts';
import type { ClearAllResult, ClipboardImportResult, CompleteImportResult, DropCollectResult, DroppedFile, DropImportResult, ExportCompleteResult, ExportSaveResult, MediaImportResult, RepointApplyResult, RepointPickResult, SaveFolderMoveResult, SaveFolderPickResult } from './ipc-payloads.ts';
import { saveFolderCloudMessages } from '../shared/save-folder-cloud-messages.ts';

function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// Blob を Buffer に展開する前の上限。通常のクリップボード画像には十分な余裕を持たせつつ、
// 画像とは無関係な巨大 ancillary chunk をメインプロセスへ読み込ませない。
const MAX_CLIPBOARD_PNG_BYTES = 64 * 1024 * 1024;
const MAX_CLIPBOARD_PIXELS = 40_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// 拡張子の一覧と、ローカルインポートしたファイルがなるレコードの形は lib-local-intake.ts に
// 移した＝下のダイアログはそれを共有する4つの入り口のひとつ
// （#84 の実装設計コメント参照。クリップボードの入り口はこのファイルの末尾）。

function register(ctx: IpcContext) {
  const { getSaveFolder, defaultLibraryDir, getTrashDir, readConfig, writeConfig, readSavePointer, isConfigCorrupt, clearAllBlockReason, getLibraryStatus, LIBRARY_MEDIA_EXTS, getDbWriter, send, validateSaveFolder, relocateLibrary, restoreMissingLibrary, ensurePostsSynced, markExported, notePostsSaved } = ctx;

  // クラウド同期先への移動許可は renderer にパスや bearer token として渡さない。
  // main が選んだパスを、確認を表示した同じ WebContents にだけ短時間・一回限りで
  // 結び付ける。WeakMap にすることで、破棄通知を受け損ねても sender を生かし続けない。
  const CLOUD_MOVE_GRANT_MS = 30_000;
  type CloudMoveGrant = { dest: string; expiresAt: number; timer: ReturnType<typeof setTimeout> };
  type SaveFolderFlow = { generation: number; inProgress: boolean };
  const cloudMoveGrants = new WeakMap<WebContents, CloudMoveGrant>();
  const saveFolderFlows = new WeakMap<WebContents, SaveFolderFlow>();
  const sendersWithDestroyCleanup = new WeakSet<WebContents>();

  function clearCloudMoveGrant(sender: WebContents) {
    const grant = cloudMoveGrants.get(sender);
    cloudMoveGrants.delete(sender);
    if (grant) clearTimeout(grant.timer);
  }

  function ensureSenderDestroyCleanup(sender: WebContents) {
    // grant ごとに once を足すと、grant が消費・取消されても destroyed まで listener が
    // 残り、反復操作で MaxListeners 警告になる。sender の生存期間につき一つだけ置く。
    if (sendersWithDestroyCleanup.has(sender)) return;
    sendersWithDestroyCleanup.add(sender);
    sender.once('destroyed', () => {
      clearCloudMoveGrant(sender);
      saveFolderFlows.delete(sender);
      sendersWithDestroyCleanup.delete(sender);
    });
  }

  function grantCloudMove(sender: WebContents, dest: string) {
    ensureSenderDestroyCleanup(sender);
    let grant: CloudMoveGrant;
    const timer = setTimeout(() => {
      if (cloudMoveGrants.get(sender) === grant) clearCloudMoveGrant(sender);
    }, CLOUD_MOVE_GRANT_MS);
    grant = { dest, expiresAt: Date.now() + CLOUD_MOVE_GRANT_MS, timer };
    cloudMoveGrants.set(sender, grant);
    timer.unref();
  }

  function consumeCloudMoveGrant(sender: WebContents): string | null {
    const grant = cloudMoveGrants.get(sender);
    // 成否にかかわらず先に消費する。検証や移動の失敗を、同じ許可で再試行することも
    // できない。一回の明示承認は一回の移動試行だけを意味する。
    clearCloudMoveGrant(sender);
    if (!grant || grant.expiresAt <= Date.now()) return null;
    return grant.dest;
  }

  function beginSaveFolderFlow(sender: WebContents): SaveFolderFlow {
    const flow = { generation: (saveFolderFlows.get(sender)?.generation ?? 0) + 1, inProgress: true };
    saveFolderFlows.set(sender, flow);
    // 新しい世代は、同じ sender の以前の選択が作った未使用許可も失効させる。
    clearCloudMoveGrant(sender);
    return flow;
  }

  function isCurrentSaveFolderFlow(sender: WebContents, flow: SaveFolderFlow): boolean {
    const current = saveFolderFlows.get(sender);
    return !sender.isDestroyed() && current?.generation === flow.generation && current.inProgress;
  }

  function finishSaveFolderFlow(sender: WebContents, flow: SaveFolderFlow) {
    if (saveFolderFlows.get(sender)?.generation === flow.generation) flow.inProgress = false;
  }

  function cloudWarningMessages() {
    const saved = readConfig().language;
    const language = saved === 'ja' || (saved !== 'en' && app.getLocale().toLowerCase().startsWith('ja')) ? 'ja' : 'en';
    return saveFolderCloudMessages[language];
  }

  ipcMain.handle('clear-all', async (): Promise<ClearAllResult> => {
    const folder = getSaveFolder();
    if (!folder) return { ok: false, count: 0 };
    // 設定が劣化している時は消去を拒む: 設定が壊れている、冗長ポインタはライブラリが
    // 選ばれていた証拠を残しているのに saveFolder を失っている、あるいは明示的な
    // フォルダが今ディスク上に無い（#37）——いずれも、狙っている場所が間違っている
    // 可能性を意味する。取りやめて消去が誤って当たらないようにする（missing の場合は
    // まず repoint するかフォルダを復元する。corrupt/lost の場合は再起動して
    // initSaveFolderRedundancy に先に設定を直させる）。
    const cfg = readConfig();
    const blocked = clearAllBlockReason({
      configCorrupt: isConfigCorrupt(),
      hasExplicitSaveFolder: typeof cfg.saveFolder === 'string' && !!cfg.saveFolder.trim(),
      hasPointer: !!readSavePointer(),
      libraryMissing: getLibraryStatus().missing,
    });
    if (blocked) return { ok: false, blocked, count: 0 };
    let count = 0;
    // 先にレコードを消す: 利用者が目にするのはメディアファイルだが、投稿そのものは
    // DB にあり、#302 以降は走査から「このレコードはファイルを失った」を再導出する
    // 仕組みが無い。整理情報（organization）は残す（deleteAllPosts 参照）。
    ensurePostsSynced();
    getDbWriter().deleteAllPosts();
    // 次に項目の実体。現行構造は1投稿1フォルダーなので、画像・動画・収蔵ファイル・
    // ポスター・リンクカードをまとめて消す。旧構造の直下ファイルも引き続き掃除する。
    const CLEAR_RE = new RegExp('\\.(' + LIBRARY_MEDIA_EXTS.join('|') + ')$', 'i');
    const itemsRoot = path.join(folder, ITEMS_SUBDIR);
    try {
      for (const item of fs.readdirSync(itemsRoot, { withFileTypes: true })) {
        if (!item.isDirectory()) continue;
        const itemDir = path.join(itemsRoot, item.name);
        try {
          count += fs.readdirSync(itemDir, { withFileTypes: true }).filter((entry) => entry.isFile()).length;
          fs.rmSync(itemDir, { recursive: true, force: true });
        } catch {
          /* スキップ */
        }
      }
      fs.rmSync(itemsRoot, { recursive: true, force: true });
    } catch {
      /* 空 */
    }
    const quotedMediaRoot = path.join(folder, 'quoted-media');
    try {
      for (const quote of fs.readdirSync(quotedMediaRoot, { withFileTypes: true })) {
        if (!quote.isDirectory()) continue;
        try {
          count += fs.readdirSync(path.join(quotedMediaRoot, quote.name), { withFileTypes: true }).filter((entry) => entry.isFile()).length;
        } catch {
          /* 数えられなくても、下で保存領域全体を消す */
        }
      }
      fs.rmSync(quotedMediaRoot, { recursive: true, force: true });
    } catch {
      /* 空 */
    }
    try {
      for (const f of fs.readdirSync(folder)) {
        if (CLEAR_RE.test(f)) {
          try {
            fs.unlinkSync(path.join(folder, f));
            count++;
          } catch {
            /* スキップ */
          }
          continue;
        }
        // 旧 bridge が直下に残した投稿 sidecar も投稿の実体である。拡張子だけで JSON を
        // 消すと利用者の無関係な設定まで失うため、bridge が生成しうる保存済み captureId
        // （衝突 suffix を含む）と完全一致するものだけを対象にする。
        if (f.toLowerCase().endsWith('.json') && isStoredCaptureId(f.slice(0, -'.json'.length))) {
          try {
            fs.unlinkSync(path.join(folder, f));
            count++;
          } catch {
            /* スキップ */
          }
        }
      }
    } catch {
      /* 空 */
    }
    return { ok: true, count };
  });

  ipcMain.handle('export-save', async (_e, filename, bytes): Promise<ExportSaveResult> => {
    // #32 St1: 下のダイアログはすべて呼び出したウィンドウを親にする
    // （BrowserWindow.fromWebContents(e.sender)）。ctx.getWin()（主ウィンドウ）ではない
    // ＝副ウィンドウ自身のダイアログが、その裏に隠れて出てはいけない。
    const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, { defaultPath: filename });
    if (res.canceled || !res.filePath) return { saved: false };
    try {
      await fs.promises.writeFile(res.filePath, bytes instanceof ArrayBuffer ? Buffer.from(bytes) : bytes);
      return { saved: true, path: res.filePath };
    } catch (err) {
      return { saved: false, error: err.message };
    }
  });

  // --- 完全エクスポート（そのまま再インポートできるスナップショット） -----------------
  // library/ 以下にライブラリ全体を写した1つの ZIP: すべてのキャプチャファイル
  // （jpg/media）に加え、DB から再生成した sidecar と整理情報の層（#300/St7 ——
  // lib-archive.ts のモジュールコメントに、これらがもうディスクコピーで済まない理由が
  // 書いてある）。config.json（マシン固有）は含めない。
  // 手動専用: これは
  // 旧来のスケジュール ZIP 案を置き換えたもの——ZIP は手で持ち出すスナップショットの
  // ままでいる。
  ipcMain.handle('export-complete', async (_e, mode, includeTrash): Promise<ExportCompleteResult> => {
    const imagesOnly = mode === 'images';
    const src = getSaveFolder();
    const owner = imagesOnly ? null : ctx.reserveCompleteExport();
    if (!imagesOnly && owner === null) return { saved: false, error: 'library-busy' };
    try {
      // 空かどうかは readdir で安く分かる——ダイアログより前に確認して、空のライブラリで
      // 保存プロンプトが出ないようにする（旧来の fileCount===0 → empty の挙動と一致）。
      let hasAny: boolean;
      try {
        if (imagesOnly) hasAny = await archive.hasExportableFiles(src, true);
        else {
          const handle = await ensurePostsSynced();
          if (!handle) return { saved: false, error: 'no-folder' };
          hasAny = await archive.hasCompleteExportContent(handle.sqlite, src, getTrashDir(), !!includeTrash);
        }
      } catch (err) {
        return { saved: false, error: err.message };
      }
      if (!hasAny) return { saved: false, empty: true };
      // complete 形式のエクスポートは投稿を DB から読む（imagesOnly は従来どおり単純な
      // ディスクコピーのまま——もともと sidecar／整理情報は含んでいなかった）。
      // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
      const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, { defaultPath: `hologram-${imagesOnly ? 'images' : 'export'}-${exportStamp()}.zip` });
      if (res.canceled || !res.filePath) return { saved: false };
      // アーカイブは選ばれたパスへ直接ストリームする（yazl: メモリ使用量が有界＋ZIP64）
      // ＝ライブラリ全体がメモリに乗ることはなく、4 GiB 超のアーカイブも壊れない。
      // 進捗は Windows タスクバー（BrowserWindow.setProgressBar）とアプリ内 % 表示用の
      // 'export-progress' IPC イベントの両方を駆動する。整数パーセントの変化にだけ絞って
      // 発火を抑える。失敗した場合は必ず部分ファイルを削除し、書きかけの ZIP を
      // 残さない。タスクバーの進捗は呼び出したウィンドウ自身のもの（setProgressBar は
      // ウィンドウ単位）。export-progress は従来どおり全体へのブロードキャスト（send）の
      // ままにする。安いし、自分以外のウィンドウが自分のではないエクスポートを追跡することは
      // ないため——レンダラーは自分と関係ない進行中の操作のイベントを無視する。
      const win = BrowserWindow.fromWebContents(_e.sender);
      let lastPct = -1;
      const onProgress = (written: number, total: number) => {
        const frac = total > 0 ? Math.min(1, written / total) : 0;
        const pct = Math.floor(frac * 100);
        if (pct === lastPct) return;
        lastPct = pct;
        try {
          win?.setProgressBar(frac);
        } catch {
          /* ウィンドウが無い */
        }
        send('export-progress', { written, total, pct });
      };
      const state: { snapshot: Awaited<ReturnType<typeof archive.prepareCompleteExport>> | null } = { snapshot: null };
      let watermark: ReturnType<IpcContext['beginCompleteExport']> | null = null;
      let outputStarted = false;
      try {
        if (!imagesOnly) {
          if (getSaveFolder() !== src) throw new Error('library-changed');
          const prepared = await withLibraryRelocationPaused(
            () => ctx.pauseCompleteExport(owner as number),
            async (owner) => {
              if (getSaveFolder() !== src) throw new Error('library-changed');
              const handle = ctx.getDbForCompleteExport(owner);
              if (!handle) throw new Error('no-folder');
              watermark = ctx.beginCompleteExport();
              state.snapshot = await archive.prepareCompleteExport(handle.sqlite, src, getTrashDir(), { includeTrash: !!includeTrash, stageParent: path.dirname(res.filePath) });
              return true;
            },
            ctx.finishCompleteExport,
            false,
          );
          if (!prepared) return { saved: false, error: 'library-busy' };
          if (!state.snapshot?.hasContent) return { saved: false, empty: true };
        }
        win?.setProgressBar(0);
        send('export-progress', { written: 0, total: 0, pct: 0 });
        outputStarted = true;
        const built = imagesOnly ? await archive.writeImagesZip(src, res.filePath, onProgress) : await state.snapshot?.write(res.filePath, onProgress);
        if (!built) throw new Error('snapshot-unavailable');
        try {
          win?.setProgressBar(-1);
        } catch {
          /* ウィンドウが無い */
        }
        send('export-progress', { done: true });
        if (watermark) markExported(watermark);
        return { saved: true, path: res.filePath, fileCount: built.fileCount };
      } catch (err) {
        try {
          win?.setProgressBar(-1);
        } catch {
          /* ウィンドウが無い */
        }
        send('export-progress', { done: true });
        try {
          if (outputStarted) await fs.promises.unlink(res.filePath);
        } catch {
          /* 掃除するものは無い */
        }
        return { saved: false, error: err.message };
      } finally {
        await state.snapshot?.dispose();
      }
    } catch (err) {
      return { saved: false, error: err.message };
    } finally {
      if (owner !== null) await ctx.finishCompleteExport(owner);
    }
  });

  // --- 完全インポート（complete エクスポートの ZIP を復元） --------------------------
  // キャプチャ（jpg/media）は保存フォルダへコピーする。既に存在するもの（ファイル名で
  // 判定）はスキップする＝再インポートは何度実行しても同じで、空でないライブラリへの
  // インポートは上書きではなく統合になる。投稿ごとの .json sidecar はディスクではなく
  // DB へ入り、整理情報の JSON は DB から読み、統合（従来どおり和集合）してから書き戻す
  // ——ここでディスクのみの importCompleteZip を置き換える理由は lib-archive.ts の
  // importCompleteZipToDb のモジュールコメント（#300/St7）を参照。
  //
  // ファイルピッカーはレンダラーではなくここにある（#485）。以前はレンダラーが
  // FileReader でアーカイブ全体を読み、バイト列を IPC 経由で渡していたが、それこそ
  // 4 GiB 超のエクスポートが耐えられない構成——レンダラーが OOM し、IPC メッセージも
  // 届かない。main がパスを選び yauzl がディスクから直接ストリームするので、この
  // ハンドラより上の層にとってアーカイブサイズはもう問題にならない。
  //
  // legacy エクスポート（metadata.json + images/）も引き続きインポート可能で、main が
  // それも読む（#322——形式は残し、同じ防御の内側に置くという判断で、切り捨てては
  // いない）。complete エクスポートでないアーカイブは { legacy:true, path } として
  // 戻り、レンダラーが2回目の呼び出しでインポート自体を求める: #34 の重複質問は
  // UI ポリシーであり、読み取りと書き込みの間に挟む必要がある。IPC を越えるのは
  // main が選んだパスだけ——アーカイブのバイト列も、展開済みレコードも越えない。
  ipcMain.handle('import-complete', async (_e): Promise<CompleteImportResult> => {
    // #37: ピッカーを開く前にチェックする——もう無いフォルダへ ZIP を復元すると、
    // そこを新品の空ライブラリとして作り直してしまう。
    if (getLibraryStatus().missing) return { ok: false, error: 'library-missing' };
    // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, {
      properties: ['openFile'],
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const zipPath = res.filePaths[0];
    try {
      const handle = await ensurePostsSynced();
      if (!handle) return { ok: false, error: 'no-folder' };
      const out = await archive.importCompleteZipToDb(handle.sqlite, zipPath, getSaveFolder());
      return out;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ライブラリの置き場所を変える。フォルダを選び、既存のライブラリをそこへ移動する
  // （クラッシュ安全: コピー→設定切り替え→旧データ削除）。その後ウォッチャーを
  // 再設定し、レンダラーに強制再同期させる。ネイティブホストも同じ config.json から
  // saveFolder を読むので、新しいキャプチャは自動的に追従する。
  //
  // 選ぶことと移動することの間に、ブロックしない警告を挟めるよう2つに分けてある
  // （#95）: pick-save-folder が移動先を決定・検証し、利用者が先に見るべきことを
  // 報告する。move-save-folder は利用者が受け入れた後に実際の移動をする。移動側は
  // 最初から検証をやり直す——レンダラーを一往復するのは UI 上の手順であって、
  // 信頼境界ではない。
  async function moveLibraryTo(dest: string): Promise<SaveFolderMoveResult> {
    const src = getSaveFolder();
    // #37: 移動は現在のフォルダからコピーする——もしそのフォルダが行方不明になった
    // 当のフォルダなら、コピー元が無く、「移動」は実質、`dest` に新しい空ライブラリを
    // 作りながら、実際にはまだどこかにあるものを黙って見捨てることになる。この状態の
    // 逃げ道は代わりに repoint（下の pick-repoint-folder / apply-repoint）。
    if (getLibraryStatus().missing) return { ok: false, error: 'library-missing' };
    const v = validateSaveFolder(dest);
    if (!v.ok) return { ok: false, error: v.error };

    // クラッシュ安全な一連の処理は丸ごと lib-migrate にある（DB を閉じる→コピー＋
    // 追いつき→切り替え→DB を開き直す→検証付きクリーンアップ→残骸削除→遅延した
    // 取りこぼしの掃き寄せ——#176 でコピー＋切り替えの前後に DB の close/reopen を
    // 加えた）。
    return withLibraryRelocationPaused(
      ctx.pauseLibraryRelocation,
      (owner) =>
        relocateLibrary(src, dest, {
          readConfig,
          writeConfig,
          emit: (payload) => send('save-folder-progress', payload),
          closeDb: () => ctx.closeDbForLibraryRelocation(owner),
          openDb: () => ctx.openDbForLibraryRelocation(owner),
          defaultLibraryDir: defaultLibraryDir(),
          afterFlip: () => {},
          runBackground: runLibraryBackgroundTask,
          // この掃き寄せは1分後に発火する——その間にライブラリがまた移動していたらスキップする。
          stillCurrent: () => path.resolve(getSaveFolder() || '') === path.resolve(dest),
        }),
      // copy 失敗、移動先 DB の初期化失敗、成功後の再初期化失敗のすべてで必ず復旧する。
      ctx.finishLibraryRelocation,
      { ok: false, error: 'busy' },
    );
  }

  ipcMain.handle('pick-save-folder', async (_e): Promise<SaveFolderPickResult> => {
    // await をまたぐ picker/警告応答は、同じ sender でも完了順が開始順とは限らない。
    // 世代を進め、各 await の後でまだ最新かを確認することで、古い応答を無作用にする。
    const flow = beginSaveFolderFlow(_e.sender);
    // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
    // 実アプリでは必ず main のネイティブ picker が選ぶ。隔離済み E2E の SMOKE
    // プロセスだけは、その専用 config と同じ一時ディレクトリを環境から注入する。
    const smokePick = process.env.HOLOGRAM_SMOKE === '1' ? process.env.HOLOGRAM_SMOKE_PICK_SAVE_FOLDER : undefined;
    const res = smokePick ? { canceled: false, filePaths: [smokePick] } : await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (!isCurrentSaveFolderFlow(_e.sender, flow)) return { ok: false, canceled: true };
    if (res.canceled || !res.filePaths || !res.filePaths[0]) {
      finishSaveFolderFlow(_e.sender, flow);
      return { ok: false, canceled: true };
    }
    const chosen = res.filePaths[0];
    // 親フォルダの下に Hologram/Library を置く。Hologram や Library 自体を
    // 選んだ場合は、その階層を重複して作らない。
    const dest = libraryDestinationDir(chosen);
    const v = validateSaveFolder(dest);
    if (!v.ok) {
      finishSaveFolderFlow(_e.sender, flow);
      return { ok: false, error: v.error };
    }

    // 移動先がクラウド同期のルート配下にあるように見える時は警告する（ブロックはしない）
    // ＝ライブラリは実時間で書き込まれるので、同期クライアントがその書き込みと競合すると
    // 壊しかねない。判定はヒューリスティック→決めるのは利用者。クラウドへ控えを置く場合は、
    // 生きたライブラリではなく、手動で作成したバックアップファイルを同期対象へ保存する。
    const cloudProvider = cloudSyncProviderOf(dest);
    if (cloudProvider) {
      const messages = cloudWarningMessages();
      const options = {
        type: 'warning' as const,
        title: 'Hologram',
        message: messages.saveFolderCloudWarn.replace('{name}', cloudProvider),
        detail: messages.saveFolderCloudWarnDesc,
        buttons: [messages.saveFolderCloudWarnOk, messages.confirmCancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const parent = BrowserWindow.fromWebContents(_e.sender);
      const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      // 古い A の承認は B の取消後に許可を復活させず、古い A の取消は B が発行した
      // 許可を消さない。世代確認より前には grant に一切触れない。
      if (!isCurrentSaveFolderFlow(_e.sender, flow)) return { ok: false, canceled: true };
      if (answer.response !== 0) {
        finishSaveFolderFlow(_e.sender, flow);
        return { ok: false, canceled: true };
      }
      grantCloudMove(_e.sender, dest);
      finishSaveFolderFlow(_e.sender, flow);
      return { ok: false, confirm: 'cloud-sync', provider: cloudProvider };
    }

    // showOpenDialog 待機中に新しい世代が開始していれば、非クラウド先にも移動しない。
    if (!isCurrentSaveFolderFlow(_e.sender, flow)) return { ok: false, canceled: true };
    finishSaveFolderFlow(_e.sender, flow);
    return moveLibraryTo(dest);
  });

  // 選択フローの後半: 利用者が既に警告を受け入れた移動先へ実際に移動する。
  // 汎用の「どこへでも移動」の入り口ではない。
  ipcMain.handle('move-save-folder', async (_e): Promise<SaveFolderMoveResult> => {
    const dest = consumeCloudMoveGrant(_e.sender);
    if (!dest) return { ok: false, error: 'invalid' };
    return moveLibraryTo(dest);
  });

  // --- Repoint: 既に存在するライブラリへ config.saveFolder を向け直す（#37）。
  // 上の移動フローは現在のフォルダが読める前提（そこからコピーする）。repoint は
  // 逆の状況のためのもの——現在のフォルダが行方不明で、本物のライブラリはどこか
  // 別の場所にある（別のドライブレター、あるいは利用者がアプリの外で手動で
  // 動かしたフォルダ）。復旧処理は、データベースも含めてこの場所を開き直す。
  // ——データベースが今はライブラリフォルダの内側に住んでいるので、「別の既存
  // ライブラリへ config.saveFolder を向ける」ことと「古い DB を閉じて新しいフォルダの
  // ものを開く」ことは同じ操作であり、コピー無しのポインタ切り替えに加えて別立ての
  // DB の話がある、というものではない。このペアは、行方不明ライブラリの復旧画面
  // （LibraryMissingState.tsx）向けの復旧経路である。
  ipcMain.handle('pick-repoint-folder', async (_e): Promise<RepointPickResult> => {
    // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const dest = res.filePaths[0];
    // validateSaveFolder のパス安全性＋書き込み可否のチェックを再利用する（移動先が
    // 満たすべきルールと同じ: 現在の——行方不明な——フォルダと入れ子にならない、
    // 設定／バックアップと重ならない、書き込み可能）。その mkdirSync の再帰的な
    // 確認は、`dest` が既に存在する時は何もしない＝ここで想定している通常のケース。
    const v = validateSaveFolder(dest);
    if (!v.ok) return { ok: false, error: v.error };
    const classification = classifyLibraryFolder(dest);
    // #176: ライブラリだった形跡が一切なく、中に自分たちのものでない何かが入っている
    // フォルダは、黙って「空として始めますか？」という選択肢を出すのではなく、ここで
    // 明確に拒む（looksLikeLibrary の旧来の二分岐はこれを通してしまっていたが、
    // #176 で導入した四分類の判定は通さない）。
    if (classification === 'reject') return { ok: false, error: 'not-a-library' };
    return { ok: true, dest, hasEvidence: classification !== 'empty' };
  });

  ipcMain.handle('apply-repoint', async (_e, dest): Promise<RepointApplyResult> => {
    if (!dest || typeof dest !== 'string') return { ok: false, error: 'invalid' };
    return restoreMissingLibrary(dest);
  });

  // #299: 上の importPostRecords と同じ理屈——DB へ直接書く（今は本物の video 欄で、
  // #299 以前に使っていた `(rec as any).video` という抜け道ではない）。DB が後で
  // 再導出する羽目になる sidecar は作らない。
  ipcMain.handle('import-images', async (_e): Promise<MediaImportResult> => {
    const folder = getSaveFolder();
    if (!folder) return { imported: 0, skipped: 0, error: 'no-folder' };
    // #37: importPostRecords の同一の防御を参照——でないと数行下の mkdirSync が、
    // 行方不明の保存フォルダをゼロから作り直してしまう。
    if (getLibraryStatus().missing) return { imported: 0, skipped: 0, error: 'library-missing' };
    // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: IMPORTABLE_MEDIA }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return { imported: 0, skipped: 0, canceled: true };
    fs.mkdirSync(folder, { recursive: true });
    const handle = await ensurePostsSynced();
    if (!handle) return { imported: 0, skipped: 0, error: 'no-folder' };
    const { sqlite } = handle;
    let imported = 0,
      skipped = 0,
      seq = 0;
    const stamp = Date.now();
    const toWrite: PostRecordInput[] = [];
    const writtenItemDirs: string[] = [];
    for (const fp of res.filePaths) {
      let itemDir: string | null = null;
      try {
        const ext = path.extname(fp).slice(1).toLowerCase();
        if (!IMPORTABLE_MEDIA.includes(ext)) {
          skipped++;
          continue;
        }
        const st = await fs.promises.stat(fp);
        if (!st.isFile()) {
          skipped++;
          continue;
        }
        const captureId = localCaptureId('drag', stamp, seq++);
        const fileName = `${captureId}.${ext}`;
        const file = itemFileRelative(captureId, fileName);
        itemDir = itemDirectoryAbsolute(folder, captureId);
        const nowIso = new Date().toISOString();
        const mtimeIso = st.mtime && !Number.isNaN(st.mtime.getTime()) ? st.mtime.toISOString() : nowIso;
        // クリップボードの入り口と共有——lib-local-intake.ts
        // 参照。この入り口は一度に多くのレコードを書くため、コピー処理＋バッチ
        // トランザクションは自前で持つ。共有するのはレコードの「形」だけ。
        const rec: PostRecordInput = buildLocalRecord({
          captureId,
          file,
          ext,
          source: 'drag',
          title: path.basename(fp, path.extname(fp)) || null,
          date: mtimeIso,
          now: nowIso,
        });
        await fs.promises.mkdir(itemDir, { recursive: true });
        await fs.promises.copyFile(fp, path.join(itemDir, fileName));
        toWrite.push(rec);
        writtenItemDirs.push(itemDir);
        imported++;
      } catch {
        if (itemDir) await fs.promises.rm(itemDir, { recursive: true, force: true });
        skipped++;
      }
    }

    if (toWrite.length) {
      const stmts = preparePostStmts(sqlite);
      const resolveTagId = makeTagResolver(sqlite);
      sqlite.exec('BEGIN');
      try {
        for (const rec of toWrite) writePost(stmts, resolveTagId, fillMediaDims(folder, fillCardDims(folder, rec)));
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        await Promise.all(writtenItemDirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
        throw err;
      }
      notePostsSaved(toWrite.length);
    }
    return { imported, skipped };
  });

  // --- ウィンドウへのドロップ取り込み（#234）: OS からローカルファイル／フォルダを
  // ウィンドウへドラッグする。IPC を2往復させることで、再帰的な走査（フォルダは
  // ダイアログ選択よりはるかに多くを引き込みうる）が、レンダラーが
  // 「N 件を取り込みますか？」と尋ねる前に完了する——collect-dropped-paths は
  // 走査して数えるだけで、import-dropped-paths が同じ一覧を持って呼び戻されるまで
  // 何も取り込まれない（再走査は無く、「いいえ」の答えはこの2回目の呼び出しまで
  // 一切届かない）。source/idPrefix は 'drag' のまま——上のファイルダイアログの
  // 入り口が既に使っているのと同じ値。この2つの入り口がなぜそれを共有するかは
  // lib-local-intake.ts のモジュールコメントを参照。
  ipcMain.handle('collect-dropped-paths', async (_e, paths): Promise<DropCollectResult> => {
    if (!getSaveFolder()) return { files: [], mediaCount: 0, groups: [], error: 'no-folder' };
    if (getLibraryStatus().missing) return { files: [], mediaCount: 0, groups: [], error: 'library-missing' };
    if (!Array.isArray(paths) || !paths.length) return { files: [], mediaCount: 0, groups: [] };
    return collectDroppedPaths(paths);
  });

  ipcMain.handle('import-dropped-paths', async (_e, files, stackFolders): Promise<DropImportResult> => {
    const folder = getSaveFolder();
    if (!folder) return { imported: 0, skipped: 0, error: 'no-folder' };
    // #37: importPostRecords の同一の防御を参照。
    if (getLibraryStatus().missing) return { imported: 0, skipped: 0, error: 'library-missing' };
    if (!Array.isArray(files) || !files.length) return { imported: 0, skipped: 0 };
    fs.mkdirSync(folder, { recursive: true });
    const handle = await ensurePostsSynced();
    if (!handle) return { imported: 0, skipped: 0, error: 'no-folder' };
    const { sqlite } = handle;
    let imported = 0,
      skipped = 0,
      seq = 0;
    const stamp = Date.now();
    const toWrite: PostRecordInput[] = [];
    const writtenItemDirs: string[] = [];
    const folderGroups = new Map<number, string[]>();
    for (const f of files as DroppedFile[]) {
      let itemDir: string | null = null;
      try {
        const ext = String(f.ext || '').toLowerCase();
        if (!IMPORTABLE_MEDIA.includes(ext)) {
          skipped++;
          continue;
        }
        const st = await fs.promises.stat(f.path);
        if (!st.isFile()) {
          skipped++;
          continue;
        }
        const captureId = localCaptureId('drag', stamp, seq++);
        const fileName = `${captureId}.${ext}`;
        const file = itemFileRelative(captureId, fileName);
        itemDir = itemDirectoryAbsolute(folder, captureId);
        const nowIso = new Date().toISOString();
        const mtimeIso = st.mtime && !Number.isNaN(st.mtime.getTime()) ? st.mtime.toISOString() : nowIso;
        const rec: PostRecordInput = buildLocalRecord({
          captureId,
          file,
          ext,
          source: 'drag',
          title: stackFolders && f.folderTitle ? f.folderTitle : path.basename(f.path, path.extname(f.path)) || null,
          date: mtimeIso,
          now: nowIso,
        });
        await fs.promises.mkdir(itemDir, { recursive: true });
        await fs.promises.copyFile(f.path, path.join(itemDir, fileName));
        toWrite.push(rec);
        writtenItemDirs.push(itemDir);
        if (stackFolders && typeof f.folderGroup === 'number') {
          const members = folderGroups.get(f.folderGroup) || [];
          members.push(captureId);
          folderGroups.set(f.folderGroup, members);
        }
        imported++;
      } catch {
        if (itemDir) await fs.promises.rm(itemDir, { recursive: true, force: true });
        skipped++;
      }
    }

    if (toWrite.length) {
      const stmts = preparePostStmts(sqlite);
      const resolveTagId = makeTagResolver(sqlite);
      sqlite.exec('BEGIN');
      try {
        for (const rec of toWrite) writePost(stmts, resolveTagId, fillMediaDims(folder, fillCardDims(folder, rec)));
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        await Promise.all(writtenItemDirs.map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
        throw err;
      }
      notePostsSaved(toWrite.length);
      if (stackFolders) {
        const added = [...folderGroups.values()].filter((members) => members.length >= 2);
        if (added.length) {
          const dbWriter = createDbWriter(sqlite);
          const groups = dbWriter.getManualGroups().groups;
          dbWriter.setManualGroups([...groups, ...added]);
        }
      }
    }
    return { imported, skipped };
  });

  // 画像をライブラリへ直接貼り付ける（#85）。レンダラーの Ctrl+V がここへ着地する。
  // そのキーがいつインポートとして数えられるか（入力欄、オーバーレイ）は、フォーカスを
  // 知っているのがレンダラーだけなので、すべてレンダラー側の services/clipboard-intake.ts
  // で決める。
  //
  // 常に PNG: ClipboardItem の PNG をここでデコードして再エンコードするため、元の
  // エンコードは保存しない。「元の形式を保つ」場合は、ファイル選択かアプリへの
  // ドロップで取り込む。
  //
  // `title` はレンダラーから来る。ラベルは利用者に見えるもので、このプロセスは
  // メッセージテーブルを持たないため（i18n はレンダラー限定、services/i18n.ts）。
  // レコードの他の部分はここから取らない。
  ipcMain.handle('import-clipboard', async (_e, title): Promise<ClipboardImportResult> => {
    const folder = getSaveFolder();
    if (!folder) return { imported: 0, error: 'no-folder' };
    // #37: importLocalFile（lib-local-intake.ts）は書き込みの前に保存フォルダを
    // mkdir する——ここで拒むことで、貼り付けが行方不明のフォルダを再作成しない
    // ようにする。
    if (getLibraryStatus().missing) return { imported: 0, error: 'library-missing' };
    let bytes: Buffer | null = null;
    try {
      // PNGの表現だけを読む。テキストやHTMLのペイロードは取得しない。
      const items = await clipboard.read();
      const item = items.find((entry) => entry.types.includes('image/png'));
      if (item) {
        const payload = await item.getType('image/png');
        if (payload instanceof Blob && payload.size <= MAX_CLIPBOARD_PNG_BYTES) {
          // PNG署名と先頭のIHDRを検査し、復号前に展開後の画素量を制限する。
          const header = Buffer.from(await payload.slice(0, 33).arrayBuffer());
          const isPng = header.length === 33 && header.subarray(0, 8).equals(PNG_SIGNATURE) && header.readUInt32BE(8) === 13 && header.toString('ascii', 12, 16) === 'IHDR';
          const dimensions = isPng ? imageSize(header) : null;
          if (dimensions && dimensions.width * dimensions.height <= MAX_CLIPBOARD_PIXELS) {
            // 復号したピクセルをPNGに戻し、不要なメタデータを保存しない。
            const prepared = await prepareImageBytes(Buffer.from(await payload.arrayBuffer()), { kind: 'copy' });
            if (prepared?.mime === 'image/png') {
              const normalized = await fs.promises.readFile(prepared.path);
              if (normalized.length <= MAX_CLIPBOARD_PNG_BYTES) bytes = normalized;
            }
          }
        }
      }
    } catch {
      bytes = null;
    }
    // エラーではない——利用者がクリップボードに別のものが入った状態で Ctrl+V した
    // だけ。
    if (!bytes || !bytes.length) return { imported: 0, empty: true };
    const handle = await ensurePostsSynced();
    if (!handle) return { imported: 0, error: 'no-folder' };
    try {
      await importLocalFile({
        folder,
        sqlite: handle.sqlite,
        source: 'clipboard',
        idPrefix: 'clip',
        ext: 'png',
        bytes,
        title: typeof title === 'string' && title.trim() ? title : null,
        // 引き継ぐべき元の日付が無い——貼り付けそのものがレコードの日付になる（#85）。
      });
    } catch (err) {
      return { imported: 0, error: err.message };
    }
    // アプリ内での書き込みは取込キューのイベントを残さないので、普段レンダラーに
    // 再取得を伝えるウォッチャーは発火しない——削除の時（ipc-trash.ts）と同じ。
    send('posts-changed', null);
    notePostsSaved(1);
    return { imported: 1 };
  });
}

export { register };
