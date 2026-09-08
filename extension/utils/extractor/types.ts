// どのサイトのモジュールも実装する契約 (#212)。1サイト＝1モジュール（x.ts、bluesky.ts、
// pixiv.ts）で、そのサイトについての知識を両方の相とも持つ:
//
//   URL / API 相 — 投稿 URL を見分け、プラットフォームの API から投稿のメタデータを
//                  取得する。サービスワーカーで動く。
//   DOM 相       — ページを見分け、ポインタの下の投稿を見つけ、その permalink を読み、
//                  どの絵がどの投稿のものかを言い当て、タイムラインのオーバーレイの
//                  操作部品をどこに置くかを示す。コンテンツスクリプトで動く。
//
// 以前は2つの相が別々のファイルに分かれ、何も検査しないプラットフォーム文字列で結ばれて
// いた（'x' と答える DOM の分岐と 'x' と答える URL の分岐は、綴りだけでつながっていた）。
// ここでは1つのオブジェクトなので、x.com/<user>/status/<id> を解析するサイトと x.com の
// ページを見分けるサイトが、作りからして同じ値になる。
//
// 入口の分割は変えていない＝コンテンツスクリプトとサービスワーカーは今も別々のバンドル
// で、互いに自分が使わない相を呼ばないだけ。
import type { AnnouncedMedia } from '../../../native-host/protocol.mts';

// extractor が1枚の絵・1本の動画について申告するものは、`metadata.media[]` として
// Native Messaging の境界を渡るものとまったく同じ。だから形は境界のある場所（#400・
// native-host/protocol.mts）で宣言してあり、ここにあるのは extractor 側での呼び名。
// レコードの保存済みメディアとは別物で、あちらはディスク上のファイルを指し、ホストに
// しか埋められない。
type MediaItem = AnnouncedMedia;

type QuotedPost = import('zod').output<typeof import('../../../native-host/protocol.mts').AnnouncedQuotedPostSchema>;
type PollChoice = import('../../../native-host/post-schemas.mts').PollChoiceShape;
type Poll = import('../../../native-host/post-schemas.mts').PollShape;
type ProfileLink = import('../../../native-host/post-schemas.mts').ProfileLinkShape;
type LinkCard = import('../../../native-host/protocol.mts').AnnouncedLinkCard;
type PostRecord = import('zod').output<typeof import('../../../native-host/protocol.mts').ExtractedPostSchema>;

// ある extractor の parseUrl() が見分けた中身。`platform` は固定で、それ以外は、その
// サイト自身の API に投稿を尋ねるのに要るもの（tweet id、handle + rkey など）。読み返すのは同じ extractor の fetchPost() だけ。
interface ParsedPost {
  platform: string;
  [key: string]: any;
}

// プロフィール URL を見分けた結果。投稿 URL と同じく、後で API に尋ねるための値は
// 見分けた extractor だけが読み返す。
// --- DOM 相 ------------------------------------------------------------------

// 投稿についてページが出しているもの。利用者がその投稿を選んだ瞬間に、投稿要素から読む
// (#202)。どの欄も省略可能で、どれも隙間を埋めるためのもの＝プラットフォームの API が
// 答えを持つところでは必ずそちらが勝つ。それを守らせる合流の規則は、サイトごとの
// extractor ではなく1か所（dom-meta.ts の mergeDomMeta）にある。
//
// ページが略記している数は概数になる（`1.2万` は 12000 として読み返る）。それが欠陥では
// なく仕様である理由は dom-meta.ts の parseCount を参照。
//
// この形は保存要求の一部としてコンテンツスクリプト → サービスワーカーの境界を渡る
// （messages.ts の CaptureAndSendMessage.domMeta）ので、素のデータしか持たない。
interface DomMeta {
  text?: string | null;
  displayName?: string | null;
  screenName?: string | null;
  // ISO 8601。投稿の時刻を描くサイトはどれも <time datetime> で描き、その属性はすでに
  // ISO なので、ここで人間向けの日付を解析することはない。ロケール依存の `10h` は
  // 復元できないので、推し量らずに欠けたままにする。
  date?: string | null;
  likes?: number | null;
  reposts?: number | null;
  replies?: number | null;
  bookmarks?: number | null;
  views?: number | null;
}

// ページ上の投稿を保存するための DOM 側の規則。パーマリンク、本文などの補完、
// 一括取り込み可能な一覧をサイトごとに定義する。
interface ContentSite {
  platform: string;
  postSelector?: string;
  getPermalink(post: Element): string;
  // 一括取り込みが歩ける一覧ページをそのサイトが持ち、今まさに
  // そのページに居るか。そういうページを持たないサイトでは無い (#362)。非同期に解決して
  // よい (#280)＝「これは自分自身の一覧だ」の確認には、ページ自身の DOM が見ている人の
  // 素性を持っていない場合、ネットワークの往復が要ることがある（pixiv のブックマーク
  // 一覧がそういうページ）。
  isBulkCapturePage?(): boolean | Promise<boolean>;
  // このモードが保存する投稿すべてに刻む取り込み経路。まとめて取り込んだ投稿を、普段の
  // 1件ずつの保存と区別できるようにするため（native-host/post-record の capturedVia）。
  // isBulkCapturePage を実装するサイトは、これも必ず設定すること（#280 が、それまで唯一の
  // 値だった x-bookmarks からこれを切り出した）。
  capturedVia?: string;
  // このモードが歩く一覧が、最初から DOM に丸ごと在るか。在るなら、実行中に総数を出せる
  // (#280)。無い場合（X のブックマーク一覧は仮想リスト）は、総数を知る術が無いという意味。
  bulkKnowsTotal?: boolean;
  // 「一覧の終わりまで来たか」の追加の条件。「キューに残りが無く、DOM がしばらく静かで
  // ある」と並べて検査する。無ければ、その静かで空という条件だけで足りる（pixiv のように
  // 仮想化されていない一覧では足りる）。X はこれを設定して、いちばん下までスクロール済み
  // であることも要求する。X の仮想リストは、スクロールして到達した行しか載せないから
  // (#280 が bulk-capture.ts からこれを切り出した。以前はどのサイトにも要ると決め付けて
  // いた)。
  bulkAtBottom?(): boolean;
  // この投稿についてページが出しているものを読み、プラットフォームの API が答えられな
  // かった欄も保存できるようにする (#202)。まだ書いていないサイトでは無く、そこでの保存は
  // 従来のまま。
  //
  // 呼ぶのは必ず dom-meta.ts の readDomMeta 経由で、直接呼んではいけない。セレクタが投げた
  // 例外を保存へ持ち込ませないのは、あの包みだから。実装側にも投げないことは期待するが、
  // ページの改装と投稿の取り落としの間に立っているのは実装側ではない。
  //
  // 問い合わせは必ず `post` の中だけで行うこと。document 全体を引くのは、この機能が本当に
  // 害をなしうる唯一の道になる。隣の投稿の本文でこのレコードを埋めてしまうし、間違った
  // キャプションは欠けているより悪い。後から間違いだと分かる手立てが何も無いから。
  extractDomMeta?(post: Element): DomMeta | null;
}

interface MediaIdentity {
  postId: string;
  link: string;
}

// ページの中に在る、投稿のメディア。たいていは <img> だが、動画や GIF の投稿では
// <video> になる。X はプレーヤーが初期化された瞬間にポスターの <img> を
// <video poster="…"> へ置き換え、投稿がスクロールで流れ去ったあとも <img> を戻さない。
// だから今ホバーできるものについては、poster 属性がページの差し出す唯一の取っ手に
// なる (#450)。
type PostMediaElement = HTMLImageElement | HTMLVideoElement;

// この絵や動画はどの投稿のものか。ホバー保存ボタンの対象判定と、画像の右クリック保存が
// 同じ規則を読む。
interface MediaIdentitySite {
  platform: string;
  // そのメディアを確信をもって帰属させられないときは必ず null＝アバター、バナー、
  // グリッド上の隣の投稿の絵など。呼ぶ側は null を「何もしない」と読み、「推し量る」とは
  // 読まない。
  extractIdentity(el: PostMediaElement): MediaIdentity | null;
  // その要素が投稿自身のメディアであること。プラットフォームが投稿のメディアに使う CDN の
  // パスで判定する。ホバーボタンには素性だけでは足りない。投稿の中のアバターも、その投稿の
  // permalink へ何の問題もなく解決してしまうので、それを保存すると投稿者のアイコンを作品
  // として綴じ込むことになる。
  isPostMedia(el: PostMediaElement): boolean;
}

// タイムラインのオーバーレイが操作部品を吊るす場所 (#54 / #94)。
interface OverlaySite {
  // フィードの中にある投稿の形をした要素すべて。当たった要素は候補にすぎず、それが本当に
  // 投稿を指しているかは getPermalink が決める。
  unitSelector: string;
  // その単位の中のメディアの箱すべてを、文書順で。印は投稿についての事実を述べるが、保存
  // ボタンが働きかけるのは絵1枚なので、オーバーレイは先頭だけでなく箱ごとに面倒を見る。
  mediaIn(unit: Element): Element[];
  // 画像なしの投稿の保存と、複数画像の一括保存を配置する投稿者アバター。
  textAnchorIn?(unit: Element): Element | null;
  // ポインターを受け取るためメディアの手前に置かれたサイト自身の操作。
  // true の要素は fixed/sticky でも、別画面による遮蔽ではなくそのメディア
  // の操作面として扱う。
  pointerOverlayInMedia?(overlay: Element, mediaBox: Element): boolean;
}

// --- extractor 本体 ----------------------------------------------------------

interface Extractor {
  readonly platform: string;

  // === URL 相（実行文脈は両方） ===

  // 投稿 URL を見分ける。null＝このサイトの URL ではない。登録簿の順で呼ばれるので、
  // extractor は取得できない URL を自分のものだと名乗ってはいけない。
  parseUrl(u: URL): ParsedPost | null;
  // 投稿の詳細ページやプロフィール配下の一覧を含まない、プロフィール自身の URL だけを
  // 見分ける。未対応のサイトでは省略する。
  // このオリジンに居るタブは、このプラットフォームの保存をサービスワーカーへ頼んでよいか。
  // ホスト名だけでなく素のタブ URL も取る。
  isAllowedOrigin(tabUrl: string, hostname: string): boolean;
  // この extractor が接触する API のホスト。ただし、そのホストが固定ではなく投稿 URL から
  // 来る場合に限る。ホストが固定のサイトにはこの防ぎが要らないので、無い。
  derivedApiHost?(parsed: ParsedPost): string | null;

  // === API 相（サービスワーカー） ===

  fetchPost(parsed: any, url: string): Promise<PostRecord>;

  // === メディアの URL（文脈は両方） ===

  // 「この2つの URL は同じ絵か」に答える、サイトごとに1つの規則。同じ絵が何通りもの綴りで
  // こちらへ届く＝ページはサムネイルを見せ、プラットフォームの API は原本を申告し、保存は
  // 実際にダウンロードした方を記録する。文字列を比べれば毎回「違う」と答えることになる。
  //
  // プラットフォームが保証する素性を URL が持たないときは null を返す＝知らない CDN の
  // パス、blob:、動画ファイル（X は .mp4 を寄こすが、ページ側の対応物はポスターのコマ
  // だけ）。呼ぶ側は null を「比べられない」と読み、「一致しない」とは読まない。保存済みの
  // 絵の照会は、投稿の中でのそのメディアの位置へ退避する。位置を保っているのがレコードの
  // seq。
  mediaKey(url: string): string | null;
  // ページ側のメディア URL を、同じ CDN が配信している原本へ格上げする。null＝書き換えが
  // 当てはまらない（もう原本であるか、こちらが書き換えてよいものではない）。
  highResUrl?(url: string): string | null;
  // このサイトのメディアをダウンロードするのに要る Referer（i.pximg.net は無いと 403）。
  mediaReferer?: string;
  // そのサイトが投稿のメディアにファイル名で番号を振っているので、ドラッグされた絵が、
  // URL の照合なしに投稿の media[] の何番目のエントリかを言える。null＝この URL に
  // ページ番号が無い。ページに番号を振らないサイトでは無い。
  mediaPageIndex?(imageUrls: string[]): number | null;

  // === DOM 相（コンテンツスクリプト） ===

  // 今このサイトに居るか。ホストが固定のサイトではホストを検査する。
  matchesPage(): boolean;
  content: ContentSite;
  // 絵を投稿へ帰属させる規則をサイトが持たないとき、またはオーバーレイが動くタイムライン
  // が無いときは、無い。無くても印は働く。
  mediaIdentity?: MediaIdentitySite;
  overlay?: OverlaySite;

  // === Manifest ===

  // 常駐コンテンツスクリプト（ドラッグ保存＋オーバーレイ）の match パターンと、CORS のため
  // に host_permissions が要る API のホスト。どちらもビルド時に読むので、サイトを増やす
  // 作業は「モジュール1本＋登録簿1行」のままで済む。
  residentMatches?: readonly string[];
  apiHostPermissions?: readonly string[];
}

export type { ContentSite, DomMeta, Extractor, LinkCard, MediaIdentity, MediaIdentitySite, MediaItem, OverlaySite, ParsedPost, Poll, PollChoice, PostMediaElement, PostRecord, ProfileLink, QuotedPost };
