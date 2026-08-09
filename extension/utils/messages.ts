// content script（capture.ts、および常駐 content script の drag.ts +
// overlay.ts）と background の service worker（background.ts）の間でや
// り取りする実行時のメッセージ。方向ごとに1つの判別可能なユニオンを持
// ち、`type` をキーにする。だから `message.type` で絞り込むハンドラ
// は、残りのペイロードの型を無料で手に入れる＝欄の改名は今やすべての
// 呼び出し箇所で実行時に静かに失敗するのではなく、コンパイルエラーと
// して現れる（#225）。
//
// 3つ目の境界（拡張機能 ⟷ native messaging host）はここでは定義しな
// い: #400 以降、両側が import する1つの共有宣言、
// native-host/protocol.mts がそれを持つ。このファイルが今も行っている
// のは、そのうち content⟷background の応答へそのまま流れていく部分
// （BridgeAck、SavedEntry）を re-export することだ。これによって
// content script は、host がそれを書いたのと同じ型で host の答えを読
// める。
import type { HostAckView, ProtocolSkew, SavedEntry, SavedResults, TrashedEntry, TrashedResults } from '../../native-host/protocol.mts';
import type { CropRect } from './crop.ts';
import type { DomMeta } from './extractor/types.ts';
import type { WebMetaResult } from './extractor/web-meta.ts';
import type { SaveFailureKind } from './native-error.ts';
import type { SaveLogEntry, SaveStage } from './capture-log.ts';
import type { SaveQueueStats } from './save-queue.ts';

// === content script -> background ===

// すべての保存要求は、ページが発行した saveId（この試みの capture.log
// の行をまとめるもの、#519。capture-log.ts を参照）を運ぶ。3つの経路
// すべてで任意ではなく必須にしてある: これを忘れる経路があれば、その保
// 存を、この id が終わらせようとしていた診断不能な状態に逆戻りさせて
// しまう。
interface CaptureAndSendMessage {
  type: 'captureAndSend';
  rect: CropRect;
  postUrl: string;
  platform: string;
  saveId: string;
  // 重複警告に「replace」と答えたとき（#34）、この保存が置き換えるレ
  // コードの captureId。通常の保存では null/未設定。
  replaces?: string | null;
  // この投稿についてページが表示していたもので、選ばれた瞬間に投稿要
  // 素から読み取る（#202）。これが要求に乗るのは、これが要素を持つ唯
  // 一の側だからだ: service worker が持つのはパーマリンクと crop の矩
  // 形だけで、API が何も答えなかったと分かる頃には、タブは投稿をスク
  // ロールで見失っているか遷移しているかもしれない。まだ抽出ルールが
  // ないサイトと、空で返ってきた読み取りでは未設定。
  domMeta?: DomMeta | null;
}

interface SavePostMessage {
  type: 'savePost';
  postUrl: string;
  platform: string;
  saveId: string;
  capturedVia?: string | null;
}

interface ImageDraggedMessage {
  type: 'imageDragged';
  platform: string;
  postUrl: string;
  imageUrls: string[];
  saveId: string;
  replaces?: string | null; // CaptureAndSendMessage を参照
}

interface CheckSavedMessage {
  type: 'checkSaved';
  urls: string[];
}

// 「この投稿の保存は、すでにライブラリにある何かの再保存か」（#34）。
// checkSaved と同じ索引を読むにもかかわらず、意図して別の問いにしてあ
// る: checkSaved はビューポート全体の投稿について URL ごとに答える
// が、こちらは1つの投稿に答え、その画像についても比較する。
interface CheckDuplicateMessage {
  type: 'checkDuplicate';
  platform: string;
  url: string;
  // これから保存する画像についてページ自身が持つ URL。サイトが画像アイ
  // デンティティのルールを持たなければ空＝その場合チェックは投稿 URL
  // だけに頼る。
  imageUrls: string[];
}

// capture.log の1行を、ほぼそのまま native host（または、それが叶わな
// ければローカルのフォールバック用リングバッファ）へ中継する。
// stage/phase の語彙と段階ごとのペイロードは capture-log.ts にある。
type LogEntry = SaveLogEntry;

interface LogCaptureMessage {
  type: 'logCapture';
  entry: LogEntry;
}

interface DumpLogsMessage {
  type: 'dumpLogs';
}

// diag.ts は副作用なしに再試行キューの棚卸し（#203）を読む＝下の
// ResendQueueMessage とは分けてあり、ページの初回読み込みそれ自体が
// connectNative の試行を引き起こすことはない。
interface QueueStatsMessage {
  type: 'queueStats';
}

// 診断ページの「今すぐ再送」ボタン: 今すぐ再試行キューの掃除を1回実行
// し、再送が残す統計で答える（#203）。
interface ResendQueueMessage {
  type: 'resendQueue';
}

// #239: ページ側のメタデータ抽出スクリプトがタブ自身の DOM から読み
// 取ったもの（schema.org の JSON-LD/microdata/RDFa、OGP、Dublin
// Core、Highwire）。extension/entrypoints/read-meta.ts が動いた瞬間
// に、求められてもいないのに1回だけ送る＝そのスクリプトは `files:`
// で注入され、`func:` では絶対に注入されない（#759 のシリアライズの
// 罠: `func` はモジュールのスコープを失い、このモジュールはサードパー
// ティのパーサーをバンドルしている）。そのため結果は、これが置き換え
// たかつての OGP 専用の読み取りがそうしていたような executeScript()
// の戻り値としては返せない。doSaveBookmark（background.ts）は
// sender.tab.id でこれを自分の要求に対応付ける＝1つのタブにつき進行
// 中の読み取りは常に1つだけなので、別途相関 id は要らない。
interface PageMetaExtractedMessage {
  type: 'pageMetaExtracted';
  result: WebMetaResult;
}

// ツールバーポップアップの保存ボタン（#124）。action にポップアップを
// 付けると chrome.action.onClicked は二度と発火しなくなるので、このメッ
// セージがそれの代わりになる: ポップアップが尋ね、worker がアクティブ
// なタブを見つけて、キーボードショートカットが実行するのとまったく同
// じ activation を実行する。
//
// `auto` は2番目の操作を発明するのではなく、2つのコマンド（Alt+S /
// Alt+Shift+S）を鏡写しにしたものだ＝これは同じ activation の一括取り
// 込みモード（#362）で、#793 がそれを求めるポップアップの項目を追加す
// る。
interface PopupActivateMessage {
  type: 'popupActivate';
  auto?: boolean;
}

// ポップアップの「この一覧を取り込む」項目（#793）の無効化状態チェッ
// ク:「アクティブなタブに、このモードが辿れる一覧はあるか」。
// PopupActivateMessage とは分けてある。これは尋ねるだけで注入は一切し
// ないからだ＝パネルは activeTab が問題になるより前、開いた時点でこれ
// を送る。
interface PopupCheckBulkMessage {
  type: 'popupCheckBulk';
}

type ContentToBackgroundMessage = CaptureAndSendMessage | SavePostMessage | ImageDraggedMessage | CheckSavedMessage | CheckDuplicateMessage | LogCaptureMessage | DumpLogsMessage | QueueStatsMessage | ResendQueueMessage | PageMetaExtractedMessage | PopupActivateMessage | PopupCheckBulkMessage;

// === background -> content script ===

interface CropImageMessage {
  type: 'cropImage';
  dataUrl: string;
  rect: CropRect;
}

// 成功したキャプチャは常に meta/grouped の欄を持ち、失敗したものは代
// わりに常に errorKind を持つ＝`success` で分けているので、読み手
// （capture.ts の onRuntimeMessage）は正しい欄を、単に任意ではなく確
// 実に存在するものとして型付きで受け取れる。保存自身の結果に加えて、
// この保存とはまったく関係のないものも1つ運ぶ: hostSkew は、拡張機能
// と native host が共有する契約の異なるバージョンからビルドされている
// こと（#205）を言う。これは出来事ではなくインストールの継続的な状態
// だ。これを成功時に報告するのは、skew が保存を止めるものではないから
// だ＝レコードはディスクにあり、この注記は次の保存についてのものだ。
// #124 以降、これを読む定位置はツールバーのポップアップになったので、
// この運び手はブラウザのセッションにつき1回しか発火しない
// （background.ts の skewNoteForBanner）＝ポップアップを一度も開かな
// い人にも、すべての保存のたびに言うことなく伝わるのに十分な頻度だ。
interface NotifySuccessMessage {
  type: 'notify';
  success: true;
  metaOk: boolean;
  metaReason: string | null;
  grouped: number;
  // 'host-old' = デスクトップアプリを更新せよ、'host-new' = 拡張機能を
  // 更新せよ。null/未設定 = 両側が一致している、またはまだどの host も
  // 応答していない。
  hostSkew?: ProtocolSkew | null;
  // どのレコードの欄が、プラットフォーム API ではなくページが表示して
  // いたもので埋まったか（#202）。バナーの文言のためだけに読む＝一部
  // 欠けた保存は一部欠けたままで、2つの情報源は同じ品質ではなく、それ
  // を隠さないことこそが琥珀色の状態が存在する理由だ。API が完全に答え
  // たすべての保存では空/未設定。
  domFilled?: string[];
}

interface NotifyFailureMessage {
  type: 'notify';
  success: false;
  errorKind?: SaveFailureKind;
  // ErrorResponse の `queued` を参照＝これは captureAndSend 経路自身が
  // 同じ事実を運ぶもの（#203）で、この経路の結果は sendResponse では
  // なくこのメッセージでタブへ伝わるからだ。
  queued?: boolean;
}

type NotifyMessage = NotifySuccessMessage | NotifyFailureMessage;

interface SavedUpdateMessage {
  type: 'savedUpdate';
  url: string;
  media: Array<string | null>;
}

// この保存がどこまで進んだか。各段階が完了するたびに push される
// （#519）。届いた時点ではログに残さない＝その唯一の仕事は覚えられる
// ことだ。そうすればその後 service worker が消えたとき、ページが「何
// も返ってこなかった」ときに書く行が、worker がどの段階にいたかを名指
// しできる。これがないと、メタデータ取得中に殺された worker も、crop
// の往復中に殺された worker も、host で殺された worker も同じ痕跡しか
// 残さない。これこそが、#507 の調査でどの区間が止まったのか言えなく
// していた曖昧さそのものだ。
interface SaveProgressMessage {
  type: 'saveProgress';
  saveId: string;
  reached: SaveStage[];
}

// background が常駐 content script へ尋ねる（#793）: このページは、
// 今アクティブな extractor のサイトが今すぐ一括で辿れると言っている
// ページか？ startCapture の auto 分岐がすでにチェックしているのと同
// じ site.isBulkCapturePage()（extractor/types.ts）で答える＝後で
// #790 が追加するサイトは、ここにも background.ts にも変更を必要とせ
// ず、自分の extractor モジュールだけで済む。
interface CheckBulkCapturePageMessage {
  type: 'checkBulkCapturePage';
}

type BackgroundToContentMessage = CropImageMessage | NotifyMessage | SavedUpdateMessage | SaveProgressMessage | CheckBulkCapturePageMessage;

// === responses ===

interface ErrorResponse {
  ok: false;
  error?: string;
  errorKind?: SaveFailureKind;
  // errorKind が 'post-unavailable' のときだけセットする: 投稿情報が
  // 取得できなかった理由（'ageRestricted' | 'protected' |
  // 'unavailable' | 'fetchFailed'）。これによってバナーは種別ではなく
  // 原因を名指しできる（#505）。それ以外のすべての失敗（こちら側の配
  // 管についてのもの）では未設定。
  metaReason?: string | null;
  // #203: この失敗した 'save'/'saveDragged' が再試行キュー
  // （save-queue.ts）に退避されたか＝再送を待って保管庫に入っていれば
  // true、host に届かなかったが何も保持できなかった場合（degrade して
  // もなお予算超過、または書き込み自体が失敗）は false、到達不能
  // チェックにそもそも到達しなかった失敗（busy、'savePost' の経路、
  // host が実際に答えを返した場合）では未設定。バナーの文言
  // （i18n.ts の saveFailureText）はこれを読んで、自動再送を約束して
  // よいか決める。
  queued?: boolean;
}

// captureAndSend の結果は別の {type:'notify'} メッセージ（NotifyMessage
// を参照）でタブへ運ばれる＝sendResponse のコールバックは要求が受理さ
// れたと言うだけでよく、capture.ts はそれを読まない。
type CaptureAndSendResponse = { ok: true } | ErrorResponse;

// native host の ack が完了した保存について運ぶものを、読み手が前提と
// してよい形として: native-host/protocol.mts の HostAckView では、す
// べての欄が任意になっている。両側が別々の経路（Chrome Web Store 対
// アプリ自身のアップデータ）で更新するため、ack は読んでいる拡張機能
// より古い host からも新しい host からも届きうるからだ。
type BridgeAck = HostAckView;

type SaveResponse =
  | (BridgeAck & {
      ok: true;
      metaOk: boolean;
      metaReason: string | null;
      grouped: number;
      // NotifySuccessMessage を参照＝drag/hover の経路は notify を通さ
      // ずここで答えるので、この注記は両方を通らなければならない。
      hostSkew?: ProtocolSkew | null;
    })
  | ErrorResponse;

// SavedEntry / SavedResults（host が1つのパーマリンクについて言うこ
// と＝それを保持するレコードの captureId と、その画像のどれがライブラ
// リにあるか、#334）は host 側の宣言で、上で import して下で
// re-export している。content script までそのまま流れていくからだ。

type CheckSavedResponse = { ok: true; results: SavedResults } | { ok: false; error?: string; results: SavedResults };

// ok:false = その問いに答えられなかった（パーマリンクがない、host に
// 届かない）。呼び出し元はそれでも保存する＝fail-open については
// duplicate-guard.ts を参照。
//
// `duplicate` と `trashed` は互いに排他で、どちらも任意: 投稿はライブ
// ラリにある（duplicate）か、そのゴミ箱にある（trashed、#158）か、ど
// ちらでもないかのいずれかだ。`trashed` を `duplicate` の3番目の値に
// せず別の欄にしているのは、この2つが異なる問いにつながるからだ＝生
// きた重複は置き換えられるが、ゴミ箱行きのものには置き換える生きたレ
// コードがない。
type CheckDuplicateResponse = { ok: true; duplicate: boolean; captureId?: string | null; trashed?: TrashedEntry | null } | { ok: false };

interface LogCaptureResponse {
  ok: true;
}

interface DumpLogsResponse {
  ok: true;
  entries: unknown[];
}

// #203: 再試行キューの棚卸し。save-queue.ts の saveQueueStats が読む
// もので、読み取り専用の問い合わせと「再送してから報告する」往復の両
// 方で形を共有している＝この2つの違いは、先に掃除が走ったかどうかだ
// けだから。
interface QueueStatsResponse {
  ok: true;
  stats: SaveQueueStats;
}

interface ResendQueueResponse {
  ok: true;
  stats: SaveQueueStats;
}

// なぜポップアップの押下が保存を始めなかったか（#124）。以前はツール
// バーのアイコンにはこれを言う場所がなかった＝注入できなかったクリッ
// クは無反応で、痕跡を少しでも残すには #269 がバッジを描かなければな
// らなかった。ポップアップはすでに開いていてユーザーが見ている画面な
// ので、こっそり別のページを開くのではなく、理由を自分で言い、それを
// 直すページを提示する。
//
//   'no-tab'             — 対象にできるアクティブなタブがない（直すもの
//                          がない）
//   'not-http'           — タブが chrome://、ファイル、Web Store 自身
//                          のページ: そこには誰も何も注入できない
//   'page-refused'       — 拡張機能は健全で、このページが拒否した
//   'package-unreadable' — 拡張機能が自分自身のファイルを読めない
type PopupActivateReason = 'no-tab' | 'not-http' | 'page-refused' | 'package-unreadable';

type PopupActivateResponse = { ok: true } | { ok: false; reason: PopupActivateReason };

// #793: 一括インポートの項目を押せるか。専用の理由の語彙は持たない＝
// どの「いいえ」（タブなし、http ではない、このタブに常駐スクリプト
// がない、サイト自身の isBulkCapturePage が「いいえ」と言った）もパネ
// ルにとっては同じに読める: 項目は無効のままで、1行の文言も
// PopupActivateReason のように項目化せず汎用的なものにする。
type PopupCheckBulkResponse = { supported: boolean };

type CropImageResponse = { croppedDataUrl: string } | null;

export type {
  BackgroundToContentMessage,
  BridgeAck,
  CaptureAndSendMessage,
  CaptureAndSendResponse,
  CheckBulkCapturePageMessage,
  CheckDuplicateMessage,
  CheckDuplicateResponse,
  CheckSavedMessage,
  CheckSavedResponse,
  ContentToBackgroundMessage,
  CropImageMessage,
  CropImageResponse,
  DumpLogsMessage,
  DumpLogsResponse,
  ImageDraggedMessage,
  LogCaptureMessage,
  LogCaptureResponse,
  LogEntry,
  NotifyFailureMessage,
  NotifyMessage,
  NotifySuccessMessage,
  PageMetaExtractedMessage,
  PopupActivateMessage,
  PopupActivateReason,
  PopupActivateResponse,
  PopupCheckBulkMessage,
  PopupCheckBulkResponse,
  ProtocolSkew,
  QueueStatsMessage,
  QueueStatsResponse,
  ResendQueueMessage,
  ResendQueueResponse,
  SavedEntry,
  SavedResults,
  SavedUpdateMessage,
  SavePostMessage,
  SaveProgressMessage,
  SaveResponse,
  TrashedEntry,
  TrashedResults,
};
