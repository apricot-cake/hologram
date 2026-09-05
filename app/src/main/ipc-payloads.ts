'use strict';

// main⇄renderer の IPC 契約（#228）のうち PAYLOAD 側: ipcMain.handle / ipcRenderer.invoke を
// 実際に行き来する形と、webContents.send で push される形。ここには Electron も SQLite も
// 一切知らない型しかなく、このモジュールは何もインポートしない——それは意図的なもの。
// レンダラーの strict なプログラムはこれらの型に間接的に到達する（types/globals.d.ts が
// HologramPreload をエイリアスし、それがすべてのブリッジメソッドにこれらの型を注釈するため）
// ので、このファイルが何かを取り込めば、DOM のみのプログラムにもそれが取り込まれてしまう。
//
// メインプロセス内部向けの半分——ipc-* の各モジュールが受け取る `ctx` 依存オブジェクト——は
// ./ipc-context.ts で、そちらはまさに BrowserWindow と DB ライターを名指しするから main 限定。
//
// これらの型が何であり、何でないか:
//   * 各ハンドラの実際の戻り値を、ハンドラを読んで手で確認して書いた記述であり、
//     `ipcRenderer.invoke` は構造上 `Promise<any>` なので、コンパイラがチャネルの両端を
//     繋いでくれるわけではない。それを繋ぐチャネル MAP は #10 の中枢ラッパー作業の話で、
//     この Issue の範囲ではない。ハンドラ自身の戻り値の型が素直に一致する箇所は、下の型を
//     注釈して、少なくとも生成側だけはチェックが効くようにしてある。
//   * 各チャネルにつき、判別可能な union ではなく、オプショナルなメンバーを持つ「フラットな
//     形1つ」として書いてある。呼び出し側の読み方（`res.ok`、`res.posts || []`、
//     `res.error`）がそうなっているため。union にすれば同じ値をより厳密に記述できるが、
//     この Issue が触れないレンダラーの呼び出し箇所にまで絞り込みの書き換えを強いることになる。

// --- 投稿レコード -----------------------------------------------------------
// 組み立て済みの投稿レコード1件。列の一覧ではなく、意図してオープンな map にしてある:
// レコードは SELECT で組み立てられ（lib-db-query.ts の postsFromDb）、レンダラーは
// 一貫してこれをオープンなオブジェクトとして扱い（HologramPost）、派生フィールドを
// 追加する（records.ts の stampPost）。書き込み側の正本は #295 の PostRecordShape。
// 読み取り側の形を固定するのはレンダラー側の仕事であって、この境界の型付けには
// 含めない——ただしここで名前を付けておくことで、境界は「any」ではなく
// 「投稿レコードだ」と言えるようになる。
export type IpcPostRecord = Record<string, any>;

/** record-post-view: 画像ビューで表示した投稿の、加算後のローカル閲覧回数。 */
export type RecordPostViewResult = { ok: true; localViewCount: number } | { ok: false };
export type IpcPosterProfile = Record<string, any>;

/** list-posts: ライブラリ全体と、それを読んだフォルダ。 */
export interface PostsSnapshot {
  saveFolder: string | null;
  posts: IpcPostRecord[];
  profiles: IpcPosterProfile[];
}

/**
 * list-posts-delta。`full` は2種類のうちどちらのペイロードかを表す:
 * フルスナップショットは `posts` を持ち、増分更新は `added` + `removed`
 * （captureId）を持つ。
 */
export interface PostsDelta {
  saveFolder: string | null;
  full: boolean;
  posts?: IpcPostRecord[];
  added?: IpcPostRecord[];
  removed?: string[];
  profiles: IpcPosterProfile[];
}

// --- 汎用の結果 --------------------------------------------------------------
/** 多くの書き込みハンドラが返す、最小限の応答。 */
export interface OkResult {
  ok: boolean;
}

/**
 * update-tags: 応答本体に加え、書き込みが残した状態でのタグ配列（#774）。
 * レンダラーはライブラリを読み直すのではなく、読み込み済みのレコード上でタグを
 * その場編集するので、id をキーにした配列は名前だけからレンダラー側で導出できない
 * ——新しいタグにはまだ id が無いし、2つのエンティティが同じ名前を持つこともある。
 * これを返すことで、編集後も tags/tagIds/effective* が揃った状態を保ち、ファセット一覧と
 * タグの葉が、利用者が選んだエンティティと一致し続ける。無い場合（書き込み失敗、または
 * DB が開いていない）は、呼び出し元が古いコピーを保持せず破棄すべきことを意味する。
 */
export interface UpdateTagsResult extends OkResult {
  tags?: string[];
  tagIds?: number[];
  effectiveTagIds?: number[];
  effectiveTags?: string[];
  effectiveTagLabels?: string[];
}

/** 保存先フォルダの番人（validateSaveFolder）の判定。 */
export interface ValidationResult {
  ok: boolean;
  error?: string;
}

// --- 設定 / 環境設定 ---------------------------------------------------------
/** get-config——レンダラーが見てよい config.json の2つのフィールド。 */
export interface ConfigSummary {
  saveFolder: string | null;
  extensionId: string | null;
}

/**
 * get-library-status（#37）。`missing` は現在の明示的な保存フォルダに対する
 * その場の statSync であり、キャッシュしたフラグではない——レンダラーは push を
 * 待ち受けるのではなく、リトライや repoint の後にこれを尋ね直す。`path` が null に
 * なるのは明示的な保存フォルダが一切無い時だけ（新規インストール）で、その場合
 * `missing` は必ず false になる——native-host/config-recovery.mts の
 * libraryIsMissing 参照。
 */
export interface LibraryStatus {
  missing: boolean;
  path: string | null;
}

/**
 * get-extension-contact（#71）: Native Messaging ブリッジが接触マーカー
 * （native-host/paths.mts の extensionContactPath）に一度でも触れたか——つまり
 * 拡張機能がインストール済みで、check/save を最低1回は処理したか。レンダラーが
 * これを使う場面は empty/EmptyState.tsx の firstRun 分岐だけ: まだ接触が無ければ
 * 「代わりにインストール案内を出す」（services/library-status.ts の
 * libraryEmptyVariant）。get-library-status と同じ一発取得であって push では
 * ない——セッションの途中でこれを無効化するものは無いので、起動時に1回読むだけで
 * 今のところ唯一の呼び出し元には足りる。
 */
export interface ExtensionContactStatus {
  contacted: boolean;
}

/** app-info——設定の「About」パネルが表示するビルド情報。 */
export interface AppInfo {
  version: string;
  electron: string;
  chromium: string;
  node: string;
}

/**
 * get-prefs。各メンバーはハンドラが解決する（許可リスト＋フォールバック）ので、
 * ここにオプショナルなものは無い。`null` は「一度も設定されていない」を意味し、
 * レンダラーはこれを値と区別する。
 */
export interface AppPrefs {
  language: string;
  /** #618: 表示の軸は独立している——まずレイアウト、それから独立した2つのグリッド切り替え。 */
  layoutMode: string;
  squareThumbs: boolean;
  showInfo: boolean;
  /** #658: AuthorLine が投稿者のアバターを描くかどうか。 */
  showAvatar: boolean;
  skipDeleteConfirm: boolean;
  /** グリッド: 列幅 px（サイズスライダーの軸）。 */
  gridSize: number | null;
  /** 一覧: サムネイル幅 px。 */
  listThumb: number | null;
  theme: string;
  /** #137: 利用者が選んだインターフェースフォント。--font-sans の先頭に付ける。'' = 既定のスタック。 */
  uiFontFamily: string;
  browseMode: string;
  /** #630: 投稿者グリッド独自の軸——まずレイアウト、それから切り替え1つ（アバターには選べるアスペクト比が無い）。 */
  posterLayoutMode: string;
  posterShowInfo: boolean;
  /** 投稿者グリッド: 列幅 px。投稿者一覧にはサイズの軸が無い。 */
  posterGridSize: number | null;
  inspectorOpen: boolean | null;
  inspectorWidth: number | null;
  /** #245: サイドバーと詳細パネルを一度にまとめて隠す。それぞれ自身の状態とは独立。 */
  panelsHidden: boolean | null;
  /** #207: ウェブ検索ポップオーバー——「まとめて開く」の対象となるサイトの行（サイト id）、セッションをまたいで記憶する。null = 一度も設定されていない（既定は採用済み全サイト）。 */
  webSearchChecked: string[] | null;
  /** #246: ショートカット id -> カスタムのキーの組み合わせ（"Ctrl+Shift+F" 形式の文字列）。id が無ければまだ既定のまま。 */
  shortcutOverrides: Record<string, string>;
}

// --- 整理情報の層（DB 保持、ipc-organize.ts） -------------------------------
/**
 * 種別付きタグの「エンティティ」1件（#810）。`kind` は tags 行にぶら下がるので、
 * 同じ名前の2つのタグが正当に異なる kind を持てる——これはまさに旧来の
 * `Record<name, kind>` の形では表現できなかったこと（それらを1つに畳んでしまい、
 * map 全体を書き込むと畳まれて負けた方が DB から消えていた）。
 *
 * `name`/`label` は読み取り側の装飾: どの投稿も持っていない種別付きタグ
 * （ピッカーの Work/Character の節）を、語彙をもう一度取得せずにレンダラーが
 * 一覧できるようにする。`label` は #774 の表示名ルール——通常は「name」、
 * タグに表示用の親がある時は「name(displayParentName)」で、これが同名の2エンティティを
 * 見た目で区別する唯一の手がかり。書き込み側はどちらも見ない。
 */
export interface TagTypeRow {
  id: number;
  kind: string;
  name: string;
  label: string;
}

/** get/set-tag-types: 種別付きタグのエンティティ群と、改名可能な work/character のラベル。 */
export interface TagTypesState {
  types: TagTypeRow[];
  labels: Record<string, string> | null;
}

/**
 * 名前をキーにした kind の map——`tag-types.json` の交換用の形であって、IPC の
 * ペイロードではない。タグの id はライブラリローカルなので、どこか別の場所へ
 * インポートされるアーカイブの中では意味を持たない。そのため ZIP は名前をキーに
 * したままにしてあり、lib-archive.ts は DB ライターの名前ベースのアクセサ経由で
 * それを読み書きする。
 */
export interface TagTypeNamesState {
  types: Record<string, string>;
  labels: Record<string, string> | null;
}

/** get/set-ungrouped: 自動グループ化から除外された投稿キー。 */
// --- タグ語彙の層（#21、DB 保持、ipc-tag-vocab.ts） -------------------------
/** タグ管理ページの一覧テーブルの1行。 */
export interface TagVocabRow {
  id: number;
  name: string;
  kind: string | null;
  reading: string | null;
  postCount: number;
  posterCount: number;
  parents: { id: number; name: string; isDisplay: boolean }[];
  displayName: string;
  isReferencedAsParent: boolean;
  isOrphan: boolean;
}
/** (子, 親) の辺1つ、名前解決済み——「親タグ」の左側ビューを支える。 */
export interface TagParentRowResolved {
  tagId: number;
  tagName: string;
  parentTagId: number;
  parentName: string;
  isDisplay: boolean;
}
/** rename-tag の答え。新しい名前が別のタグエンティティと衝突する場合——呼び出し元は merge-tags か keep-separate-rename-tag で解決する（2026-07-18 に2分岐で確定）。 */
export interface RenameCollision {
  tagId: number;
  name: string;
  postCount: number;
  posterCount: number;
}
/** 'alias-collision'（#86）: 試みた名前が既に別のタグの別名として登録されている——先にその別名を消すか、別の名前を選ぶ。 */
export type RenameTagResult = { ok: true } | { ok: false; error: 'empty' | 'alias-collision' } | { ok: false; collision: RenameCollision };
/** タグ語彙への書き込みの単純な結果（add/remove-tag-parent、merge-tags、keep-separate-rename-tag、set-tag-kind）。 */
export interface TagWriteResult {
  ok: boolean;
  error?: string;
}
export interface DeleteOrphanTagsResult {
  ok: boolean;
  deletedIds: number[];
}
/** 分割レビューのサムネイルグリッド（get-tag-split-preview）内の投稿1件——#777。 */
export interface TagSplitPost {
  postId: string;
  thumbFile: string | null;
  /** 候補の表示用の親と共起する——「新しいエンティティへ移す」選択の初期値になる。 */
  suggestedToNew: boolean;
}
/** split-tag の答え——成功時は新しいエンティティの id。 */
export type SplitTagResult = { ok: true; newTagId: number } | { ok: false; error: string };
/** タグ管理ページの別名一覧の1行（#86）——正規のタグに解決される別表記。 */
export interface TagAliasRow {
  id: number;
  alias: string;
  tagId: number;
  canonicalName: string;
}
/** add-tag-alias の答え。'self' = 別名のテキストがそのタグ自身の現在の名前と同じ（冗長）。'name-collision' = 別のタグが既にちょうどその名前を持っている（代わりに merge-tags を使う）。'conflict' = その別名テキストが既に別のタグを指して登録されている。 */
export type AddTagAliasResult = { ok: true; id: number } | { ok: false; error: 'empty' | 'not-found' | 'self' | 'name-collision' | 'conflict' };

export interface UngroupedState {
  keys: string[];
}

/** get/set-manual-groups: 利用者が作った captureId のグループ。 */
export interface ManualGroupsState {
  groups: string[][];
}

/** 名前付きフォルダ1件。動的フォルダは保存された検索条件を持ち、アイテムは持たない。 */
export interface FolderRecord {
  id: string;
  name: string;
  kind: string;
  created: number | null;
  parentId: string | null;
  items: string[];
  tree?: unknown;
}

/** get/set-folders。`activeId` は legacy で、null に落ち着く。 */
export interface FoldersState {
  folders: FolderRecord[];
  activeId: string | null;
}

/** 投稿者フォルダ1件（投稿者ビューにおける FolderRecord のフラットな対応物）。 */
export interface PosterFolderRecord {
  id: string;
  name: string;
  items: string[];
}

export interface PosterFoldersState {
  folders: PosterFolderRecord[];
}

/**
 * 投稿者1人分のタグ（#810）。投稿レコードが既に持つのと同じ、並行配列の形
 * （同じ添字＝同じタグ）: エディタが表示し書き戻すのは名前、突き合わせに使うのは
 * id（改名しても id は変わらないし、1つの名前が2つのエンティティに属することもある）。
 *
 * effective* の3つ組は、タグの親子関係を問い合わせ時に適用する #774 の仕組みで、
 * 読み取るたびに導出し、どのテーブルにも保存しない——なので規則を削除すれば、
 * 次の読み取りですべての投稿者からその効果が消える。投稿が持つのと同じ可逆性。
 */
export interface PosterTagRow {
  tags: string[];
  tagIds: number[];
  effectiveTagIds: number[];
  effectiveTags: string[];
  effectiveTagLabels: string[];
}

/** get-poster-tags: posterKey -> その投稿者のタグエンティティ。 */
export interface PosterTagsState {
  tags: Record<string, PosterTagRow>;
}

/**
 * set-poster-tags と、`poster-tags.json` の交換用の形: posterKey -> タグの名前。
 * 書き込み側が名前のままなのは投稿のタグと同じ理由——今しがた入力したタグには、
 * 書き込みが作成するまで id が無い——アーカイブが名前のままなのも tag-types.json と
 * 同じ理由（id はライブラリローカル）。
 */
export interface PosterTagNamesState {
  tags: Record<string, string[]>;
}

// --- 投稿者の別名（#23 St1） --------------------------------------------------
/** 名寄せグループ1件。`primary` はすべての読み手が畳み込む先の正規キー
 *  （facets/predicates/buildUsers）。`members` は `primary` 自身を含む。 */
export interface PosterAliasGroupRecord {
  id: string;
  primary: string;
  members: string[];
}

/** get/set-poster-aliases。 */
export interface PosterAliasesState {
  groups: PosterAliasGroupRecord[];
}

// --- タブ ------------------------------------------------------------------
/**
 * 永続化されたタブ1件。境界を越えるのはちょうどこの4つのフィールド: DB が列として
 * 索引する3つに加え、`state`——main がそのまま保存し中身を一切読まない不透明な
 * blob。この blob の形はレンダラーが所有する（services/tab-state.ts の
 * HologramTabPersist: クエリのスナップショット、ナビゲーションスタック、
 * スクロール位置）ので、スキーマ変更なしにフィールドを増やせる。`state` の隣に
 * 送られてくるものは何であれ DB へ向かう途中で捨てられる（#565）。
 */
export interface TabRecord {
  id: string;
  pinned: boolean;
  title: string | null;
  state: unknown;
}

/** get-tabs は、ライブラリがタブ列を一度も永続化していなければ null を返す。 */
export interface TabsState {
  tabs: TabRecord[];
  activeTabId: string | null;
}

// --- 全体の履歴（#145、ipc-history.ts） --------------------------------------
/** 履歴テーブルの1行。`state` は #144 のナビゲーションエントリが持つ、種別ごとの復元状態そのまま。 */
export interface HistoryRow {
  id: number;
  ts: number;
  u: string;
  kind: string;
  title: string;
  state: unknown;
}

/** query-history の次ページ用カーソル——最後の行の (ts, id) キーセットの組。 */
export interface HistoryCursor {
  ts: number;
  id: number;
}

export interface HistoryQueryOptions {
  search?: string;
  before?: HistoryCursor | null;
}

export interface HistoryQueryResult {
  rows: HistoryRow[];
  hasMore: boolean;
}

// --- 手動エクスポートの通知とローカル復旧（ipc-backup.ts） --------------------
export interface ExportReminderState {
  enabled: boolean;
  changesSinceExport: number;
  lastExportAt: string | null;
  threshold: number;
  due: boolean;
}

/** DB 世代ストアのエントリ1件。復元一覧に表示される形（#233）。 */
export interface DbGeneration {
  name: string;
  /** ファイル名からデコードした ISO の時刻（ストアはローカル時刻で命名する）。 */
  at: string;
  size: number;
}

/**
 * rollback-db-generation の答え。`stash` は、後に残された状態を自動でスナップショットした
 * ものの名前。`reregistered` は、その世代より後にできた投稿で、世代の方が古いために
 * 引き継がれた件数を数える（#233）。
 */
export interface DbRollbackResult {
  ok: boolean;
  error?: string;
  generation?: string;
  stash?: string;
  reregistered?: number;
}

/**
 * get-integrity-status、および push される `integrity-check-done` イベントの
 * ペイロード（#383）。`dbOk: null` = 一度もチェックしていない。
 */
export interface IntegrityStatus {
  lastCheckAt: string | null;
  dbOk: boolean | null;
  orphanCount: number;
  missingCount: number;
}

/** run-orphan-recovery。`adopted` = 孤児ファイル自身の sidecar から復旧したもの。 */
export interface OrphanRecoveryResult {
  ok: boolean;
  error?: string;
  recovered?: number;
  adopted?: number;
}

// --- Transfer: 消去 / エクスポート / インポート / 移動（ipc-transfer.ts） -------
/** clear-all。`blocked` は、消去が拒まれた設定劣化の理由を名指しする。 */
export interface ClearAllResult {
  ok: boolean;
  count: number;
  blocked?: string | null;
}

/** export-save（レンダラーが渡したバイト列を、選ばれたパスへ）。 */
export interface ExportSaveResult {
  saved: boolean;
  path?: string;
  error?: string;
}

/** export-complete。`empty:true` = エクスポートするものが無く、ダイアログは出さなかった。 */
export interface ExportCompleteResult {
  saved: boolean;
  path?: string;
  fileCount?: number;
  empty?: boolean;
  error?: string;
}

/**
 * import-complete。`legacy:true` + `path` は、アーカイブが #300 より前の
 * エクスポート形式であることを意味する: main がパスを選び、レンダラーは重複の
 * 質問をした後（#34）import-legacy-zip 経由で仕上げる。
 */
export interface CompleteImportResult {
  ok: boolean;
  canceled?: boolean;
  legacy?: boolean;
  path?: string;
  error?: string;
  imported?: number;
  skipped?: number;
  notComplete?: boolean;
}

/**
 * import-legacy-zip。mode 無しで呼ぶと、取り込む代わりに重複件数付きの
 * `needsChoice` を返すことがある（#34）。答えを添えてもう一度呼ぶ。
 */
export interface LegacyImportResult {
  ok: boolean;
  error?: string;
  imported: number;
  skipped: number;
  needsChoice?: boolean;
  duplicates?: number;
  total?: number;
}

/** import-images（利用者自身のローカルファイル）。 */
export interface MediaImportResult {
  imported: number;
  skipped: number;
  error?: string;
  canceled?: boolean;
}

/** ウィンドウドロップの入り口の再帰的な走査（#234）が解決したファイル1件——
 * collect-dropped-paths の一覧で、import-dropped-paths へ変更せず送り返すことで
 * インポートが再走査しないようにする。 */
export interface DroppedFile {
  path: string;
  ext: string;
}

/** collect-dropped-paths——事前の件数。まだ何も書き込まれていない。 */
export interface DropCollectResult {
  files: DroppedFile[];
  mediaCount: number;
  error?: string;
}

/** import-dropped-paths——確定した書き込み。MediaImportResult から `canceled` を
 * 除いた形（ここにはキャンセルするダイアログが無い）。 */
export interface DropImportResult {
  imported: number;
  skipped: number;
  error?: string;
}

/**
 * import-clipboard（#85）。`empty:true` = クリップボードに画像が無かった。これは
 * 通常の結果であり（利用者がテキストの入ったクリップボードで Ctrl+V した）、
 * 意図して `error` としては報告しない——レンダラーは失敗としてではなく、ただの
 * トーストで応じる。
 */
export interface ClipboardImportResult {
  imported: number;
  empty?: boolean;
  error?: string;
}

/**
 * pick-repoint-folder（#37）: repoint の移動先を、何も書き込まずに決定・検証する
 * ——実際の書き込みは apply-repoint が行い、pick-save-folder/move-save-folder の
 * 二段階の形を踏襲する。`hasEvidence` は、そのフォルダが既存の Hologram
 * ライブラリらしく見えるかどうかを表す（.trash か .hologram-inbox の
 * サブフォルダ、またはライブラリのメディアファイルが直下にある）。レンダラーは
 * 何の形跡も無いフォルダへ repoint する前に、利用者へ確認する。
 */
export interface RepointPickResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  dest?: string;
  hasEvidence?: boolean;
}

/**
 * apply-repoint（#37。#176 の switchLibrary で一般化された）: `dest` を現在の
 * ライブラリとして開く——データベースが保存フォルダの外にあった頃のコピー無しの
 * ポインタ切り替えは、データベースがその内側にある今（#176）はもう全体像ではなく、
 * ここでは旧データベースを閉じ、`dest` の側を開く（または作成する、あるいは
 * スナップショットから復元する）。`error: 'busy'` は切り替えが既に進行中だったことを
 * 意味し、`'open-failed'` は新しい場所のデータベース自体が開けなかったことを
 * 意味する（自動的に元のライブラリへロールバックされる）。
 */
export interface RepointApplyResult {
  ok: boolean;
  error?: string;
  saveFolder?: string;
}

/**
 * pick-library-folder（#176）: 設定の「ライブラリ」節の 切り替え/新規作成 フロー用に、
 * 何も開かずに移動先を決定・検証する——実際の切り替えは switch-library が行う。
 * レンダラーが `classification` の求める確認（'has-db' なら無し、'empty' なら
 * 「新しいライブラリを始めますか？」、'evidence-no-db' なら「復元ポイント／取込キューから
 * 復旧しますか？」）を表示した後に呼ぶ。'reject' に分類されるフォルダはここで
 * 明確に拒む（`ok:false, error:'not-a-library'`）——確認として表に出すことは無い。
 */
export interface PickLibraryFolderResult {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  dest?: string;
  classification?: 'has-db' | 'empty' | 'evidence-no-db';
}

/** switch-library（#176）: 既に確認済みの switchLibrary(dest) 呼び出しの結果。 */
export interface SwitchLibraryResult {
  ok: boolean;
  error?: string;
  saveFolder?: string;
}

/** get-recent-libraries（#176）——新しい順。`exists` はその場の statSync で、キャッシュではない。 */
export interface RecentLibraryEntry {
  path: string;
  lastOpenedAt: string | null;
  exists: boolean;
}

/** move-save-folder——移動処理そのものの結果。 */
export interface SaveFolderMoveResult {
  ok: boolean;
  error?: string;
  name?: string;
  saveFolder?: string;
  moved?: number;
  leftover?: number;
}

/**
 * pick-save-folder: 移動の結果、キャンセルされたダイアログ、または利用者が
 * 先に警告を受け入れる必要がある移動先（`confirm` + `dest`、#95）のいずれか。
 */
export interface SaveFolderPickResult extends SaveFolderMoveResult {
  canceled?: boolean;
  confirm?: string;
  provider?: string;
  dest?: string;
}

/** push される `save-folder-progress` イベント。移動の各段階ごとに1回。 */
export interface SaveFolderProgress {
  phase: string;
  done?: number;
  total?: number;
  percent?: number;
  moved?: number;
  leftover?: number;
  left?: number;
  error?: string;
}

/** push される `export-progress` イベント: 実行中はカウンタ、最後に `done:true`。 */
export interface ExportProgress {
  written?: number;
  total?: number;
  pct?: number;
  done?: boolean;
}

/**
 * search-full-text（#29）: posts_fts の MATCH 結果の1行。`postId` は実際には
 * 投稿の captureId（FTS テーブルの UNINDEXED 列の名前が postId——lib-db-schema.ts
 * 参照）、`rank` は SQLite の bm25() スコア（より負の値ほど関連度が高いので、
 * 呼び出し元は昇順にソートする）。どの投稿がマッチするかはレンダラーが決める
 * （services/fulltext.ts が、クイック検索と同じタブ内マッチャーを、posts_fts が
 * まだ索引していない欄も含むあらゆる欄に対して走らせる——#288 の ALT 列の宿題）。
 * このチャネルが供給するのは関連度の「順序」のみで、それもレンダラー側のヒットと
 * 重なる範囲について。
 */
export interface FullTextHit {
  postId: string;
  rank: number;
}

/**
 * ピン留め（浮動ミニビューア）ウィンドウの集合中のタイル1件（#79）。`captureId` は
 * ベストエフォートの識別子（持ち主の投稿のもの、または単一の正確なレコードを
 * 名指しできない時は元のタブのもの——たとえばツールバーの「画面に映っているものを
 * ピン留め」の入り口）で、重複追加時に既にピン留め済みのタイルをハイライトする
 * ためだけに使う。タイル自体は `file` をキーにし、これはライブラリ内で一意。
 * ウィンドウローカルな状態のみ——ここにあるものが投稿レコードへ書き戻されることは
 * 一切無い。
 */
export interface PinItem {
  captureId: string;
  file: string;
  video: boolean;
}
