'use strict';

// Transfer 系の IPC ハンドラ。main.js から抽出した（機械的な移動＝ロジックは変えていない）。
// 影響範囲が最大のグループ: import-legacy-zip（#300 より前のエクスポートを main で読む処理で、
// data: URL への展開とベストエフォートのアバター取得を加えたもの）、
// import-images（ローカルファイル）、clear-all（破壊的な全消去。設定が健全な時だけ許可）、
// export-save / export-complete / import-complete（ZIP の往復）、pick-save-folder
// （クラッシュ安全なライブラリ移動＝コピー→設定切り替え→旧データ削除、その後ウォッチャーを
// 再設定してレンダラーを全同期）。重い処理（validateSaveFolder、
// copyLibraryInto、watchSaveFolder、設定/ポインタ層、clearAllBlockReason、
// アバター取得）はこのモジュールの外にあり（#227: lib-backup.ts、lib-migrate.ts、
// lib-config.ts、native-host.ts）、ctx 経由で届く。可変状態には
// send/isConfigCorrupt/resetDelta のアクセサ経由で触れる。ダイアログはすべて呼び出した
// ウィンドウを親にする（#32 St1: BrowserWindow.fromWebContents(e.sender)）。共有された
// 「唯一の」ウィンドウではない。
import { ipcMain, dialog, clipboard, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import * as archive from './lib-archive.ts';
import { parseJsonLoose } from './lib-json.ts';
import { cloudSyncProviderOf } from './save-folder-guard.ts';
import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { IMPORTABLE_MEDIA, buildLocalRecord, importLocalFile, localCaptureId } from './lib-local-intake.ts';
import { classifyLibraryFolder } from './lib-switch-library.ts';
import { collectDroppedPaths } from './lib-drop-import.ts';
import type { PostRecordInput } from '../../../native-host/post-record.mts';
import type { IpcContext } from './ipc-context.ts';
import type {
  ClearAllResult,
  ClipboardImportResult,
  CompleteImportResult,
  DropCollectResult,
  DroppedFile,
  DropImportResult,
  ExportCompleteResult,
  ExportSaveResult,
  LegacyImportResult,
  MediaImportResult,
  PickLibraryFolderResult,
  RecentLibraryEntry,
  RepointApplyResult,
  RepointPickResult,
  SaveFolderMoveResult,
  SaveFolderPickResult,
  SwitchLibraryResult,
} from './ipc-payloads.ts';

function exportStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

// 移動先ライブラリの名前付きサブフォルダ。フォルダを選んだ時に sidecar・画像を
// 直下へ平積みしないため（BACKUP_SUBDIR の Hologram-backup と対の関係）。
const LIBRARY_SUBDIR = 'Hologram-library';

// 拡張子の一覧と、ローカルインポートしたファイルがなるレコードの形は lib-local-intake.ts に
// 移した＝下のダイアログはそれを共有する4つの入り口のひとつ
// （#84 の実装設計コメント参照。クリップボードの入り口はこのファイルの末尾）。

function register(ctx: IpcContext) {
  const {
    getSaveFolder,
    defaultLibraryDir,
    getTrashDir,
    readConfig,
    writeConfig,
    readSavePointer,
    isConfigCorrupt,
    clearAllBlockReason,
    getLibraryStatus,
    LIBRARY_MEDIA_EXTS,
    getDbWriter,
    pixivRefererFor,
    downloadAvatar,
    send,
    validateSaveFolder,
    relocateLibrary,
    switchLibrary,
    listRecentLibraries,
    removeRecentLibrary,
    closeDb,
    openDb,
    watchInboxFolder,
    resetDelta,
    ensurePostsSynced,
    scheduleSavedIndexWrite,
    sweepReplacements,
  } = ctx;

  // #299: DB への書き手はアプリ自身ひとつだけなので、投稿の取り込みは共有のレコードライター
  // （lib-db-record-writer.ts＝sidecar インポータと取込キューの消費側が使うのと同じもの）
  // 経由で DB へ直接書く。DB が後で再導出する羽目になる sidecar は作らない。
  // 重複判定も sidecar を走査せず DB（URL ベース）を見る＝この経路で来る投稿には
  // もう走査すべき sidecar が残っていない。
  //
  // IPC ハンドラではない: legacy ZIP インポートはこのレコードを作る唯一の経路で、
  // 今はアーカイブを main 側で読む（#322）ため、レコード（投稿ごとに base64 の
  // data: URL を持つ）がプロセス境界を越えることはない。以前は `import-posts` という名前で、
  // レンダラーが自分の持つアーカイブのコピーから組み立てた配列を渡して呼んでいた。
  //
  // #34 で URL 重複の扱いを、固定のスキップから拡張機能の警告と同じ3択に変え、
  // バッチ全体に対して1回だけ尋ねる形にした（投稿単位で聞くと、インポートは一度に
  // 百件単位で来るので百回質問することになる）。`duplicateMode` がその答え:
  //   'skip'    — ライブラリ側のコピーはそのままに残りを取り込む（従来どおり、今も既定の動作）
  //   'copy'    — 重複も追加レコードとして取り込む
  //   'replace' — 重複を取り込み、かつ各重複が指す元レコードを退役させる。拡張機能が書くのと
  //               同じ `replaces` の印を使う
  // 未指定で重複が存在する場合は何も取り込まず { needsChoice, duplicates } を返し、
  // レンダラーが尋ねて呼び直せるようにする。
  async function importPostRecords(posts, duplicateMode) {
    const mode = duplicateMode === 'copy' || duplicateMode === 'replace' || duplicateMode === 'skip' ? duplicateMode : null;
    const folder = getSaveFolder();
    if (!folder || !Array.isArray(posts)) return { imported: 0, skipped: 0 };
    // #37: アプリの足元でなくなった保存フォルダを、遅延的に作り直したりしない
    // ＝でないと下の mkdirSync が、インポートが走った瞬間に旧パスへ新品の
    // 空ライブラリをこっそり作ってしまう。
    if (getLibraryStatus().missing) return { imported: 0, skipped: 0, error: 'library-missing' };
    fs.mkdirSync(folder, { recursive: true });
    const handle = await ensurePostsSynced();
    if (!handle) return { imported: 0, skipped: 0 };
    const { sqlite } = handle;

    // 重複判定。url を第一の識別子とする。URL のない投稿（file / Eagle からの移行＝
    // legacy の主なケース）は、そうしないと再インポートで丸ごと重複してしまうため、
    // eagleName + capturedAt + 画像バイトサイズ（stat のみ、内容の読み取り／ハッシュはしない）の
    // 組み合わせに落とす。3つとも一致が必要: eagleName 単体は一意ではない（利用者に見える
    // タイトルであり、実際の Eagle ライブラリには同名が多数ある）し、変換ツールがバッチ全体に
    // 同じ capturedAt を刻むこともあるため、どちらの欄も単独では信用できない。
    //
    // 現行ライブラリは素の集合ではなく url -> captureId で保持する。"replace" は
    // 退役させるレコードを名指しする必要があるため（#34）。ゴミ箱行きの URL は別集合に
    // 分ける＝意図して削除した投稿は、重複質問への答えが何であれ再インポートで
    // 復活してはいけない。
    const existingByUrl = new Map<string, string>();
    const trashedUrls = new Set<string>();
    const existingLegacy = new Set<string>();
    const legacyKeyOf = (name, at, bytes) => `${name}\u0000${at}\u0000${bytes}`;
    for (const row of sqlite.prepare('SELECT captureId, url, eagleName, capturedAt, image FROM posts').all() as Array<{ captureId: string; url: string | null; eagleName: string | null; capturedAt: string; image: string | null }>) {
      if (row.url) {
        if (!existingByUrl.has(row.url)) existingByUrl.set(row.url, row.captureId);
        continue;
      }
      if (row.eagleName && row.capturedAt && typeof row.image === 'string') {
        try {
          // statSync が例外を投げたら（画像ファイルが無い）このキーはスキップする
          // ＝そのレコードは重複判定できないだけで、インポートは安全側に倒れる。
          existingLegacy.add(legacyKeyOf(row.eagleName, row.capturedAt, fs.statSync(path.join(folder, row.image)).size));
        } catch {
          /* スキップ */
        }
      }
    }
    // .trash/ にはまだ sidecar の JSON が残っている（ゴミ箱はこの Issue の範囲外＝
    // #301）＝意図して削除した投稿は、そこに残っている間は再インポートで
    // 復活してはいけない。
    const trashDir = getTrashDir();
    if (trashDir) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(trashDir);
      } catch {
        names = [];
      }
      for (const f of names) {
        if (!f.toLowerCase().endsWith('.json')) continue;
        try {
          const r = parseJsonLoose(fs.readFileSync(path.join(trashDir, f), 'utf8'));
          if (r.url) trashedUrls.add(r.url);
          else if (r.eagleName && r.capturedAt && typeof r.image === 'string') {
            existingLegacy.add(legacyKeyOf(r.eagleName, r.capturedAt, fs.statSync(path.join(trashDir, r.image)).size));
          }
        } catch {
          /* 読めないものはスキップ */
        }
      }
    }

    // アバターは共有の avatars/ ストアに置く（アバター URL ごとに1ファイル）＝
    // 成功したダウンロードはストア自身が存在チェックで重複排除するので、ローカルの
    // キャッシュが要るのは失敗した URL だけ（そうしないと、アバターのホストが死んでいる
    // legacy インポートは、その投稿者のレコードひとつごとに取得タイムアウトを
    // 払い直すことになる）。
    const avatarFailed = new Set();
    async function fetchAvatarShared(url) {
      if (avatarFailed.has(url)) return null;
      let file: string | null = null;
      try {
        file = await downloadAvatar(url, pixivRefererFor(url), folder);
      } catch {
        file = null;
      }
      if (!file) avatarFailed.add(url);
      return file;
    }

    // 取り込む前に尋ねる（#34）。下のループが使うのと同じ条件で数えるので、質問に出す
    // 件数は、その答えが適用される投稿の件数に一致する。重複のないバッチは
    // 一切尋ねない。
    if (!mode) {
      let duplicates = 0;
      for (const p of posts) if (p?.url && existingByUrl.has(p.url)) duplicates++;
      if (duplicates) return { imported: 0, skipped: 0, needsChoice: true, duplicates, total: posts.length };
    }
    const onDuplicate = mode || 'skip';

    const stamp = Date.now();
    let imported = 0,
      skipped = 0,
      seq = 0;
    const toWrite: PostRecordInput[] = [];
    for (const p of posts) {
      if (!p || typeof p.image !== 'string' || !/^data:image\//.test(p.image)) {
        skipped++;
        continue;
      }
      if (p.url && trashedUrls.has(p.url)) {
        skipped++;
        continue;
      }
      const duplicateOf = p.url ? existingByUrl.get(p.url) : undefined;
      if (duplicateOf !== undefined && onDuplicate === 'skip') {
        skipped++;
        continue;
      }
      const imgBuf = Buffer.from(p.image.split(',')[1] || '', 'base64');
      const legacyKey = !p.url && p.eagleName && p.capturedAt ? legacyKeyOf(p.eagleName, p.capturedAt, imgBuf.length) : null;
      if (legacyKey && existingLegacy.has(legacyKey)) {
        skipped++;
        continue;
      }
      const captureId = `import-${stamp}-${String(seq++).padStart(4, '0')}`;
      const rec: PostRecordInput = {
        captureId,
        // 'replace': 拡張機能が書くのと同じ印で、同じ掃き寄せ処理（lib-db-replaces.ts）が
        // 消費する＝レコードがどの入り口から来ても、「置き換える」の定義はひとつ。
        replaces: duplicateOf !== undefined && onDuplicate === 'replace' ? duplicateOf : null,
        image: `${captureId}.jpg`,
        url: p.url || null,
        platform: p.platform || null,
        text: p.text || null,
        title: p.title || null,
        displayName: p.displayName || null,
        screenName: p.screenName || null,
        userId: p.userId || null,
        avatar: p.avatar || null,
        avatarFile: null,
        // #289: 下の quotedPost/poll/customEmojis と同様に素通りさせる。この legacy 形式を
        // 生成する側で今これを埋められるものは無い（この読み手が知るどのエクスポートより
        // これらの欄は後発）ので、これは将来に備えた安全策であって生きた経路ではない。
        // bannerFile はここで再取得しない。理由は下の avatarFile の再取得メモと同じ
        // （このインポータは URL だけの legacy 形式からレコードを再構成する処理であって、
        // 保存パイプラインのダウンロード処理ではない）。
        bio: p.bio || null,
        profileLinks: Array.isArray(p.profileLinks) ? p.profileLinks : null,
        banner: p.banner || null,
        bannerFile: null,
        followers: p.followers ?? null,
        authorCreatedAt: p.authorCreatedAt || null,
        likes: p.likes ?? null,
        reposts: p.reposts ?? null,
        replies: p.replies ?? null,
        bookmarks: p.bookmarks ?? null,
        views: p.views ?? null,
        date: p.date || null,
        capturedAt: p.capturedAt || new Date().toISOString(),
        updatedAt: p.updatedAt || p.capturedAt || new Date().toISOString(),
        capturedVia: p.capturedVia || null,
        eagleName: p.eagleName || null,
        mediaType: p.mediaType || null,
        lang: p.lang || null,
        isReply: p.isReply || null,
        isQuote: p.isQuote || null,
        isThread: p.isThread || null,
        isEdited: p.isEdited || null,
        editedAt: p.editedAt || null,
        cw: p.cw || null,
        // #178: sensitive はそれを返すプラットフォームでは明確な `false` を持つ
        // （上の isEdited と違い、明示的な false があり得る）＝`?? null` にして、
        // `|| null` のように潰れず本物の false が往復で残るようにする。
        sensitive: p.sensitive ?? null,
        quotedUrl: p.quotedUrl || null,
        replyToId: p.replyToId || null,
        // #180: sidecar の副レコード。ここの他の欄と同様に素通りさせる＝この機能が
        // 既に触れた投稿を legacy ZIP で再インポートした時、静かに失われないように。
        quotedPost: p.quotedPost || null,
        replyToPost: p.replyToPost || null,
        // #179: 上の2つと同じ理由で素通りさせる＝この機能が既に触れた投稿を legacy ZIP で
        // 再インポートした時、poll を静かに失ってはいけない。
        poll: p.poll || null,
        // #290: 上の quotedPost/replyToPost と同じ理由で素通りさせる＝この機能が既に触れた
        // 投稿を legacy ZIP で再インポートした時、静かに失ってはいけない。この legacy 形式を
        // 生成する側で今これを埋められるものは無い（この読み手が知るどのエクスポートより
        // この欄は後発）ので、これは将来に備えた安全策であって生きた経路ではない。上の
        // avatarFile と違い、ここでは再取得しない（このインポータの仕事は URL だけの
        // legacy 形式からレコードを再構成することであって、保存パイプラインの共有ストアへの
        // ダウンロードをもう一度走らせることではない）。
        customEmojis: Array.isArray(p.customEmojis) ? p.customEmojis : [],
        // #181: 上の quotedPost/replyToPost/poll と同じく素通りさせる＝この機能が既に
        // 触れた投稿を legacy ZIP で再インポートした時、link card を静かに失っては
        // いけない。この legacy 形式を生成する側で今これを埋められるものは無い（上の
        // customEmojis のメモと同じく将来に備えた安全策のみ）。すぐ上のトップレベルの
        // avatar と違い、thumbnailFile はここで再取得しない: このインポータの仕事は
        // URL だけの legacy 形式からレコードを再構成することであって、保存パイプラインの
        // ダウンロードをもう一度走らせることではない（customEmojis 自身のコメントが
        // それらのファイルを再取得しない理由として述べているのと同じ理屈）。
        linkCard: p.linkCard || null,
        // #239: 上の quotedPost/replyToPost/poll/linkCard と同じく素通りさせる＝この機能が
        // 既に触れた投稿を legacy ZIP で再インポートした時、provenance map を静かに
        // 失ってはいけない。この legacy 形式を生成する側で今これを埋められるものは無い
        // （上の customEmojis/linkCard のメモと同じく将来に備えた安全策のみ）。
        metaSource: p.metaSource && typeof p.metaSource === 'object' ? p.metaSource : null,
        seriesId: p.seriesId || null,
        seriesTitle: p.seriesTitle || null,
        seriesOrder: p.seriesOrder ?? null,
        media: Array.isArray(p.media) ? p.media : [],
        hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
        tags: Array.isArray(p.tags) ? p.tags : [],
        // #202: 素通りさせる＝転送の往復で、ページ読み取りの値がプラットフォーム API の
        // 裏付けありに静かにすり替わらないように。
        domFilled: Array.isArray(p.domFilled) ? p.domFilled : [],
      };
      try {
        fs.writeFileSync(path.join(folder, `${captureId}.jpg`), imgBuf);
        // DB 書き込みの前にアバターをベストエフォートで取得し、avatarFile が
        // ディスクに実際に届いたものを反映するようにする。それ自体を try で
        // くるむことで、アバター取得の失敗は avatarFile を null に留めるだけで
        // （表示側は非表示にする）、インポート自体は絶対に失敗させない。
        if (rec.avatar) {
          try {
            const af = await fetchAvatarShared(rec.avatar);
            if (af) rec.avatarFile = af;
          } catch {
            /* アバターはベストエフォート */
          }
        }
        toWrite.push(rec);
        // 1つのバッチの中では、その URL を最初に取り込んだものが取る＝同じ ZIP に
        // 同じ投稿が2つ入っていたら、2つ目はライブラリの元のレコードではなく、
        // たった今書いたレコードの重複として扱われる。
        if (p.url) existingByUrl.set(p.url, captureId);
        else if (legacyKey) existingLegacy.add(legacyKey);
        imported++;
      } catch {
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
        throw err;
      }
      // ブリッジ側の保存済みバッジのスナップショットは、これらの URL を他に知る
      // 手段が無い（気づくための sidecar／取込キューのイベントが存在しない）。
      scheduleSavedIndexWrite(handle);
      // アプリ内での書き込みは取込キューのイベントを残さないので、普段
      // `replaces` の印を消費するウォッチャーはこれらに対して発火しない
      // ＝ここで自分でやる（#34）。
      if (onDuplicate === 'replace') await sweepReplacements();
    }
    return { imported, skipped };
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
    // 次にメディア——表示対象のあらゆる種類（jfif/avif/svg/video/-poster を含む）、
    // delete-post と同じ扱い。#302 以降ライブラリが保持するのはメディアだけ:
    // レコードは DB にあるので、一緒に掃き寄せるべき随伴ファイルは無い。
    const CLEAR_RE = new RegExp('\\.(' + LIBRARY_MEDIA_EXTS.join('|') + ')$', 'i');
    try {
      for (const f of fs.readdirSync(folder)) {
        if (CLEAR_RE.test(f)) {
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
      await fs.promises.writeFile(res.filePath, Buffer.from(bytes));
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
  // 手動専用: スケジュール実行側はバックアップ処理（runBackup）が担い、これは
  // 旧来のスケジュール ZIP 案を置き換えたもの——ZIP は手で持ち出すスナップショットの
  // ままでいる。
  ipcMain.handle('export-complete', async (_e, mode, includeTrash): Promise<ExportCompleteResult> => {
    const imagesOnly = mode === 'images';
    const src = getSaveFolder();
    // 空かどうかは readdir で安く分かる——ダイアログより前に確認して、空のライブラリで
    // 保存プロンプトが出ないようにする（旧来の fileCount===0 → empty の挙動と一致）。
    let hasAny: boolean;
    try {
      hasAny = await archive.hasExportableFiles(src, imagesOnly);
    } catch (err) {
      return { saved: false, error: err.message };
    }
    if (!hasAny) return { saved: false, empty: true };
    // complete 形式のエクスポートは投稿を DB から読む（imagesOnly は従来どおり単純な
    // ディスクコピーのまま——もともと sidecar／整理情報は含んでいなかった）。
    let handle: any = null;
    if (!imagesOnly) {
      handle = await ensurePostsSynced();
      if (!handle) return { saved: false, error: 'no-folder' };
    }
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
    try {
      win?.setProgressBar(0);
      send('export-progress', { written: 0, total: 0, pct: 0 });
      const built = imagesOnly ? await archive.writeImagesZip(src, res.filePath, onProgress) : await archive.writeCompleteZip(handle.sqlite, src, getTrashDir(), res.filePath, { includeTrash: !!includeTrash }, undefined, onProgress);
      try {
        win?.setProgressBar(-1);
      } catch {
        /* ウィンドウが無い */
      }
      send('export-progress', { done: true });
      return { saved: true, path: res.filePath, fileCount: built.fileCount };
    } catch (err) {
      try {
        win?.setProgressBar(-1);
      } catch {
        /* ウィンドウが無い */
      }
      send('export-progress', { done: true });
      try {
        await fs.promises.unlink(res.filePath);
      } catch {
        /* 掃除するものは無い */
      }
      return { saved: false, error: err.message };
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
      if (!out.notComplete) return out;
      return { ok: false, legacy: true, path: zipPath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // legacy インポートの後半: `zipPath` のアーカイブを読み、そこに書かれたレコードを
  // 書き込む。バッチに重複がある時は2回呼ばれる——1回目は質問用の件数を得るため、
  // 2回目は答え付きで——ので、利用者への確認をまたいでメモリに展開したまま保持せず、
  // アーカイブを読み直す。パスに対してこの関数がすることは読むことだけで、その範囲を
  // 決めているのは readLegacyZipPosts の防御。ZipLimitError は catch に落ちて、
  // ただのインポート失敗として扱われる。
  ipcMain.handle('import-legacy-zip', async (_e, zipPath, duplicateMode): Promise<LegacyImportResult> => {
    if (!zipPath || typeof zipPath !== 'string') return { ok: false, error: 'invalid', imported: 0, skipped: 0 };
    try {
      const posts = await archive.readLegacyZipPosts(zipPath);
      if (!posts) return { ok: false, error: 'not-an-export', imported: 0, skipped: 0 };
      return Object.assign({ ok: true }, await importPostRecords(posts, duplicateMode));
    } catch (err) {
      return { ok: false, error: err.message, imported: 0, skipped: 0 };
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
  function moveLibraryTo(dest: string): SaveFolderMoveResult | Promise<SaveFolderMoveResult> {
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
    return relocateLibrary(src, dest, {
      readConfig,
      writeConfig,
      emit: (payload) => send('save-folder-progress', payload),
      closeDb,
      openDb,
      defaultLibraryDir: defaultLibraryDir(),
      // 取込キューのウォッチャーを再設定し、差分の基準を捨ててレンダラーを全同期させる。
      afterFlip: () => {
        watchInboxFolder();
        resetDelta();
      },
      // この掃き寄せは1分後に発火する——その間にライブラリがまた移動していたらスキップする。
      stillCurrent: () => path.resolve(getSaveFolder() || '') === path.resolve(dest),
    });
  }

  ipcMain.handle('pick-save-folder', async (_e): Promise<SaveFolderPickResult> => {
    // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const chosen = res.filePaths[0];
    // 選んだフォルダは「親」として扱い、ライブラリは名前付きサブフォルダに置く
    // ——利用者自身のファイルがあるかもしれないフォルダへ、sidecar・画像を直下に
    // 平積みしたりしない。既存の Hologram-library フォルダを選び直した場合はそのまま
    // 使う（二重の入れ子にしない）。
    const dest = path.basename(chosen).toLowerCase() === LIBRARY_SUBDIR.toLowerCase() ? chosen : path.join(chosen, LIBRARY_SUBDIR);
    const v = validateSaveFolder(dest);
    if (!v.ok) return { ok: false, error: v.error };

    // 移動先がクラウド同期のルート配下にあるように見える時は警告する（ブロックはしない）
    // ＝ライブラリは実時間で書き込まれるので、同期クライアントがその書き込みと競合すると
    // 壊しかねない。判定はヒューリスティック→決めるのは利用者。ミラーがサポート対象の
    // クラウド置き場。
    const cloudProvider = cloudSyncProviderOf(dest);
    if (cloudProvider) return { ok: false, confirm: 'cloud-sync', provider: cloudProvider, dest };

    return moveLibraryTo(dest);
  });

  // 選択フローの後半: 利用者が既に警告を受け入れた移動先へ実際に移動する。
  // 汎用の「どこへでも移動」の入り口ではない。
  ipcMain.handle('move-save-folder', async (_e, dest): Promise<SaveFolderMoveResult> => {
    if (!dest || typeof dest !== 'string') return { ok: false, error: 'invalid' };
    return moveLibraryTo(dest);
  });

  // --- Repoint: 既に存在するライブラリへ config.saveFolder を向け直す（#37）。
  // 上の移動フローは現在のフォルダが読める前提（そこからコピーする）。repoint は
  // 逆の状況のためのもの——現在のフォルダが行方不明で、本物のライブラリはどこか
  // 別の場所にある（別のドライブレター、あるいは利用者がアプリの外で手動で
  // 動かしたフォルダ）。#176 で repoint の実処理を switchLibrary（下）に畳み込んだ
  // ——データベースが今はライブラリフォルダの内側に住んでいるので、「別の既存
  // ライブラリへ config.saveFolder を向ける」ことと「古い DB を閉じて新しいフォルダの
  // ものを開く」ことは同じ操作であり、コピー無しのポインタ切り替えに加えて別立ての
  // DB の話がある、というものではない。このペアは、行方不明ライブラリの復旧画面
  // （LibraryMissingState.tsx）向けに独自の名前とコピーを保つ。下の
  // pick-library-folder/switch-library（Settings が意図して用意した「別のライブラリへ
  // 切り替える」フロー）へ統合はしない——裏で呼ぶ switchLibrary は同じでも、
  // 入り口と文言が違う。
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
    return switchLibrary(dest);
  });

  // --- 設定の「ライブラリ」節（#176）: 切り替え / 新規作成 / 最近使った
  // ライブラリ。pick-library-folder は何も開かずに移動先を決定・分類するだけ
  // なので、レンダラーは実際に switch-library を呼んで確定する前に、分類が求める
  // 確認（無し／「新規に始めますか？」／「復旧しますか？」）を表示できる。
  // 「最近使ったライブラリ」の行は既に確認済み（以前に開いたことがある）なので、
  // 選択の手順を飛ばして switch-library を直接呼ぶ。
  ipcMain.handle('pick-library-folder', async (_e): Promise<PickLibraryFolderResult> => {
    // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
    const dest = res.filePaths[0];
    const v = validateSaveFolder(dest);
    if (!v.ok) return { ok: false, error: v.error };
    const classification = classifyLibraryFolder(dest);
    if (classification === 'reject') return { ok: false, error: 'not-a-library' };
    return { ok: true, dest, classification };
  });

  ipcMain.handle('switch-library', async (_e, dest): Promise<SwitchLibraryResult> => {
    if (!dest || typeof dest !== 'string') return { ok: false, error: 'invalid' };
    return switchLibrary(dest);
  });

  ipcMain.handle('get-recent-libraries', (): RecentLibraryEntry[] => listRecentLibraries());

  ipcMain.handle('remove-recent-library', (_e, folder): { ok: boolean } => {
    if (!folder || typeof folder !== 'string') return { ok: false };
    removeRecentLibrary(folder);
    return { ok: true };
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
    // #236: フィルタは2つ、まず Media（ピッカーが既定で選ぶ方）、次に逃げ道の
    // All Files——収集はもう IMPORTABLE_MEDIA で止めず、そこから assetClass を
    // 決めるだけになった（下の buildLocalRecord）。
    // #32 St1: 呼び出したウィンドウを親にする。ctx.getWin()（主ウィンドウ）ではない。
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(_e.sender) as BrowserWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Media', extensions: IMPORTABLE_MEDIA },
        { name: 'All Files', extensions: ['*'] },
      ],
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
    for (const fp of res.filePaths) {
      try {
        // もう IMPORTABLE_MEDIA での足切りはしない（#236——どんな拡張子でも収集
        // 対象で、拡張子は assetClass を決めるだけ）。'bin' は拡張子無しの
        // フォールバック（'png' ではない——拡張子の無い選択は写真とは限らない）。
        const ext = (path.extname(fp).slice(1) || 'bin').toLowerCase();
        const st = await fs.promises.stat(fp);
        if (!st.isFile()) {
          skipped++;
          continue;
        }
        const captureId = localCaptureId('drag', stamp, seq++);
        const file = `${captureId}.${ext}`;
        const nowIso = new Date().toISOString();
        const mtimeIso = st.mtime && !Number.isNaN(st.mtime.getTime()) ? st.mtime.toISOString() : nowIso;
        // クリップボードの入り口や（後の）監視フォルダと共有——lib-local-intake.ts
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
        await fs.promises.copyFile(fp, path.join(folder, file));
        toWrite.push(rec);
        imported++;
      } catch {
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
        throw err;
      }
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
    if (!getSaveFolder()) return { files: [], mediaCount: 0, otherCount: 0, error: 'no-folder' };
    if (getLibraryStatus().missing) return { files: [], mediaCount: 0, otherCount: 0, error: 'library-missing' };
    if (!Array.isArray(paths) || !paths.length) return { files: [], mediaCount: 0, otherCount: 0 };
    return collectDroppedPaths(paths);
  });

  ipcMain.handle('import-dropped-paths', async (_e, files): Promise<DropImportResult> => {
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
    for (const f of files as DroppedFile[]) {
      try {
        const st = await fs.promises.stat(f.path);
        if (!st.isFile()) {
          skipped++;
          continue;
        }
        const captureId = localCaptureId('drag', stamp, seq++);
        const file = `${captureId}.${f.ext}`;
        const nowIso = new Date().toISOString();
        const mtimeIso = st.mtime && !Number.isNaN(st.mtime.getTime()) ? st.mtime.toISOString() : nowIso;
        const rec: PostRecordInput = buildLocalRecord({
          captureId,
          file,
          ext: f.ext,
          source: 'drag',
          title: path.basename(f.path, path.extname(f.path)) || null,
          date: mtimeIso,
          now: nowIso,
        });
        await fs.promises.copyFile(f.path, path.join(folder, file));
        toWrite.push(rec);
        imported++;
      } catch {
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
        throw err;
      }
    }
    return { imported, skipped };
  });

  // 画像をライブラリへ直接貼り付ける（#85）。レンダラーの Ctrl+V がここへ着地する。
  // そのキーがいつインポートとして数えられるか（入力欄、オーバーレイ）は、フォーカスを
  // 知っているのがレンダラーだけなので、すべてレンダラー側の services/clipboard-intake.ts
  // で決める。
  //
  // 常に PNG: readImage() が返すのはデコード済みのビットマップで、元のエンコードは
  // 既に失われている。だから再エンコードは選択の余地が無く、「元の形式を保つ」は
  // ここには実装されていない。元のバイト列が欲しい呼び出し元は、ファイルの入り口
  // （ダイアログ、#234 のドロップ、#84 の監視フォルダ）を使う。
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
      // まず availableFormats(): テキストしか無いクリップボードはどのみち空の
      // NativeImage を返すが、先に安く確認しておくことで、大きな text/html の
      // ペイロードを、捨てるためだけに画像デコーダへ渡さずに済む。
      if (clipboard.availableFormats().some((f) => f.startsWith('image/'))) {
        const img = clipboard.readImage();
        if (!img.isEmpty()) bytes = img.toPNG();
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
    return { imported: 1 };
  });
}

export { register };
