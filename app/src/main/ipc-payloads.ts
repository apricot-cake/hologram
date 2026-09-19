import type { z } from 'zod';
import type { TagVocabRowSchema } from '../shared/data-schemas.ts';
('use strict');

// IPC の返却データ型。入力と共用するデータ型は shared/data-schemas.ts から再公開する。
// チャネルごとの戻り値は shared/ipc-results.ts に定義し、main と preload の両端で検査する。

// --- 投稿レコード -----------------------------------------------------------
export type IpcPostRecord = import('../shared/post-view-schemas.ts').PostView;

/** record-post-view: 画像ビューで表示した投稿の、加算後のローカル閲覧回数。 */
export type RecordPostViewResult = { ok: true; localViewCount: number } | { ok: false };
export type IpcPosterProfile = import('../shared/post-view-schemas.ts').PosterView;

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
export type { AppPrefs } from '../shared/data-schemas.ts';

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
export type { TagGroupMember } from '../shared/data-schemas.ts';

export type { TagGroupsState } from '../shared/data-schemas.ts';

export type { TagGroupNamesState } from '../shared/data-schemas.ts';

/** get/set-ungrouped: 自動グループ化から除外された投稿キー。 */
// --- タグ語彙の層（#21、DB 保持、ipc-tag-vocab.ts） -------------------------
/** タグ管理ページの一覧テーブルの1行。 */
export type TagVocabRow = z.output<typeof TagVocabRowSchema>;

/** rename-tag の答え。新しい名前が別のタグエンティティと衝突する場合——呼び出し元は merge-tags か keep-separate-rename-tag で解決する（2026-07-18 に2分岐で確定）。 */
export interface RenameCollision {
  tagId: number;
  name: string;
  postCount: number;
  posterCount: number;
}
export type RenameTagResult = { ok: true } | { ok: false; error: 'empty' } | { ok: false; collision: RenameCollision };
/** タグ語彙への書き込みの単純な結果（merge-tags、set-tag-group）。 */
export interface TagWriteResult {
  ok: boolean;
  error?: string;
}
export interface DeleteTagsResult {
  ok: boolean;
  deletedIds: number[];
}

export type { UngroupedState } from '../shared/data-schemas.ts';

/** get/set-manual-groups: 利用者が作った captureId のグループ。 */
export type { ManualGroupsState } from '../shared/data-schemas.ts';

/** 名前付きフォルダ1件。動的フォルダは保存された検索条件を持ち、アイテムは持たない。 */
export type { FolderRecord } from '../shared/data-schemas.ts';

/** get/set-folders。`activeId` は legacy で、null に落ち着く。 */
export type { FoldersState } from '../shared/data-schemas.ts';

/** 投稿者フォルダ1件（投稿者ビューにおける FolderRecord のフラットな対応物）。 */
export type { PosterFolderRecord } from '../shared/data-schemas.ts';

export type { PosterFoldersState } from '../shared/data-schemas.ts';

/**
 * 投稿者1人分のタグ（#810）。投稿レコードが既に持つのと同じ、並行配列の形
 * （同じ添字＝同じタグ）: エディタが表示し書き戻すのは名前、突き合わせに使うのは
 * id（改名しても id は変わらないし、1つの名前が2つのエンティティに属することもある）。
 *
 * effective* の3つ組は、タグの親子関係を問い合わせ時に適用する #774 の仕組みで、
 * 読み取るたびに導出し、どのテーブルにも保存しない——なので規則を削除すれば、
 * 次の読み取りですべての投稿者からその効果が消える。投稿が持つのと同じ可逆性。
 */
export type { PosterTagRow } from '../shared/data-schemas.ts';

/** get-poster-tags: posterKey -> その投稿者のタグエンティティ。 */
export type { PosterTagsState } from '../shared/data-schemas.ts';

/**
 * set-poster-tags と、`poster-tags.json` の交換用の形: posterKey -> タグの名前。
 * 書き込み側が名前のままなのは投稿のタグと同じ理由——今しがた入力したタグには、
 * 書き込みが作成するまで id が無い——アーカイブが名前のままなのも tag-groups.json と
 * 同じ理由（id はライブラリローカル）。
 */
export type { PosterTagNamesState } from '../shared/data-schemas.ts';

// --- タブ ------------------------------------------------------------------
/**
 * 永続化されたタブ1件。境界を越えるのはちょうどこの4つのフィールド: DB が列として
 * 索引する3つに加え、`state`——main がそのまま保存し中身を一切読まない不透明な
 * blob。この blob の形はレンダラーが所有する（services/tab-state.ts の
 * HologramTabPersist: クエリのスナップショット、ナビゲーションスタック、
 * スクロール位置）ので、スキーマ変更なしにフィールドを増やせる。`state` の隣に
 * 送られてくるものは何であれ DB へ向かう途中で捨てられる（#565）。
 */
export type { TabRecord } from '../shared/data-schemas.ts';

/** get-tabs は、ライブラリがタブ列を一度も永続化していなければ null を返す。 */
export type { TabsState } from '../shared/data-schemas.ts';

// --- 全体の履歴（#145、ipc-history.ts） --------------------------------------
/** 履歴テーブルの1行。`state` は #144 のナビゲーションエントリが持つ、種別ごとの復元状態そのまま。 */
export type { HistoryRow } from '../shared/data-schemas.ts';

/** query-history の次ページ用カーソル——最後の行の (ts, id) キーセットの組。 */
export type { HistoryCursor } from '../shared/data-schemas.ts';

export type { HistoryQueryOptions } from '../shared/data-schemas.ts';

export type { HistoryQueryResult } from '../shared/data-schemas.ts';

// --- 手動エクスポートの通知とローカル復旧（ipc-backup.ts） --------------------
export interface ExportReminderState {
  enabled: boolean;
  changesSinceExport: number;
  lastExportAt: string | null;
  threshold: number;
  due: boolean;
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

/** 完全バックアップZIPの取り込み結果。 */
export interface CompleteImportResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
  imported?: number;
  skipped?: number;
  notComplete?: boolean;
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
 * apply-repoint（#37）: `dest` を復旧した保存先として
 * 開く——データベースが保存フォルダの内側にあるため、
 * ここでは旧データベースを閉じ、`dest` の側を開く（または作成する、あるいは
 * スナップショットから復元する）。`error: 'busy'` は復旧が既に進行中だったことを
 * 意味し、`'open-failed'` は新しい場所のデータベース自体が開けなかったことを
 * 意味する（自動的に元のライブラリへロールバックされる）。
 */
export interface RepointApplyResult {
  ok: boolean;
  error?: string;
  saveFolder?: string;
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

/** 検索エンジンが返す一致箇所と関連度順。 */
export interface FullTextHit {
  field?: string;
  snippetText?: string;
  matchStart?: number;
  matchEnd?: number;
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
