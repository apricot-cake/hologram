// preload のブリッジ＝コミットしてあるビルド成果物 app/preload.js の TypeScript の元。
// sandbox の preload ローダーは型注釈を剥がさないので、.mts のメインプロセス層と違い、この
// 1ファイルだけはビルドする（electron-vite の preload ビルド → Vite の lib CJS、electron は
// external）。実行時のモジュール形式が CJS なので .cts（native-host 層と同じ作法）。
//
// export している HologramPreload 型が、そのまま window.hologram の取り決め。レンダラーの
// プログラムは types/globals.d.ts でこれに別名を付けている（electron-shim の paths の対応
// による＝そのファイルを参照）ので、型がブリッジの実際の露出からずれることはあり得ない。
// このファイル自身は、tsconfig.node.json によって本物の electron の型と突き合わせて検査
// される。
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import 'electron-log/preload';
import type {
  AppInfo,
  AppPrefs,
  BackupConfig,
  BackupRunResult,
  ClearAllResult,
  ClipboardImportResult,
  CompleteImportResult,
  ConfigSummary,
  DbGeneration,
  DbRollbackResult,
  DropCollectResult,
  DroppedFile,
  DropImportResult,
  ExportCompleteResult,
  ExportProgress,
  ExportSaveResult,
  ExtensionContactStatus,
  FoldersState,
  FullTextHit,
  HistoryQueryOptions,
  HistoryQueryResult,
  IndexQueueStatus,
  IntegrityStatus,
  IpcPostRecord,
  LegacyImportResult,
  LibraryStatus,
  ManualGroupsState,
  MediaImportResult,
  WatchImportConfig,
  WatchImportFolder,
  OkResult,
  UpdateTagsResult,
  OrphanRecoveryResult,
  PickLibraryFolderResult,
  PinItem,
  PostsDelta,
  PostsSnapshot,
  PosterAliasesState,
  PosterFoldersState,
  PosterTagsState,
  RecentLibraryEntry,
  RecordPostViewResult,
  RepointApplyResult,
  RepointPickResult,
  SwitchLibraryResult,
  SaveFolderMoveResult,
  SaveFolderPickResult,
  SaveFolderProgress,
  TagVocabRow,
  TagParentRowResolved,
  RenameTagResult,
  TagWriteResult,
  DeleteOrphanTagsResult,
  TagSplitPost,
  SplitTagResult,
  TagAliasRow,
  AddTagAliasResult,
  TabsState,
  TagTypesState,
  UngroupedState,
} from '../main/ipc-payloads.ts';

// webUtils.getPathForFile(file: File)（electron.d.ts）はアンビエントのグローバル `File` を
// 参照していて、ふつうは "DOM" の lib がそれを満たす。tsconfig.node.json は意図して DOM を
// 外している＝main と preload がそのプロジェクトを共有していて、DOM の setTimeout や Buffer
// 周りのグローバルが、メインプロセス全体で @types/node のものを覆い隠してしまうため
// （types/electron-shim.d.ts がレンダラー側で逆向きに避けているのと同じ種類の衝突）。ここでは
// その1つの呼び出し（#234）を型検査に通すのに足りるだけの `File` を宣言する。
// window.hologram.getPathForFile へ渡す本物の File を作るレンダラーのプログラムは、本物の
// DOM の lib を既に持っている（tsconfig.web.json）ので、これを必要とすることは無い。
declare global {
  interface File {
    readonly name: string;
  }
}

// 下のメソッドはどれも、自分のチャンネルが何に解決するかを書いている（#228）。`invoke` は
// 作りからして Promise<any> なので、これらの注釈がレンダラーの得る唯一の説明になる。しかも
// それらは、clear-all／import-complete／move-save-folder を運ぶ境界の上で `any` だった。形は
// ../main/ipc-payloads.ts にあり、それを作るハンドラの隣に置いてある。作る側が問題なく型検査
// を通るところでは、そのハンドラにも注釈として付けてある。あのモジュールは何も import しない
// ので、DOM だけのレンダラーのプログラムからも HologramPreload 経由で届く。
const api = {
  getConfig: (): Promise<ConfigSummary> => ipcRenderer.invoke('get-config'),
  // #834（親 #98）: 背後で走る索引付けの実時間の進捗と、その一時停止の操作。マウント時に
  // 一度取得し、あとはプッシュを追う＝キュー自身の状態の変化は main 側でまとめられるので、
  // 1回の実行あたり数通で済む。
  getIndexQueueStatus: (): Promise<IndexQueueStatus> => ipcRenderer.invoke('get-index-queue-status'),
  pauseIndexQueue: (): Promise<IndexQueueStatus> => ipcRenderer.invoke('pause-index-queue'),
  resumeIndexQueue: (): Promise<IndexQueueStatus> => ipcRenderer.invoke('resume-index-queue'),
  // unsubscribe を返す（onExportProgress と同じ形）。進捗の表示はシェルと一緒にマウント
  // されるが、ピンのウィンドウ自身の木はそうではないし、片付けたコンポーネントに残ったリスナー
  // はそこへ呼び続けてしまう。
  onIndexQueueProgress: (cb: (s: IndexQueueStatus) => void): (() => void) => {
    const h = (_e: unknown, s: IndexQueueStatus) => cb(s);
    ipcRenderer.on('index-queue-progress', h);
    return () => ipcRenderer.removeListener('index-queue-progress', h);
  },
  // #71: ブリッジが接触の印にこれまで一度でも触れたかどうか＝ipc-config.ts の
  // get-extension-contact と、empty/EmptyState.tsx の導入案内の版を参照。プッシュではなく
  // 一度きりの取得（セッションの途中でこれを無効にするものは無い）。
  getExtensionContact: (): Promise<ExtensionContactStatus> => ipcRenderer.invoke('get-extension-contact'),
  listPosts: (): Promise<PostsSnapshot> => ipcRenderer.invoke('list-posts'),
  // 差分での更新。丸ごとのスナップショットを持っていれば true を渡す。main は丸ごとの
  // { full:true, posts:[] } か、差分の { full:false, added, removed } のどちらかを返す。
  listPostsDelta: (haveBaseline: boolean): Promise<PostsDelta> => ipcRenderer.invoke('list-posts-delta', haveBaseline),
  // #29: タブをまたぐ全文検索＝パレットの全文モードのための bm25() の関連度順（どの投稿が
  // 当たるかは services/fulltext.ts が決める。ここがするのは順位付けだけ）。
  searchFullText: (query: string, limit?: number): Promise<FullTextHit[]> => ipcRenderer.invoke('search-full-text', query, limit),
  recordPostView: (captureId: string): Promise<RecordPostViewResult> => ipcRenderer.invoke('record-post-view', captureId),
  getTagTypes: (): Promise<TagTypesState> => ipcRenderer.invoke('get-tag-types'),
  setTagTypes: (types: unknown, labels?: unknown): Promise<OkResult> => ipcRenderer.invoke('set-tag-types', types, labels),
  // #21 のタグ管理ページ（ipc-tag-vocab.ts）＝行ごとの書き込みで、上にある表を丸ごと扱う
  // get/set-tag-types ではない（あのモジュールの setTagKind のコメントを参照）。
  getTagVocab: (): Promise<TagVocabRow[]> => ipcRenderer.invoke('get-tag-vocab'),
  getTagParentEdges: (): Promise<TagParentRowResolved[]> => ipcRenderer.invoke('get-tag-parent-edges'),
  renameTag: (tagId: number, newName: string): Promise<RenameTagResult> => ipcRenderer.invoke('rename-tag', tagId, newName),
  keepSeparateRenameTag: (tagId: number, newName: string, displayParentTagId: number): Promise<TagWriteResult> => ipcRenderer.invoke('keep-separate-rename-tag', tagId, newName, displayParentTagId),
  mergeTags: (sourceTagId: number, targetTagId: number, keepOldNameAsAlias?: boolean): Promise<TagWriteResult> => ipcRenderer.invoke('merge-tags', sourceTagId, targetTagId, keepOldNameAsAlias),
  addTagParent: (tagId: number, parentTagId: number, isDisplay: boolean): Promise<TagWriteResult> => ipcRenderer.invoke('add-tag-parent', tagId, parentTagId, isDisplay),
  removeTagParent: (tagId: number, parentTagId: number): Promise<TagWriteResult> => ipcRenderer.invoke('remove-tag-parent', tagId, parentTagId),
  setTagKind: (tagId: number, kind: string | null): Promise<TagWriteResult> => ipcRenderer.invoke('set-tag-kind', tagId, kind),
  deleteOrphanTags: (tagIds: number[]): Promise<DeleteOrphanTagsResult> => ipcRenderer.invoke('delete-orphan-tags', tagIds),
  // #777: 分割＝確認画面のデータ源と、その確定の動作。
  getTagSplitPreview: (tagId: number, candidateParentTagId: number): Promise<TagSplitPost[]> => ipcRenderer.invoke('get-tag-split-preview', tagId, candidateParentTagId),
  splitTag: (sourceTagId: number, displayParentTagId: number, postIds: string[]): Promise<SplitTagResult> => ipcRenderer.invoke('split-tag', sourceTagId, displayParentTagId, postIds),
  // #86: tag_aliases の CRUD。
  getTagAliases: (): Promise<TagAliasRow[]> => ipcRenderer.invoke('get-tag-aliases'),
  addTagAlias: (tagId: number, alias: string): Promise<AddTagAliasResult> => ipcRenderer.invoke('add-tag-alias', tagId, alias),
  removeTagAlias: (aliasId: number): Promise<TagWriteResult> => ipcRenderer.invoke('remove-tag-alias', aliasId),
  getUngrouped: (): Promise<UngroupedState> => ipcRenderer.invoke('get-ungrouped'),
  setUngrouped: (keys: unknown): Promise<OkResult> => ipcRenderer.invoke('set-ungrouped', keys),
  getPosterFolders: (): Promise<PosterFoldersState> => ipcRenderer.invoke('get-poster-folders'),
  setPosterFolders: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-poster-folders', data),
  getPosterTags: (): Promise<PosterTagsState> => ipcRenderer.invoke('get-poster-tags'),
  setPosterTags: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-poster-tags', data),
  getPosterAliases: (): Promise<PosterAliasesState> => ipcRenderer.invoke('get-poster-aliases'),
  setPosterAliases: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-poster-aliases', data),
  getManualGroups: (): Promise<ManualGroupsState> => ipcRenderer.invoke('get-manual-groups'),
  setManualGroups: (groups: unknown): Promise<OkResult> => ipcRenderer.invoke('set-manual-groups', groups),
  getFolders: (): Promise<FoldersState> => ipcRenderer.invoke('get-folders'),
  setFolders: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-folders', data),
  getTabs: (): Promise<TabsState | null> => ipcRenderer.invoke('get-tabs'),
  setTabs: (data: unknown): Promise<OkResult> => ipcRenderer.invoke('set-tabs', data),
  // #145: グローバルの履歴ページ。append はレンダラーの push 時のフック
  // （services/history.ts）から投げっぱなしにする。query は OFFSET ではなく (ts, id) の
  // キーセットでページを送る（lib-db-write.ts の queryHistory のコメントを参照）。
  appendHistory: (row: unknown): Promise<OkResult> => ipcRenderer.invoke('append-history', row),
  queryHistory: (opts: HistoryQueryOptions): Promise<HistoryQueryResult> => ipcRenderer.invoke('query-history', opts),
  deleteHistoryRow: (id: number): Promise<OkResult> => ipcRenderer.invoke('delete-history-row', id),
  clearHistory: (): Promise<OkResult> => ipcRenderer.invoke('clear-history'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  // false = 断った。単体のビューアはラスタ画像しか出さない（#215）。そこでの SVG は、
  // ライブラリ自身のオリジンで動くスクリプト付きの文書になってしまう。
  openImageWindow: (image: string): Promise<boolean> => ipcRenderer.invoke('open-image-window', image),
  showInFolder: (file: string): Promise<void> => ipcRenderer.invoke('show-in-folder', file),
  copyFilePath: (file: string): Promise<boolean> => ipcRenderer.invoke('copy-file-path', file),
  // #236: 取り込み（assetClass:'file'）のカードの「開く」。main がクリックの時点で許可リスト
  // を確認し直し、OS の既定のアプリで開く。断るときはフォルダに表示（opened:false）へ退避
  // する。lib-open-gate.ts を参照。
  openPostFile: (file: string): Promise<{ opened: boolean }> => ipcRenderer.invoke('open-post-file', file),
  // invoke ではなく send。OS のドラッグは、レンダラーがまだ開いたまま持っている dragstart の
  // 中で始めなければならない＝Promise の往復では、着く頃にはジェスチャが終わっている。
  dragOut: (files: string[]): void => ipcRenderer.send('drag-out', files),
  // false = nativeImage がデコードできず（svg/tiff）、クリップボードには手を付けなかった。
  copyImage: (file: string): Promise<boolean> => ipcRenderer.invoke('copy-image', file),
  // false = 書くものが無く、クリップボードには手を付けなかった（#167）。
  copyText: (text: string): Promise<boolean> => ipcRenderer.invoke('copy-text', text),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke('app-info'),
  getPrefs: (): Promise<AppPrefs> => ipcRenderer.invoke('get-prefs'),
  setPref: (key: string, value: unknown): Promise<OkResult> => ipcRenderer.invoke('set-pref', key, value),
  imageDataUrl: (image: string): Promise<string | null> => ipcRenderer.invoke('image-data-url', image),
  // pixiv のうごイラの再生（#506）。書庫を開くのは main で、レンダラーがそれを見ることは
  // 無い。キャプチャの表が名前を挙げるフレームが本当に全部そこにあるかを一度尋ね、あとは
  // 再生位置が必要とするたびにフレームを1枚ずつ引く。
  ugoiraFramesPresent: (file: string, names: string[]): Promise<boolean> => ipcRenderer.invoke('ugoira-frames-present', file, names),
  // 素の Uint8Array ではなく Uint8Array<ArrayBuffer>。レンダラーはこれをそのまま Blob へ
  // 渡すが、BlobPart は共有されているかもしれない裏のバッファを受け付けない。
  ugoiraFrame: (file: string, name: string): Promise<Uint8Array<ArrayBuffer> | null> => ipcRenderer.invoke('ugoira-frame', file, name),
  deletePost: (image: string): Promise<OkResult> => ipcRenderer.invoke('delete-post', image),
  updateTags: (image: string, tags: unknown, patch?: unknown): Promise<UpdateTagsResult> => ipcRenderer.invoke('update-tags', image, tags, patch),
  // 旧形式の ZIP の取り込みの後半。main は `zipPath`（import-complete が返したパス）にある
  // 書庫を読むので、そのバイト列も、展開されたレコードも、この境界を越えない（#322）。まず
  // mode 無しで一度呼んでその一括分に重複があるかを知り、答えを添えてもう一度呼ぶ（#34）。
  importLegacyZip: (zipPath: string, duplicateMode?: string): Promise<LegacyImportResult> => ipcRenderer.invoke('import-legacy-zip', zipPath, duplicateMode),
  clearAll: (): Promise<ClearAllResult> => ipcRenderer.invoke('clear-all'),
  exportSave: (filename: string, bytes: Uint8Array | ArrayBuffer): Promise<ExportSaveResult> => ipcRenderer.invoke('export-save', filename, bytes),
  exportComplete: (mode?: string, includeTrash?: boolean): Promise<ExportCompleteResult> => ipcRenderer.invoke('export-complete', mode, includeTrash),
  // 引数は無い。main がファイルの選択画面を出し、ディスクから書庫を読む（#485）。
  importComplete: (): Promise<CompleteImportResult> => ipcRenderer.invoke('import-complete'),
  pickSaveFolder: (): Promise<SaveFolderPickResult> => ipcRenderer.invoke('pick-save-folder'),
  moveSaveFolder: (dest: string): Promise<SaveFolderMoveResult> => ipcRenderer.invoke('move-save-folder', dest),
  // #37: 今この時点で、現在の保存フォルダがディスク上に無いかどうか。常にその場で確認し、
  // キャッシュしたプッシュは決して使わない（ipc-config.ts の get-library-status を参照）。
  getLibraryStatus: (): Promise<LibraryStatus> => ipcRenderer.invoke('get-library-status'),
  // 付け替え。config.saveFolder を、別の場所に既にあるライブラリへ向ける。コピーはしない
  // （保存フォルダが無くなったときの #37 の逃げ道＝上の pick-save-folder と
  // move-save-folder は、コピー元として現在のフォルダがそこにあることを前提にしている）。
  pickRepointFolder: (): Promise<RepointPickResult> => ipcRenderer.invoke('pick-repoint-folder'),
  applyRepoint: (dest: string): Promise<RepointApplyResult> => ipcRenderer.invoke('apply-repoint', dest),
  // #176: 設定にある、意図して「別のライブラリへ切り替える」流れ（切り替え／新規作成／
  // 最近使ったライブラリ）。下地は上の付け替えと同じ switchLibrary で、入り口と確認の文言が
  // 違う。
  pickLibraryFolder: (): Promise<PickLibraryFolderResult> => ipcRenderer.invoke('pick-library-folder'),
  switchLibrary: (dest: string): Promise<SwitchLibraryResult> => ipcRenderer.invoke('switch-library', dest),
  getRecentLibraries: (): Promise<RecentLibraryEntry[]> => ipcRenderer.invoke('get-recent-libraries'),
  removeRecentLibrary: (folder: string): Promise<OkResult> => ipcRenderer.invoke('remove-recent-library', folder),
  onSaveFolderProgress: (cb: (p: SaveFolderProgress) => void): void => {
    ipcRenderer.on('save-folder-progress', (_e, p) => cb(p));
  },
  // （onSaveFolderProgress と違い）unsubscribe を返すので、書き出しはその間だけ付き、終わったら
  // 外れる。書き出しを繰り返してもリスナーが積み上がらない。
  onExportProgress: (cb: (p: ExportProgress) => void): (() => void) => {
    const h = (_e: unknown, p: ExportProgress) => cb(p);
    ipcRenderer.on('export-progress', h);
    return () => ipcRenderer.removeListener('export-progress', h);
  },
  getBackup: (): Promise<BackupConfig> => ipcRenderer.invoke('get-backup'),
  runBackup: (): Promise<BackupRunResult> => ipcRenderer.invoke('run-backup'),
  listDbGenerations: (): Promise<DbGeneration[]> => ipcRenderer.invoke('list-db-generations'),
  // ライブラリの整理を1つの世代まで巻き戻す。main は答えを返した直後にすべてのウィンドウを
  // 読み込み直す＝その時点でレンダラーの状態は丸ごと古くなっている。
  rollbackDbGeneration: (name: string): Promise<DbRollbackResult> => ipcRenderer.invoke('rollback-db-generation', name),
  importImages: (): Promise<MediaImportResult> => ipcRenderer.invoke('import-images'),
  // #234: ウィンドウへのドロップで取り込む。何かを書く前にフォルダの再帰的な走査を終わらせ
  // （そして件数を確認し）たいので、呼び出しを2回に分けてある。collect-dropped-paths が
  // 返したのと同じ DroppedFile[] が2回目の呼び出しでそのまま戻るので、main が走査をやり直す
  // ことは無い。
  collectDroppedPaths: (paths: string[]): Promise<DropCollectResult> => ipcRenderer.invoke('collect-dropped-paths', paths),
  importDroppedPaths: (files: DroppedFile[]): Promise<DropImportResult> => ipcRenderer.invoke('import-dropped-paths', files),
  // #234: OS からウィンドウへドラッグされた File の裏にある、本物の fs のパス。Electron 32 が
  // File.path を外し、webUtils.getPathForFile（Electron 43）がその代わりになった。
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // アプリのウィンドウでの Ctrl+V（#85）。`title` をレンダラー側で組み立てるのは、それが
  // 翻訳された利用者に見えるラベルであり、main はメッセージの表を持たないため。
  importClipboard: (title: string): Promise<ClipboardImportResult> => ipcRenderer.invoke('import-clipboard', title),
  getWatchImport: (): Promise<WatchImportConfig> => ipcRenderer.invoke('get-watch-import'),
  pickWatchImportFolder: (): Promise<{ ok: boolean; canceled?: boolean; error?: string; path?: string }> => ipcRenderer.invoke('pick-watch-import-folder'),
  setWatchImport: (folders: WatchImportFolder[], markExisting?: string[]): Promise<WatchImportConfig> => ipcRenderer.invoke('set-watch-import', folders, markExisting),
  // 実行が始まった。ペイロードが一切無いので cb は引数を取らない。生の IPC イベントは転送
  // しない（#383）。レンダラーのコールバックを ipcRenderer.on へそのまま渡してはいけない。
  // Electron の IpcRendererEvent（とその `sender`）を contextBridge の向こうへ通してしまう。
  onBackupStart: (cb: () => void): void => {
    ipcRenderer.on('backup-start', () => cb());
  },
  // cb が受け取るのはバックアップの結果だけ。生の IPC イベントは転送しない。
  onBackupDone: (cb: (result: BackupRunResult) => void): void => {
    ipcRenderer.on('backup-done', (_e, result) => cb(result));
  },
  getIntegrityStatus: (): Promise<IntegrityStatus> => ipcRenderer.invoke('get-integrity-status'),
  runOrphanRecovery: (): Promise<OrphanRecoveryResult> => ipcRenderer.invoke('run-orphan-recovery'),
  // cb が受け取るのは整合性の状態だけ。生の IPC イベントは転送しない。
  onIntegrityCheckDone: (cb: (status: IntegrityStatus) => void): void => {
    ipcRenderer.on('integrity-check-done', (_e, status) => cb(status));
  },
  // ゴミ箱に入れたキャプチャは自分のレコードを丸ごと持っている（.trash/ の JSON）ので、これは
  // list-posts が返すのと同じ、開かれた投稿レコードの形。
  listTrash: (): Promise<IpcPostRecord[]> => ipcRenderer.invoke('list-trash'),
  restorePost: (image: string): Promise<OkResult> => ipcRenderer.invoke('restore-post', image),
  emptyTrash: (): Promise<OkResult> => ipcRenderer.invoke('empty-trash'),
  deleteFromTrash: (image: string): Promise<OkResult> => ipcRenderer.invoke('delete-from-trash', image),
  // 取込キューが変わったときに発火する。生の IPC イベントは転送しない。
  onPostsChanged: (cb: () => void): void => {
    ipcRenderer.on('posts-changed', () => cb());
  },
  // ウィンドウの操作（最小化／最大化／閉じるはアプリ描画＝WindowControls コンポーネントを参照）。
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close'): Promise<boolean | null> => ipcRenderer.invoke('window-control', action),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window-is-maximized'),
  // cb が受け取るのは新しい最大化の状態だけ。生の IPC イベントは転送しない。
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void): void => {
    ipcRenderer.on('window-maximized-changed', (_e, maximized) => cb(maximized));
  },
  // Ctrl+Shift+N と、新しいウィンドウを開く入り口（#32 St1）。`invoke` ではなく `send`＝
  // 待つものが無い。main がウィンドウを作り、この呼び出しはそれで終わり。
  openNewWindow: (): void => ipcRenderer.send('open-new-window'),
  // #32 St2: 別のウィンドウでの整理の層への書き込み（タグの種別、投稿者のフォルダ／タグ／
  // 別名、手動のグループ、グループ解除、ライブラリのフォルダ）が成功したあとに発火する＝
  // ipc-organize.ts を参照。`kind` は get/set-* の領域と一致する（例えば 'folders'、
  // 'poster-tags'）ので、購読側は実際に変わったストアだけを読み込み直せる。unsubscribe を
  // 返す。onExportProgress と同じ形。
  onOrgChanged: (cb: (kind: string) => void): (() => void) => {
    const h = (_e: unknown, kind: string) => cb(kind);
    ipcRenderer.on('org-changed', h);
    return () => ipcRenderer.removeListener('org-changed', h);
  },
  // #79（ピンのウィンドウ）: invoke ではなく send＝open-new-window と同じく投げっぱなし。
  // それに opts.newWindow（フォルダの「ピンで開く」の入り口）は、往復を待つのではなく即座に
  // 感じられるべき。
  pinSend: (items: PinItem[], opts?: { newWindow?: boolean }): void => ipcRenderer.send('pin-send', items, opts),
  // ピンのウィンドウが、自分が何を渡されて開かれたのかを最初に読む口。main は loadURL の
  // 時点でそれをプッシュしない（lib-pin-window.ts の takeInitial のコメントを参照）。
  pinGetInitial: (): Promise<PinItem[]> => ipcRenderer.invoke('pin-get-initial'),
  onPinItemsAdded: (cb: (items: PinItem[]) => void): (() => void) => {
    const h = (_e: unknown, items: PinItem[]) => cb(items);
    ipcRenderer.on('pin-items-added', h);
    return () => ipcRenderer.removeListener('pin-items-added', h);
  },
  // 新しい状態を返す（main はそれを呼び出し元のウィンドウ自身から解決する＝
  // BrowserWindow.fromWebContents(event.sender) で、window-control が既に使っているのと同じ
  // 呼び出し元ごとの解決）。
  pinToggleAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('pin-toggle-always-on-top'),
  pinSaveAsFolder: (name: string, captureIds: string[]): Promise<OkResult> => ipcRenderer.invoke('pin-save-as-folder', name, captureIds),
};

// contextBridge が晒す IPC の面の全体（window.hologram）＝実装の typeof なので、ずれ得る
// 手書きの写しは存在しない。
export type HologramPreload = typeof api;

contextBridge.exposeInMainWorld('hologram', api);
