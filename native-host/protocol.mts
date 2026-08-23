// Chrome 拡張機能の service worker と、このディレクトリのブリッジとの間の
// Native Messaging の取り決め（#400）。すべての要求、すべての応答、capture id の規則、
// request id の規則、プロトコルバージョンを1か所で定義し、両側が import する。
//
// これ以前は、同じ6つのメッセージを両側がそれぞれの言い方で書いていた。拡張機能は
// `bridgeSend({ type:'save', … })` のオブジェクトリテラルで、ホストは
// `handleSave(msg: any)` で。だから欄の改名、必須の欄の追加、応答の変更は、ユーザーの
// マシンで保存が失敗して初めて分かった。今は拡張機能が `HostRequest` を組み立て、
// ホストは `parseHostRequest` が返すものを受け取る。この2つは同じ宣言だ。
//
// なぜ「中立な」場所ではなく native-host/ にあるのか
// native-host/ は独立した成果物だ。electron-builder はこのディレクトリを生の
// extraResource としてパッケージ済みアプリへ複写する。app/ も node_modules も付かない。
// そして Chrome が起動するブリッジは、これらのソースからビルドした1本のバンドル
// ファイルだ。app/src/** の下に置いた共有モジュールは、それを読まなければならない当の
// 成果物から欠ける。このディレクトリには既に、境界をまたいで他の層が import する
// モジュールが入っている。post-key.mts（レンダラーが再 export する）、post-record.mts と
// inbox.mts（メインプロセスが import する）。このファイルは同じ役割を逆向きに果たす。
// 拡張機能がこれを import し、WXT と Vite がビルド時に拡張機能のバンドルへ埋め込むので、
// 出荷される拡張機能はこのディレクトリへの実行時の依存を持たない。
//
// ブラウザで動くことを必ず保て。ここでブラウザのバンドルに入る唯一のモジュールなので、
// node の組み込みモジュールと、そこへ届く値の import を一切含めてはいけない。下の2つの
// import が type-only なのは意図してそうしている。post-record.mts は raw-payload.mts 経由で
// node:zlib を引き込むので、どちらかを値として import すれば service worker にそれを
// 引きずり込む。
//
// #205（プロトコルバージョンの取り決め）が持つのは、番号と、すべての応答に押される
// 通信路上の欄と、そこからずれを読む規則。3つとも両側が一致していなければならない
// ものなので、取り決めの持ち物になる。ここに無いもの、あってはならないものは2つ。
// バージョンごとに振る舞いを変える分岐（#205 自身の設計が禁じている＝適応し始めた
// 取り決めは取り決めではなくなる）と、どちら側を更新すべきかをユーザーに伝える文言と
// 画面。後者は拡張機能のもの（utils/i18n.ts、utils/diag.ts）。

import type { PostRecordShape } from './post-record.mts';
import type { RawPayloadInput } from './raw-payload.mts';

// 上げるのはメッセージの取り決め自体が変わったときだけ。アプリのバージョンと一緒には
// 決して動かさない。あちらは拡張機能から見えない理由で動く。整数1つなので、#205 の
// 判定は整数の比較になる。
//
// 上げるとき: 変わっていない相手側が取り違える変更＝要求の欄の改名、新たに必須になった
// 欄、意味が変わった応答の欄、拡張機能がこれから無条件に送る要求の種別。古い相手が
// ただ無視するだけの省略可能な欄の追加は、そのどれでもない。それで上げれば、ユーザーの
// 注意（保存のたびに出る帯）を何でもないことに使わせる。
export const PROTOCOL_VERSION = 2;

// capture id は `<epochMillis>-<hex>`。拡張機能が発行し（generateCaptureId）、ホストは
// これをファイル名の土台に使う。だからこの規則はホスト側の細部ではなく取り決めの一部だ。
// 敵対的なページと、保存フォルダのパス区切りや `..` との間に立つ唯一のものだから。
// ホストは衝突を `-<n>` を足して解消するので、ホストが返す id（取込キューのイベント id、
// 応答の captureId）はその接尾辞を持ちうる。native-host/inbox.mts の SAFE_EVENT_ID を
// 参照＝これはこのパターンにその末尾を足したものだ。
export const CAPTURE_ID_PATTERN = /^[0-9]{1,20}-[0-9a-f]{1,8}$/i;

export function isCaptureId(id: unknown): id is string {
  return typeof id === 'string' && CAPTURE_ID_PATTERN.test(id);
}

// 応答を返すときに echo する id。使い捨ての接続（保存の経路はすべてこれ）には要らない
// ＝ポートは要求を1つ運んで閉じる。ただし保存済み投稿の印は、多数の問い合わせを1本の
// 長生きするポートに多重化し、答えと問いを突き合わせなければならない。だからこの規則は
// どのハンドラのものでもなくメッセージのものだ。id を持つ要求には、その応答で id が返る。
export type RequestId = number;

// --- 要求（拡張機能 → ホスト）-------------------------------------------------

interface RequestCommon {
  // 通信路上では省略可能＝保存の経路は送らない。使い捨てのポートには突き合わせる相手が
  // 無いから。parseHostRequest を通った後は必ず在る（無かったときは null）。
  id?: RequestId | null;
}

// 投稿の情報を運ぶ両方の経路で読まれる、保存の欄。saveId はこの試行の capture.log の
// 行を、3つのプロセスにまたがってまとめる（#519）。metaOk と metaReason は、
// プラットフォームの API が答えたか、答えなかったならその理由を言う（#505）。これで
// ホスト自身のログの行が、部分的な保存を記録できる。
interface SaveCommon extends RequestCommon {
  // CAPTURE_ID_PATTERN に照らして正しい形か、要求が使える id を運ばなかったときは null。
  // その場合はハンドラが自前の型付き失敗で答える。
  captureId: string | null;
  saveId?: string | null;
  metadata: CaptureMetadata;
  metaOk?: boolean;
  metaReason?: string | null;
}

// Alt+S とホバーボタンによる保存。切り抜いたスクリーンショットと投稿の情報。
export interface SaveRequest extends SaveCommon {
  type: 'save';
  // base64 の JPEG。data: の接頭辞は付かない。無いときは ''。
  image: string;
}

// 一括取り込みの保存（#362）。スクリーンショットは無い＝ホストが投稿自身のメディアを
// ダウンロードし、最初のファイルがレコードの顔になる。
export interface SavePostRequest extends SaveCommon {
  type: 'savePost';
}

// プロフィールページから投稿者だけを保存する。投稿の行や保存済み投稿の印は作らない。
export interface SaveProfileRequest extends SaveCommon {
  type: 'saveProfile';
}

// 画像ドラッグによる保存。ドラッグされた1枚をホストがダウンロードする。
export interface SaveDraggedRequest extends SaveCommon {
  type: 'saveDragged';
  imageUrl: string; // 無いときは ''
  imageReferer?: string | null;
}

// 「このパーマリンクのうち、既にライブラリに在るのはどれか」（#54）＝ホストが答える
// 唯一の読み取りであり、デスクトップアプリを閉じていても印が働く理由。
export interface QueryRequest extends RequestCommon {
  type: 'query';
  urls: string[];
}

// 拡張機能が自分では書けなかった capture.log の1行（拡張機能にファイルアクセスは
// 無い）。そのまま追記してもらうために中継する。
export interface LogRequest extends RequestCommon {
  type: 'log';
  entry: HostLogEntry;
}

// 生存確認＝ホストが起動することを示すために診断ページが使う。
export interface PingRequest extends RequestCommon {
  type: 'ping';
}

export type HostRequest = SaveRequest | SavePostRequest | SaveProfileRequest | SaveDraggedRequest | QueryRequest | LogRequest | PingRequest;

export type HostRequestType = HostRequest['type'];

// レコードを書く3つの経路。ホストがこの3つをまとめてログに残し、まとめてゲートを
// かけ、拡張機能がこの中から選ぶので、名前を付けてある。
export type SaveRequestType = SaveRequest['type'] | SavePostRequest['type'] | SaveProfileRequest['type'] | SaveDraggedRequest['type'];

// 境界を越えるときの capture.log の1行。語彙（どんな段階と局面が在るか）は拡張機能の
// もので、extension/utils/capture-log.ts が持つ。そしてこの取り決めと一緒には意図して
// 運ばない。ホストは行をテキストのログに追記するだけであり、知らない段階を拒むホストは、
// まさにそれが記録するはずだったバージョンのずれの診断を落としてしまう。この境界が負う
// のは構造で、意味は書き手の側に残る。
export interface HostLogEntry {
  [key: string]: unknown;
}

// --- 運ばれる途中のレコード -----------------------------------------------------

// プラットフォームがその投稿について告げた画像や動画1つ。ダウンロードする URL と、
// どう取得するか。レコードの保存済みメディア（post-record.mts の MediaItemShape。
// こちらはディスク上のファイルを指す）とは別物だ。あちらはダウンロードした後にホストが
// 作るもので、こちらはホストが取得を頼まれるもの。
export interface AnnouncedMedia {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  referer?: string;
  // 表示のラベルではなくダウンロードの運び方: 'image'（既定。静止画しか無いサイトは
  // 省く）| 'video' | 'gif' | 'ugoira'。'image' 以外はさらに `poster` を持つ＝ホストが
  // <base>-poster.<ext> として保存する静止フレーム（#119 St1）。
  type?: 'image' | 'video' | 'gif' | 'ugoira';
  poster?: string | null;
  // 'ugoira' のときだけ（#119 St3）。保存する zip の中でのフレームの順番と、フレーム
  // ごとの表示時間。
  frames?: { file: string; delay: number }[];
}

// 拡張機能が告げる `:shortcode:` のカスタム絵文字1つ（#290）。ダウンロードする URL が
// あり、`file` は無い＝上の AnnouncedMedia と MediaItemShape が引いているのと同じ、
// 「取得を頼まれるもの」と「ホストが作ったもの」の分け方。
export interface AnnouncedCustomEmoji {
  shortcode: string;
  url: string;
}

// #181: リンク共有の投稿が持つ OGP のプレビューカードを、拡張機能が告げる形で。
// AnnouncedMedia と同じ「取得を頼まれるもの」の分け方＝`thumbnail` はダウンロードする
// URL で、ホストは取得した後に LinkCardShape の `thumbnailFile` を埋める
// （native-host/post-record.mts）。
export interface AnnouncedLinkCard {
  url: string | null;
  title: string | null;
  description: string | null;
  thumbnail: string | null;
}

// 保存の要求が運ぶ `metadata`。ホストが正規化し（normalizePostRecord）取込キューの
// エンベロープを書く前の、拡張機能が組み立てたままの投稿レコード。共有の PostRecordShape
// （#295 / #299）から導出していて、並べ直してはいない。だからあちらに足した欄はこの
// 通信路が運べる欄になり、どちら側も、データベースが最後に保存するレコードからずれられない。
//
// 保存される形と違う欄が5つある。これらは、ライブラリが最終的に持つものではなく、
// 拡張機能が持っているものだから:
//   media[]        ＝告げられたもの（取得する URL）。保存されたもの（ディスク上の
//                    ファイル）ではない。
//   customEmojis[] ＝告げられたもの（取得する URL）。保存されたものではない（#290:
//                    共有の emoji/ ストアのファイル名はホストが付ける）。
//   linkCard       ＝告げられたもの（取得するサムネイルの URL、#181）。保存されたもの
//                    （thumbnailFile）ではない＝media[] と同じ分け方。
//   rawPayloads    ＝#292 の原本を平文で。ホストがこれを圧縮し、ハッシュを取り、上限を
//                    かけてレコードの `raw` にする。
//   avatarFile     ＝省く。アバターをダウンロードしたホストだけがファイル名を付けられる。
//   bannerFile     ＝#289: バナー画像について avatarFile と同じ分け方。
export interface CaptureMetadata extends Partial<Omit<PostRecordShape, 'captureId' | 'media' | 'customEmojis' | 'raw' | 'avatarFile' | 'bannerFile' | 'linkCard'>> {
  media?: AnnouncedMedia[];
  customEmojis?: AnnouncedCustomEmoji[];
  // #181: 告げられたもの（取得するサムネイルの URL）。保存されたもの（thumbnailFile）
  // ではない＝上の media[] と同じ分け方。
  linkCard?: AnnouncedLinkCard;
  rawPayloads?: RawPayloadInput[];
  // アバターの取得に付けなければならない Referer（pixiv は Referer 無しの取得を拒む）。
  // 保存される欄ではない＝取得の指示であり、ホストが使い切る。
  avatarReferer?: string | null;
}

// --- 応答（ホスト → 拡張機能）---------------------------------------------------

// ホストが送るすべての応答に押される＝ack も pong も問い合わせの答えも失敗も同じ
// （#205）。ack だけでなくすべての応答に押すのは、何かがおかしいときに拡張機能が手に
// している見込みが最も高い応答は失敗だからだ。成功にしか乗らないバージョンは、まさに
// そのときに欠ける。
//
// 通信路上では省略可能で、読み手が必須にすることは決してない。これが在る前に作られた
// ホストは送らないし、無いこと自体が1つの答えになる（protocolSkewOf を参照）＝応答が
// 壊れていると言う理由にはならない。向きは常に一方向（ホスト → 拡張機能）だ。答えるのは
// ホストだけだから。拡張機能が期待する側は自分のバンドルにある PROTOCOL_VERSION で、
// 通信路上の欄は要らない。
export interface VersionStamp {
  protocolVersion?: number;
}

// 今この瞬間、ビルドの置き場に座っているローカルビルドの拡張機能がどれか（#650）。
// バージョンではないし、上の取り決めの一部でもない。`npm run build:ext` が1回完了する
// たびにちょうど1回変わる、中身に意味の無いトークンだ。これで、その置き場から読み込ま
// れた拡張機能は、自分のバンドルが古くなったことに気づき、人が chrome://extensions の
// ボタンを押すのを待たずに chrome.runtime.reload() を呼べる。
//
// プロトコルバージョンと同じ席に乗る。理由も同じだ。拡張機能は保存のたび、印の
// 問い合わせのたびに、既にこのホストと話している。だから2本目の通り道も、2つ目の
// プロセスも、ポートも要らずに知らせが届く。Native Messaging はホストの側から始められ
// ない（Chrome の規則）ので、取れる形は拡張機能が始めた往復に乗って返ることだけ＝これが
// それだ。
//
// 拡張機能を自分でビルドしていない人には存在しない。ホストがこれを出すのは、これが読む
// スタンプファイルをビルドが書いたときだけで（bridge.mts の readExtBuild を参照）、
// リリース版のインストールのリリース版ホストが見つけることはない。バージョンのスタンプ
// とまったく同じく、通信路上では省略可能で読み手が必須にすることは決してない＝古い
// ホストは送らず、そのとき拡張機能はただ比べる相手を持たない。
export interface DevBuildStamp {
  extBuild?: string;
}

// 1本のパーマリンクについてホストが言うこと。それを持つレコードの captureId と、その
// 投稿のどの画像がライブラリに在るか（#334）。位置で対応するので、添字はレコードの中の
// その画像の番号であり、null はライブラリが URL を持たなかった画像を表す。空の一覧は
// 「保存済みだが画像を区別できない」を意味し、オーバーレイはそれを投稿全体と読む。
export interface SavedEntry {
  id: string; // 出所が id を報告できなかったときは ''
  media: Array<string | null>;
  // 元投稿の画像総数。個別保存の imageCount または全体保存時の告知数。
  // 古い索引は持たないため任意。
  total?: number | null;
  // media と並びが対応する。その画像をどの captureId が持つか（#34）。`id` は投稿の
  // キーを最初に主張したレコードしか指さないので、これには答えられない。#34 以降に
  // アプリが書き直していない saved-index のスナップショットには無い。
  owners?: Array<string | null>;
}

export type SavedResults = Record<string, SavedEntry | null>;

// 投稿がライブラリのゴミ箱に入っているパーマリンクについてホストが言うこと（#158）。
// 保存済みではないが、レコードとファイルはまだそこに在り、保存し直せばユーザーが
// 捨てたつもりの投稿の2つ目の複製が黙ってできてしまう。
//
// SavedEntry の目印ではなく SavedResults とは別の map にしたのは意図してそうしている。
// どの読み手も「項目が在る」を「ライブラリがこの投稿を持っている」と扱う（タイムライン
// の印が点き、ホバーの保存ボタンが隠れる）が、ゴミ箱の投稿は持っていない。2つの答えを
// 分けておくことは、この追加を両方向で後方互換にもしている＝古い拡張機能はこの欄を
// 無視し、古いホストはこれを送らない。
export interface TrashedEntry {
  // そのゴミ箱のレコードが属するキャプチャ。参考情報だ。復元はアプリ側の操作なので
  // （ホストはライブラリに対して読み取り専用）、拡張機能の側では何もこれを使って動け
  // ない。画面が、話題にしているレコードの名を言えるようにここに在る。
  id: string;
  // 投稿をゴミ箱へ移した ISO 時刻。レコードにスタンプが無いときは null（書き込みが
  // 中断されたゴミ箱のレコード）。知らせは日付を作り出さずに落とす。
  deletedAt: string | null;
}

export type TrashedResults = Record<string, TrashedEntry>;

interface AckCommon {
  ok: true;
  // 今書いたレコードの、uniqueBase で解決済みの id。`file` からは導けない。一括取り込み
  // での `file` はメディアのファイル名だから（#34）。
  captureId: string;
  file: string;
  saveFolder: string;
  // ホストが実際に記録した画像。位置で対応する（SavedEntry を参照）。
  media: Array<string | null>;
}

export interface CaptureAck extends AckCommon {
  mediaCount: number;
}

export interface BulkAck extends AckCommon {
  mediaCount: number;
  // ディスクには書いたが、#365 が入るまでライブラリはこれを見せられない。
  deferred: boolean;
}

export type DraggedAck = AckCommon;

export type SaveAck = CaptureAck | BulkAck | DraggedAck;

export interface QueryAck {
  ok: true;
  results: SavedResults;
  // 投稿がゴミ箱に在るパーマリンクだけ（#158）＝キーが無いことが「ゴミ箱に無い」を
  // 意味するので、これは並びが対応する map ではなく疎な map だ。省略可能なのは #158 の
  // 前に作られたホストが送らないからで、どの読み手も、無いことを壊れた応答ではなく
  // 「知らせ無し」と扱わなければならない。
  trashed?: TrashedResults;
}

export interface LogAck {
  ok: true;
}

export interface PongAck {
  ok: true;
  pong: true;
}

export type HostErrorCode =
  // フレームの本体が JSON ではなかった。
  | 'invalid-json'
  // JSON ではあるが、この取り決めが読める `type` を持つ要求オブジェクトではない。
  | 'malformed-request'
  // このホストが実装していない `type`。
  | 'unknown-type'
  // 形は正しい要求だが、ハンドラが拒んだか例外を投げた。`error` はそのハンドラ自身の
  // メッセージで、拡張機能はこれを分類する（#492/#505＝
  // extension/utils/native-error.ts）。
  | 'save-failed';

export interface HostFailure {
  ok: false;
  error: string;
  code: HostErrorCode;
}

export type HostResponse = SaveAck | QueryAck | LogAck | PongAck | HostFailure;

// 出ていく応答1つにスタンプを押す。ホストの送信ループではなくここに在るので、
// 「どの応答も、どの取り決めが書いたかを言う」が取り決め自身の性質になる＝2つ目の
// 作り手（テストダブル、将来のホスト）がこれを忘れて、その沈黙を拡張機能に「古い
// ホスト」と読ませることがない。
// `extBuild` が同じ呼び出しに相乗りするのは、「どの応答もどの取り決めが書いたかを言う」
// と「どの応答もディスク上のローカルビルドがどれかを言う」が離れられないようにするため。
// 継ぎ目は1つだけで、片方を忘れる作り手は両方を忘れる。言うことが何も無いときは丸ごと
// 省くので、ふつうのインストールへの応答は #650 の前にここが送っていたものとバイト単位で
// 同じになる。
export function stampProtocol<T extends HostResponse>(res: T, extBuild?: string | null): T & VersionStamp & DevBuildStamp {
  const stamped = Object.assign({ protocolVersion: PROTOCOL_VERSION } as VersionStamp & DevBuildStamp, res);
  if (extBuild) stamped.extBuild = extBuild;
  return stamped;
}

// 応答1つのスタンプから、どちら側が遅れているかを出す（#205）。整数の比較だけで、
// それ以外は何もしない。バージョンごとの表も、機能の探りも無い。
//
//   'host-old' ＝デスクトップアプリ（ホストを同梱している側）を更新する必要がある。
//   'host-new' ＝拡張機能の側を更新する必要がある。
//
// スタンプが無いときは 'host-old' と読む。これは意図してそうしている。この取り決めを
// 持つホストはどれも応答にスタンプを押すので、沈黙はスタンプが在る前のホストを意味する。
// まさにこの判定を足した理由がそれだ。うまくいかなかったインストールがディスクに残した
// bridge.js が、何か月も誰も見ていない取り決めで保存に答え続けている（#511）。
export type ProtocolSkew = 'match' | 'host-old' | 'host-new';

export function protocolSkewOf(hostVersion: number | null): ProtocolSkew {
  if (hostVersion === null || hostVersion < PROTOCOL_VERSION) return 'host-old';
  if (hostVersion > PROTOCOL_VERSION) return 'host-new';
  return 'match';
}

// 受け取った応答1つに載っているスタンプ。載っていなければ null。整数でないものと数値
// でないものも null になる＝比べられないスタンプは、無いスタンプより良くはない。無いもの
// として扱えば、失敗は「ユーザーに更新を伝える」経路に留まり、3つ目の経路を作らずに済む。
export function hostProtocolVersion(raw: unknown): number | null {
  return isObject(raw) && typeof raw.protocolVersion === 'number' && Number.isInteger(raw.protocolVersion) ? raw.protocolVersion : null;
}

// 受け取った応答1つに載っているビルドのスタンプ。載っていなければ null（#650）。
// 空文字列も null と読む。ビルドが出すのは中身に意味の無いトークンか、まったく何も無いか
// のどちらかで、"" はそのどちらでもない。無いものとして扱えば、壊れたスタンプが本物の
// スタンプと比べられることが一切なくなる。
export function hostExtBuild(raw: unknown): string | null {
  return isObject(raw) && typeof raw.extBuild === 'string' && raw.extBuild ? raw.extBuild : null;
}

// 応答の読み手が前提にしてよいこと。すべて省略可能なのは意図してそうしている。両側は
// まったく別の通り道で更新される（Chrome ウェブストアと、アプリ自身の更新機構）ので、
// ack は、それを読む拡張機能より古いホストからも新しいホストからも届きうる。ここで欄を
// 必須にすれば、バージョンのずれが「保存が失敗した」に化ける。事実はその逆で、どちらに
// せよレコードはディスクに在る。厳密な作り手側の型から導出しているのでそこからずれられ
// ない。ずれがユーザーに伝わるものになるのは #205 の側。
export type HostAckView = { ok: true } & VersionStamp & DevBuildStamp & Partial<CaptureAck & BulkAck & QueryAck & PongAck>;

// --- 解析 -----------------------------------------------------------------------

export type ParsedRequest = { ok: true; request: HostRequest } | { ok: false; id: RequestId | null; failure: HostFailure };

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// これらが置き換えた型無しの `msg.x` の読みと、寛容さをきっちり同じに保つ。型の合う値は
// そのまま通り（明示的な null も含む。拡張機能はそれを送るから）、それ以外＝とりわけ欄が
// 無い場合は undefined になる。それは型無しの読みが既に返していたものであり、
// JSON.stringify が capture.log の行から既に省くものだ。
function optionalString(v: unknown): string | null | undefined {
  return typeof v === 'string' || v === null ? v : undefined;
}

function optionalBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function requiredString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function requestId(raw: Record<string, unknown>): RequestId | null {
  return typeof raw.id === 'number' ? raw.id : null;
}

function saveCommon(raw: Record<string, unknown>): SaveCommon {
  return {
    id: requestId(raw),
    captureId: isCaptureId(raw.captureId) ? raw.captureId : null,
    saveId: optionalString(raw.saveId),
    metadata: isObject(raw.metadata) ? (raw.metadata as CaptureMetadata) : {},
    metaOk: optionalBoolean(raw.metaOk),
    metaReason: optionalString(raw.metaReason),
  };
}

function failure(id: RequestId | null, code: HostErrorCode, error: string): ParsedRequest {
  return { ok: false, id, failure: { ok: false, error, code } };
}

// 受け取ったメッセージ1つを、型の付いた要求か、返すべき失敗に変える。決して例外を
// 投げない。壊れたフレームで落ちるホストは、接続まるごとと、その後ろに並ぶすべての要求を
// 道連れにする。
//
// ここで確かめるのはエンベロープだ。オブジェクトが在るか、この取り決めが知っている type
// を名乗るか、各欄が宣言どおりの型の値を持つか。意図して確かめないのは、その経路自身の前提が
// 満たされているか（画像は在るが JPEG ではない、要求が captureId を省いた）。そちらは
// ハンドラに残る。ハンドラは既に、拡張機能が分類するメッセージでそれらに答えている。
// 逆の分け方をすれば、それらのメッセージと、それを読む振る舞いを、何の得も無く動かす
// ことになっていた。
export function parseHostRequest(raw: unknown): ParsedRequest {
  if (!isObject(raw)) return failure(null, 'malformed-request', 'Malformed message (not an object)');
  const id = requestId(raw);
  const type = raw.type;
  if (typeof type !== 'string') return failure(id, 'malformed-request', 'Malformed message (missing type)');
  switch (type) {
    case 'save':
      return { ok: true, request: { type, ...saveCommon(raw), image: requiredString(raw.image) } };
    case 'savePost':
      return { ok: true, request: { type, ...saveCommon(raw) } };
    case 'saveProfile':
      return { ok: true, request: { type, ...saveCommon(raw) } };
    case 'saveDragged':
      return { ok: true, request: { type, ...saveCommon(raw), imageUrl: requiredString(raw.imageUrl), imageReferer: optionalString(raw.imageReferer) } };
    case 'query':
      return { ok: true, request: { type, id, urls: Array.isArray(raw.urls) ? raw.urls.filter((u): u is string => typeof u === 'string' && !!u) : [] } };
    case 'log':
      return { ok: true, request: { type, id, entry: isObject(raw.entry) ? raw.entry : {} } };
    case 'ping':
      return { ok: true, request: { type, id } };
    default:
      return failure(id, 'unknown-type', `Unknown message type: ${type}`);
  }
}

// 同じことを、Native Messaging のフレーム1つの UTF-8 の本体から始める。こうすると
// 「バイト列が JSON ではなかった」は、ホストのループがそれぞれ勝手に作る場合分けでは
// なく、この取り決めの場合分けになる。
export function parseHostFrame(body: string): ParsedRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return failure(null, 'invalid-json', 'Invalid JSON message');
  }
  return parseHostRequest(raw);
}

// 応答がどの要求のものか。特定の要求に属さない応答は null（保存の経路のポートはどれも
// 要求を1つしか運ばないので、その応答に id は要らない）。echo の規則はどのハンドラの
// ものでもなくメッセージのものだ。RequestId を参照。
export function responseId(raw: unknown): RequestId | null {
  return isObject(raw) && typeof raw.id === 'number' ? raw.id : null;
}

// `protocolVersion` が両方の側に在るのは、取り決めがホストに尋ねられた問いではないから
// だ。たまたま返ってきた応答に相乗りするだけであり、保存を失敗させるほど古びたホスト
// こそ、そのバージョンが最も重要になる。null は、応答がスタンプを運ばなかったことを表す
// （protocolSkewOf を参照）。
// `extBuild` が両方の側に在る理由も `protocolVersion` と同じだ。要求への答えではなく、
// たまたま返ってきた応答に相乗りする。そして「ディスク上のビルドが変わった」の運び手と
// して、失敗した応答は成功した応答と同じだけ役に立つ。null は、応答がスタンプを運ば
// なかったことを表す（#650）。
export type ReadResponse = { ok: true; ack: HostAckView; protocolVersion: number | null; extBuild: string | null } | { ok: false; error: string; code: HostErrorCode | null; protocolVersion: number | null; extBuild: string | null };

// ポートから応答を1つ読む。`ok:true` はホスト自身の成功の印であり、ここが頼れる唯一の
// ものだ。ack をここで検証せず絞り込むだけにしている理由は HostAckView を参照。すべての
// 応答を1つの関数に通す狙いは、呼び出し側が自前の「それはうまくいったか」の規則を作ら
// ないようにすること。#400 の前は、3つの保存の送り手と印の問い合わせが、その問いに
// それぞれの言い方で答えていた。
export function readHostResponse(raw: unknown): ReadResponse {
  const protocolVersion = hostProtocolVersion(raw);
  const extBuild = hostExtBuild(raw);
  // `unknown` を経由する。フレームは `unknown` な値の袋で、HostAckView はそのうち
  // いくつかに型を宣言しているので、2つは直接は比べられない。検証ではなく絞り込みで
  // あることが要点だ。HostAckView を参照。
  if (isObject(raw) && raw.ok === true) return { ok: true, ack: raw as unknown as HostAckView, protocolVersion, extBuild };
  const error = isObject(raw) && typeof raw.error === 'string' && raw.error ? raw.error : 'Native host returned an error';
  const code = isObject(raw) && typeof raw.code === 'string' ? (raw.code as HostErrorCode) : null;
  return { ok: false, error, code, protocolVersion, extBuild };
}
