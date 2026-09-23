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
import type { IpcArgs, IpcChannel } from '../shared/ipc-inputs.ts';
import type { IpcResults } from '../shared/ipc-results.ts';

const invoke = <C extends keyof IpcResults & IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResults[C]> => ipcRenderer.invoke(channel, ...args);
import 'electron-log/preload';
import type {
  AppInfo,
  AppPrefs,
  ClearAllResult,
  ClipboardImportResult,
  CompleteImportResult,
  ConfigSummary,
  DropCollectResult,
  DroppedFile,
  DropImportResult,
  ExportCompleteResult,
  ExportProgress,
  ExportSaveResult,
  ExportReminderState,
  ExtensionContactStatus,
  FoldersState,
  FullTextHit,
  HistoryQueryOptions,
  HistoryQueryResult,
  IntegrityStatus,
  LibraryStatus,
  ManualGroupsState,
  MediaImportResult,
  OkResult,
  UpdateTagsResult,
  OrphanRecoveryResult,
  PostsDelta,
  PostsSnapshot,
  PosterTagsState,
  RecordPostViewResult,
  RepointApplyResult,
  RepointPickResult,
  SaveFolderMoveResult,
  SaveFolderPickResult,
  SaveFolderProgress,
  TagVocabRow,
  RenameTagResult,
  TagWriteResult,
  DeleteTagsResult,
  TabsState,
  TagGroupsState,
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

// 入力は共通スキーマから導いた型、戻り値は共通チャネル契約を使う。
const api = {
  takePostLink: () => invoke('take-post-link'),
  onPostLink: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on('post-link-available', listener);
    return () => ipcRenderer.removeListener('post-link-available', listener);
  },
  getConfig: (): Promise<ConfigSummary> => invoke('get-config'),
  // #71: ブリッジが接触の印にこれまで一度でも触れたかどうか＝ipc-config.ts の
  // get-extension-contact と、empty/EmptyState.tsx の導入案内の版を参照。プッシュではなく
  // 一度きりの取得（セッションの途中でこれを無効にするものは無い）。
  getExtensionContact: (): Promise<ExtensionContactStatus> => invoke('get-extension-contact'),
  listPosts: (): Promise<PostsSnapshot> => invoke('list-posts'),
  // 差分での更新。丸ごとのスナップショットを持っていれば true を渡す。main は丸ごとの
  // { full:true, posts:[] } か、差分の { full:false, added, removed } のどちらかを返す。
  listPostsDelta: (haveBaseline: boolean): Promise<PostsDelta> => invoke('list-posts-delta', haveBaseline),
  // 当たるかは services/fulltext.ts が決める。ここがするのは順位付けだけ）。
  searchCandidates: (query: string, entries: import('../shared/search-fields.ts').SearchCandidate[]): Promise<string[]> => invoke('search-candidates', query, entries),
  searchFullText: (query: string, limit?: number): Promise<FullTextHit[]> => invoke('search-full-text', query, limit),
  applyCachedMetadata: (key: string) => invoke('apply-cached-metadata', key),
  recordPostView: (captureId: string): Promise<RecordPostViewResult> => invoke('record-post-view', captureId),
  setMediaCrop: (...args: IpcArgs<'set-media-crop'>): Promise<OkResult> => invoke('set-media-crop', ...args),
  setMediaEdit: (...args: IpcArgs<'set-media-edit'>): Promise<OkResult> => invoke('set-media-edit', ...args),
  getTagGroups: (): Promise<TagGroupsState> => invoke('get-tag-groups'),
  setTagGroups: (...args: IpcArgs<'set-tag-groups'>): Promise<OkResult> => invoke('set-tag-groups', ...args),
  // #21 のタグ管理ページ（ipc-tag-vocab.ts）＝行ごとの書き込みで、上にある表を丸ごと扱う
  // get/set-tag-groups ではない（あのモジュールの setTagGroup のコメントを参照）。
  getTagVocab: (): Promise<TagVocabRow[]> => invoke('get-tag-vocab'),
  saveClassifiedTag: (...args: IpcArgs<'save-classified-tag'>) => invoke('save-classified-tag', ...args),
  getClassifiedAssignments: (...args: IpcArgs<'get-classified-assignments'>) => invoke('get-classified-assignments', ...args),
  setClassifiedAssignments: (...args: IpcArgs<'set-classified-assignments'>) => invoke('set-classified-assignments', ...args),
  renameTag: (tagId: number, newName: string): Promise<RenameTagResult> => invoke('rename-tag', tagId, newName),
  mergeTags: (sourceTagId: number, targetTagId: number): Promise<TagWriteResult> => invoke('merge-tags', sourceTagId, targetTagId),
  setTagGroup: (tagId: number, kind: string | null): Promise<TagWriteResult> => invoke('set-tag-group', tagId, kind),
  deleteTags: (tagIds: number[]): Promise<DeleteTagsResult> => invoke('delete-tags', tagIds),
  // #777: 分割＝確認画面のデータ源と、その確定の動作。
  getUngrouped: (): Promise<UngroupedState> => invoke('get-ungrouped'),
  setUngrouped: (...args: IpcArgs<'set-ungrouped'>): Promise<OkResult> => invoke('set-ungrouped', ...args),
  getPosterTags: (): Promise<PosterTagsState> => invoke('get-poster-tags'),
  setPosterTags: (...args: IpcArgs<'set-poster-tags'>): Promise<OkResult> => invoke('set-poster-tags', ...args),
  getManualGroups: (): Promise<ManualGroupsState> => invoke('get-manual-groups'),
  setManualGroups: (...args: IpcArgs<'set-manual-groups'>): Promise<OkResult> => invoke('set-manual-groups', ...args),
  getFolders: (): Promise<FoldersState> => invoke('get-folders'),
  setFolders: (...args: IpcArgs<'set-folders'>): Promise<OkResult> => invoke('set-folders', ...args),
  getTabs: (): Promise<TabsState | null> => invoke('get-tabs'),
  setTabs: (...args: IpcArgs<'set-tabs'>): Promise<OkResult> => invoke('set-tabs', ...args),
  // #145: グローバルの履歴ページ。append はレンダラーの push 時のフック
  // （services/history.ts）から投げっぱなしにする。query は OFFSET ではなく (ts, id) の
  // キーセットでページを送る（lib-db-write.ts の queryHistory のコメントを参照）。
  appendHistory: (...args: IpcArgs<'append-history'>): Promise<OkResult> => invoke('append-history', ...args),
  queryHistory: (opts: HistoryQueryOptions): Promise<HistoryQueryResult> => invoke('query-history', opts),
  deleteHistoryRow: (id: number): Promise<OkResult> => invoke('delete-history-row', id),
  clearHistory: (): Promise<OkResult> => invoke('clear-history'),
  openExternal: (url: string): Promise<void> => invoke('open-external', url),
  // false = 断った。単体のビューアはラスタ画像しか出さない（#215）。そこでの SVG は、
  // ライブラリ自身のオリジンで動くスクリプト付きの文書になってしまう。
  openImageWindow: (image: string): Promise<boolean> => invoke('open-image-window', image),
  showInFolder: (file: string): Promise<void> => invoke('show-in-folder', file),
  // false = nativeImage がデコードできず（svg/tiff）、クリップボードには手を付けなかった。
  copyImage: (file: string): Promise<boolean> => invoke('copy-image', file),
  // false = 書くものが無く、クリップボードには手を付けなかった（#167）。
  copyText: (text: string): Promise<boolean> => invoke('copy-text', text),
  getAppInfo: (): Promise<AppInfo> => invoke('app-info'),
  getPrefs: (): Promise<AppPrefs> => invoke('get-prefs'),
  setPref: (...args: IpcArgs<'set-pref'>): Promise<OkResult> => invoke('set-pref', ...args),
  imageDataUrl: (image: string): Promise<string | null> => invoke('image-data-url', image),
  // pixiv のうごイラの再生（#506）。書庫を開くのは main で、レンダラーがそれを見ることは
  // 無い。キャプチャの表が名前を挙げるフレームが本当に全部そこにあるかを一度尋ね、あとは
  // 再生位置が必要とするたびにフレームを1枚ずつ引く。
  ugoiraFramesPresent: (file: string, names: string[]): Promise<boolean> => invoke('ugoira-frames-present', file, names),
  // 素の Uint8Array ではなく Uint8Array<ArrayBuffer>。レンダラーはこれをそのまま Blob へ
  // 渡すが、BlobPart は共有されているかもしれない裏のバッファを受け付けない。
  ugoiraFrame: (file: string, name: string): Promise<Uint8Array<ArrayBuffer> | null> => invoke('ugoira-frame', file, name),
  deletePost: (image: string): Promise<OkResult> => invoke('delete-post', image),
  updateTags: (...args: IpcArgs<'update-tags'>): Promise<UpdateTagsResult> => invoke('update-tags', ...args),
  // 旧形式の ZIP の取り込みの後半。main は `zipPath`（import-complete が返したパス）にある
  // 書庫を読むので、そのバイト列も、展開されたレコードも、この境界を越えない（#322）。まず
  // mode 無しで一度呼んでその一括分に重複があるかを知り、答えを添えてもう一度呼ぶ（#34）。
  clearAll: (): Promise<ClearAllResult> => invoke('clear-all'),
  exportSave: (...args: IpcArgs<'export-save'>): Promise<ExportSaveResult> => invoke('export-save', ...args),
  exportComplete: (mode?: string, includeTrash?: boolean): Promise<ExportCompleteResult> => invoke('export-complete', mode, includeTrash),
  // 引数は無い。main がファイルの選択画面を出し、ディスクから書庫を読む（#485）。
  importComplete: (): Promise<CompleteImportResult> => invoke('import-complete'),
  pickSaveFolder: (): Promise<SaveFolderPickResult> => invoke('pick-save-folder'),
  moveSaveFolder: (dest: string): Promise<SaveFolderMoveResult> => invoke('move-save-folder', dest),
  // #37: 今この時点で、現在の保存フォルダがディスク上に無いかどうか。常にその場で確認し、
  // キャッシュしたプッシュは決して使わない（ipc-config.ts の get-library-status を参照）。
  getLibraryStatus: (): Promise<LibraryStatus> => invoke('get-library-status'),
  // 付け替え。config.saveFolder を、別の場所に既にあるライブラリへ向ける。コピーはしない
  // （保存フォルダが無くなったときの #37 の逃げ道＝上の pick-save-folder と
  // move-save-folder は、コピー元として現在のフォルダがそこにあることを前提にしている）。
  pickRepointFolder: (): Promise<RepointPickResult> => invoke('pick-repoint-folder'),
  applyRepoint: (dest: string): Promise<RepointApplyResult> => invoke('apply-repoint', dest),
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
  getExportReminder: (): Promise<ExportReminderState> => invoke('get-export-reminder'),
  setExportReminderEnabled: (enabled: boolean): Promise<ExportReminderState> => invoke('set-export-reminder-enabled', enabled),
  setExportReminderThreshold: (threshold: number): Promise<ExportReminderState> => invoke('set-export-reminder-threshold', threshold),
  onExportReminderChanged: (cb: (state: ExportReminderState) => void): void => {
    ipcRenderer.on('export-reminder-changed', (_e, state) => cb(state));
  },
  importImages: (): Promise<MediaImportResult> => invoke('import-images'),
  // #234: ウィンドウへのドロップで取り込む。何かを書く前にフォルダの再帰的な走査を終わらせ
  // （そして件数を確認し）たいので、呼び出しを2回に分けてある。collect-dropped-paths が
  // 返したのと同じ DroppedFile[] が2回目の呼び出しでそのまま戻るので、main が走査をやり直す
  // ことは無い。
  collectDroppedPaths: (paths: string[]): Promise<DropCollectResult> => invoke('collect-dropped-paths', paths),
  importDroppedPaths: (files: DroppedFile[], stackFolders: boolean): Promise<DropImportResult> => invoke('import-dropped-paths', files, stackFolders),
  // #234: OS からウィンドウへドラッグされた File の裏にある、本物の fs のパス。Electron 32 が
  // File.path を外し、webUtils.getPathForFile（Electron 43）がその代わりになった。
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  // アプリのウィンドウでの Ctrl+V（#85）。`title` をレンダラー側で組み立てるのは、それが
  // 翻訳された利用者に見えるラベルであり、main はメッセージの表を持たないため。
  importClipboard: (title: string): Promise<ClipboardImportResult> => invoke('import-clipboard', title),
  getIntegrityStatus: (): Promise<IntegrityStatus> => invoke('get-integrity-status'),
  runOrphanRecovery: (): Promise<OrphanRecoveryResult> => invoke('run-orphan-recovery'),
  // cb が受け取るのは整合性の状態だけ。生の IPC イベントは転送しない。
  onIntegrityCheckDone: (cb: (status: IntegrityStatus) => void): void => {
    ipcRenderer.on('integrity-check-done', (_e, status) => cb(status));
  },
  // ゴミ箱に入れたキャプチャは自分のレコードを丸ごと持っている（.trash/ の JSON）ので、これは
  // list-posts が返すのと同じ、開かれた投稿レコードの形。
  listTrash: (): Promise<import('../../../native-host/post-schemas.mts').PostRecordShape[]> => invoke('list-trash'),
  restorePost: (image: string): Promise<OkResult> => invoke('restore-post', image),
  emptyTrash: (): Promise<OkResult> => invoke('empty-trash'),
  deleteFromTrash: (image: string): Promise<OkResult> => invoke('delete-from-trash', image),
  // 取込キューが変わったときに発火する。生の IPC イベントは転送しない。
  onPostsChanged: (cb: () => void): void => {
    ipcRenderer.on('posts-changed', () => cb());
  },
  // 呼び出し元ウィンドウの操作。
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close'): Promise<boolean | null> => invoke('window-control', action),
  // Ctrl+Shift+N と、新しいウィンドウを開く入り口（#32 St1）。`invoke` ではなく `send`＝
  // 待つものが無い。main がウィンドウを作り、この呼び出しはそれで終わり。
  openNewWindow: (): void => ipcRenderer.send('open-new-window'),
  // #32 St2: 別のウィンドウでの整理の層への書き込み（タグの種別、投稿者のフォルダ／タグ／
  // 手動のグループ、グループ解除、ライブラリのフォルダ）が成功したあとに発火する＝
  // ipc-organize.ts を参照。`kind` は get/set-* の領域と一致する（例えば 'folders'、
  // 'poster-tags'）ので、購読側は実際に変わったストアだけを読み込み直せる。unsubscribe を
  // 返す。onExportProgress と同じ形。
  onOrgChanged: (cb: (kind: string) => void): (() => void) => {
    const h = (_e: unknown, kind: string) => cb(kind);
    ipcRenderer.on('org-changed', h);
    return () => ipcRenderer.removeListener('org-changed', h);
  },
};

// contextBridge が晒す IPC の面の全体（window.hologram）＝実装の typeof なので、ずれ得る
// 手書きの写しは存在しない。
export type HologramPreload = typeof api;

contextBridge.exposeInMainWorld('hologram', api);
