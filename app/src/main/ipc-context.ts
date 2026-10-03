'use strict';
import type { SearchCandidate } from '../shared/search-fields.ts';

// index.ts と7つの ipc-*.ts ハンドラモジュールの間の `ctx` 契約（#228）。
// index.ts が、抽出されたハンドラが閉じ込める中核のヘルパーと可変状態を公開する
// 1つのオブジェクトを組み立てる（registerExtractedIpc 参照）。各モジュールの
// `register(ctx: IpcContext)` が、自分に必要なメンバーを分解して取り出す。
//
// なぜ index.ts の `typeof ctx` ではなく手書きのインターフェースなのか:
// index.ts はハンドラモジュールを import するので、組み立て側から型を導出すると、
// モジュールが自分自身の import 元を import することになってしまう。代わりに
// ここで宣言することで「両方向」をチェックできる——index.ts は自分のリテラルに
// `const ctx: IpcContext` と注釈するので、名前や戻り値の形が変わったヘルパーは
// ビルドに失敗し、ctx が持たない何かに手を伸ばすハンドラも失敗する。それが
// 空いていた穴だった: 注釈の無い `register(ctx)` は、clear-all / import-complete /
// move-save-folder を運ぶこの境界にある約40のメンバーすべてを `any` にして
// いた。
//
// メインプロセス限定——BrowserWindow と SQLite ライターを名指ししている。
// レンダラーが必要とする半分（各チャネルのペイロードがどんな形か）は
// ./ipc-payloads.ts で、そちらは何も import しないのでレンダラーの DOM 限定の
// プログラムからも届く。
import type { BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import type { createDbWriter } from './lib-db-write.ts';
import type { relocateLibrary } from './lib-migrate.ts';
import type { ExportReminderState, FullTextHit, IntegrityStatus, LibraryStatus, OrphanRecoveryResult, PostsDelta, PostsSnapshot, RepointApplyResult, ValidationResult } from './ipc-payloads.ts';

/** DB を経由するすべてのハンドラが通る、整理状態の書き手。 */
export type DbWriter = ReturnType<typeof createDbWriter>;

/**
 * 開いたデータベース。`db` は Kysely のビルダー、`sqlite` はハンドラが使う
 * 生のハンドル（lib-db-query.ts と同じ理由: bm25() 用の型付きヘルパーが無く、
 * 2つ目のクエリの流儀を持つのはただの不整合になる）。
 */
export interface DbHandle {
  db: any;
  sqlite: Database.Database;
}

/**
 * ディスクから読んだ config.json。ハンドラが名前で参照する2つの欄だけを宣言
 * する。残りはオープンなままにする。このファイルは利用者が編集できる素の
 * JSON で、どの読み手も取り出した値を既に自分で守っているため（本物のゲートは
 * ipc-config.ts の環境設定の許可リスト）。
 */
export interface HologramConfig {
  saveFolder?: string;
  extensionId?: string;
  [key: string]: any;
}

export interface IpcContext {
  // --- ライブラリの場所とレコード ---
  /** null になることはない: 新規インストールは既定のライブラリディレクトリに解決される。 */
  getSaveFolder(): string;
  /** アプリが作成する既定のライブラリディレクトリ。 */
  defaultLibraryDir(): string;
  /** ライブラリの .trash/。保存フォルダが無ければ null。 */
  getTrashDir(): string | null;
  /** config.json の隣に書かれる、冗長な保存フォルダポインタ。 */
  readSavePointer(): string | null;
  /** #37: 現在の明示的な保存フォルダが、今この瞬間ディスク上に無いか。その場の statSync で、キャッシュしない。 */
  isLibraryMissing(): boolean;
  /** #37: isLibraryMissing() にパスを添えたもの——get-library-status がレンダラーへ渡すもの。 */
  getLibraryStatus(): LibraryStatus;
  /** 保存フォルダの「内側」で名前を解決する。脱出するなら null。 */
  resolveInFolder(name: string): string | null;
  mimeForFile(name: string): string;
  /** ライブラリのファイル名が属する captureId。 */
  baseOf(name: string | null | undefined): string;
  /** ダウンロードされたライブラリファイルが持ちうるすべての拡張子。 */
  LIBRARY_MEDIA_EXTS: readonly string[];
  APP_ICON: string;

  // --- データベース ---
  getDbWriter(): DbWriter;
  /** DB を開いて取込キューを送り出す。 */
  ensurePostsSynced(): DbHandle | null;
  scheduleSavedIndexWrite(handle: { sqlite: Database.Database }): void;
  /** 保留中の `replaces` の印を消費する（#34）——アプリ内での書き込みには取込キューのイベントが発火しない。 */
  sweepReplacements(): Promise<void>;
  listPosts(): Promise<PostsSnapshot>;
  /**
   * `senderId` は呼び出した webContents の id（#32 St1）——main は今、プロセス
   * 全体で1つではなく、レンダラー「ごとに」1つの差分の基準を保持する（これを
   * キーにした Map）。だから同じ tick でポーリングする2つのウィンドウが、
   * 互いの「最後に何を見たか」という記録をもう壊し合うことはない（この設計
   * 文書が最優先の修正として挙げる #466 のバグ: #32 以前は、2つ目のウィンドウの
   * 差分呼び出しが1つ目のウィンドウの基準を黙って奪い、まさに次の更新を
   * 飢えさせていた）。
   */
  listPostsDelta(haveBaseline: boolean, senderId: number): Promise<PostsDelta>;
  /** Meilisearchの一致箇所と関連度順。 */
  searchCandidates(query: string, entries: SearchCandidate[]): Promise<string[]>;
  searchFullText(query: string, limit?: number): Promise<FullTextHit[]>;

  // --- 設定 ---
  readConfig(): HologramConfig;
  writeConfig(cfg: HologramConfig): void;
  /**
   * 設定のキャッシュを捨てる（#61）。他の何かに config.json を書かせるハンドラ
   * だけが必要とする——extensionId を永続化するインストーラのこと。
   */
  invalidateConfigCache(): void;
  /** 今この瞬間、config.json が存在するのにパースできないなら true。 */
  isConfigCorrupt(): boolean;
  /** 劣化した設定で消去を拒まなければならない理由。無ければ null。 */
  clearAllBlockReason(args: { configCorrupt: boolean; hasExplicitSaveFolder: boolean; hasPointer: boolean; libraryMissing: boolean }): string | null;

  // --- 手動エクスポートの通知、ローカル復旧、整合性 ---
  getExportReminder(): ExportReminderState;
  setExportReminderEnabled(enabled: unknown): ExportReminderState;
  setExportReminderThreshold(threshold: unknown): ExportReminderState;
  markExported(): ExportReminderState;
  /** 新しく保存された投稿だけをエクスポート通知へ加算する。編集、削除、復元には使わない。 */
  notePostsSaved(count: number): ExportReminderState;
  armRecoverySchedule(): void;
  readIntegrityStatus(): IntegrityStatus;
  runOrphanRecovery(): Promise<OrphanRecoveryResult>;

  // --- 移動と取り込み ---
  validateSaveFolder(dir: string | null | undefined): ValidationResult;
  relocateLibrary: typeof relocateLibrary;
  restoreMissingLibrary(dest: string): Promise<RepointApplyResult>;
  /** #176: 稼働中の DB ハンドルを閉じる——relocateLibrary がフォルダをコピーする前にこれを使う。 */
  closeDb(): void;
  /** #176: getSaveFolder() が今解決する先で DB を開く（または作成する）。 */
  openDb(): void;
  /** 取込キューのウォッチャーを現在の保存フォルダへ向け直す。 */
  watchInboxFolder(): Promise<void>;
  /** 移動中の読み取りと inbox 監視を停止する。 */
  pauseLibraryRelocation(): Promise<number | null>;
  /** 現在設定された側の inbox を drain し、監視・差分・更新通知を復旧する。 */
  finishLibraryRelocation(owner: number): Promise<void>;
  /** owner だけが移動中に DB を閉じ、切替先を開ける。 */
  closeDbForLibraryRelocation(owner: number): void;
  openDbForLibraryRelocation(owner: number): void;
  /** すべての送信元の差分基準を捨てる（#32 St1: 今は Map）ので、すべてのウィンドウが全同期する。 */
  resetDelta(): void;

  // --- メディア取得（native-host 層） ---
  pixivRefererFor(url: unknown): string | undefined;
  downloadAvatar(avatar: unknown, referer: unknown, dir: string): Promise<string | null>;

  // --- ウィンドウ（#32 St1: 1プロセス／N ウィンドウ） ---
  /**
   * 主ウィンドウ（この実行で最初に作られたもの）。無くなれば null——Electron は
   * ダイアログの親を非 null と型付けするので、それを親にするハンドラは呼び出し
   * 箇所で絞り込む。「呼び出した方のウィンドウ」に対して動作するハンドラ
   * （window-control、ファイルピッカーの親）は、これではなく
   * `BrowserWindow.fromWebContents(event.sender)` を直接読む。
   */
  getWin(): BrowserWindow | null;
  /** すべてのウィンドウのレンダラーへ push する。1つも残っていなければ何もしない。 */
  send(channel: string, ...args: unknown[]): void;
  /** `exceptWebContentsId` を「除く」すべてのウィンドウへ push する（#32 St2: org-changed の中継）。 */
  sendExcept(exceptWebContentsId: number, channel: string, ...args: unknown[]): void;
  /**
   * `webContentsId` が「主」ウィンドウのものなら true——tabs.json の番人
   * （#32 St1 の設計:「他窓は読み書きとも遮断＝タブ喪失防止」）。永続化は
   * 呼び出し箇所ごとの分岐ではなく何もしないだけなので、将来の呼び出し元が
   * このチェックを忘れることは絶対に無い。
   */
  isPrimarySender(webContentsId: number): boolean;
  /** 新しい副ウィンドウを開く（Ctrl+Shift+N ／2回目の起動の入り口、#32 St1）。 */
  openNewWindow(): void;
}
