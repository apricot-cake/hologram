// どのサイトのモジュールも実装する契約 (#212)。1サイト＝1モジュール（x.ts、bluesky.ts、
// misskey.ts、mastodon.ts、pixiv.ts）で、そのサイトについての知識を両方の相とも持つ:
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

// DOMRect の読み取り側と同じ形だが、こちらは素のデータ。保存する範囲の幾何には手を
// 加える（Misskey は矩形を <article> まで広げ、pixiv は画像まで狭める）が、DOMRect は
// 書き換えた数から組み立てられないため。
interface PostRect {
  x: number;
  y: number;
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

// 取得原本1件 (#292)。届いたそのままのレスポンス本文と、それが何から生まれたかを言える
// だけの文脈。拡張機能が作るのはこの平文の形だけ＝圧縮・ハッシュ・レコードごとの大きさの
// 上限はネイティブホストの担当（native-host/raw-payload.mts の packRawPayloads）。何を
// 残す価値があるかをブラウザ側が決める筋合いはないから。
//
// ここに入るのは、保存しようとしている投稿のレスポンス本文だけ。リクエストヘッダ・
// Cookie・資格情報を写し取ることは一切ない。#292 が引いた境界は「このレコードのために
// 届いた payload」で、この形が持てるのもそれだけ。
interface RawAcquisition {
  // 'api:<platform>/<endpoint>'。endpoint の部分は API 自身が付けている名前＝後から読む
  // 人が、その本文はどのスキーマに従うのかを判別できるようにするため。
  sourceKind: string;
  acquiredAt: string;
  contentType: string | null;
  body: string;
}

// extractor が1枚の絵・1本の動画について申告するものは、`metadata.media[]` として
// Native Messaging の境界を渡るものとまったく同じ。だから形は境界のある場所（#400・
// native-host/protocol.mts）で宣言してあり、ここにあるのは extractor 側での呼び名。
// レコードの保存済みメディアとは別物で、あちらはディスク上のファイルを指し、ホストに
// しか埋められない。
type MediaItem = AnnouncedMedia;

// 引用元・返信先の投稿。親と並べてサイドカーのサブレコードとして保存する (#180)。これを
// 作るのは、すでに取得済みの API レスポンスが相手の投稿の中身を丸ごと同梱している
// プラットフォームだけ。引用は4つとも同梱している（X の quoted_tweet / Bluesky の
// embed.record / Misskey の note.renote / Mastodon の quoted_status＝形が持っていると
// き）。返信先の中身を同梱しているのは Misskey（note.reply）と、#806 以降は X も。X の
// 埋め込み用 API のレスポンスは、そのツイートが返信であれば必ず、最上位のツイートと同じ
// 形の `parent` 欄を持つ（スキーマのカナリアの `reply` サンプル
// scripts/canary/snapshots/x.json・2026-07-30 取得で確認）。Mastodon の in_reply_to_id は
// 投稿の本文を持たず、Bluesky の getPostThread は今は parentHeight=0 で尋ねる
// (#292)。だからこの2つは、この Issue 自身の範囲が除いている追加の要求なしには
// ここを埋められない（要求を1本足す取得は個別に判断する＝v1 の範囲外）。この2つは従来
// どおり ID と URL だけの欄（replyToId/quotedUrl）を持ち続け、この厚いサブレコードを
// 得ることはない。
//
// v1 はメタデータだけ（#180 の範囲）。media が持つのは、同じレスポンスがすでに申告して
// いた相手の投稿のメディア URL だけで、ダウンロードは一切しない＝自分のものでない隣の
// 投稿すべてについて #290 が引いた「URL は記録するが取りには行かない」線と同じ。
interface QuotedPost {
  url: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  text: string | null;
  date: string | null;
  cw: string | null;
  media: MediaItem[];
}

// アンケートの選択肢1つ (#179)。並びはプラットフォームが返したまま。`votes` が null に
// なるのは、プラットフォームが集計を伏せているときだけ。Mastodon は、アンケートが結果を
// 隠している間 PollOption.votes_count が null になると文書化している。これは票が0である
// こととは別の事実で、そう読めてはいけない。
interface PollChoice {
  text: string;
  votes: number | null;
}

// 投稿に付いたアンケート (#179)。アンケートを持つプラットフォームはどれも設問を独立した
// 欄で持たない＝投稿の本文そのものが設問なので、ここが持つのは選択肢と、その周りの条件
// だけ。
//
// 出所。いずれも文書だけでなく実際のレスポンスで確認した。Misskey の note.poll
// （{multiple, expiresAt, choices[{text,votes}]}）と Mastodon の status.poll
// （{multiple, expires_at, options[{title,votes_count}], voters_count}）は、どちらも
// カナリアの登録済みサンプル（scripts/canary/snapshots/{misskey,mastodon}.json の
// 'poll' ラベル）。X は埋め込み用エンドポイントで旧来のカードとして寄こす＝card.name が
// 'poll<N>choice_text_only' で、choice<N>_label / choice<N>_count / end_datetime_utc を
// binding の値として持つ（2026-08-02 に cdn.syndication.twimg.com で実測。x.ts の xPoll
// を参照）。Bluesky にアンケートは無い。app.bsky.feed.post の lexicon の embed 合併型は
// images / video / gallery / external / record / recordWithMedia だけで、他には無い
// （bluesky-social/atproto の lexicons を 2026-08-02 に確認）。だからあの extractor が
// ここを埋めることはない＝Bluesky を4つのうちに数えていたこの Issue 自身の冒頭の一文を、
// ここで訂正しておく。
//
// ここから投票することはないし、選択肢を操作部品として描くこともない（#179 の範囲＝
// 投票の UI は再現しない）。これは保存した時点でアンケートが何と言っていたかの
// スナップショットで、レコードの他のエンゲージメントの数と同じ読み取り専用の扱いになる。
interface Poll {
  choices: PollChoice[];
  // 投票する人は選択肢を2つ以上選べるか。プラットフォームの payload にその欄が無ければ
  // null（X のアンケートカードは複数選択の印を持たない）＝isReply/isEdited と同じ、null は
  // 信号が無いことを表すという約束で、false を推し量って入れることはない。
  multiple: boolean | null;
  // ISO 8601 の締切。アンケートに締切が無ければ null（Misskey は期限なしのアンケートを
  // 許す）。締切済みかどうかを欄として持たないのは意図してのこと。それはこの時刻と、
  // 尋ねている時点とを比べれば出る。保存した集計が取った時点でまだ動いていたかは、
  // レコード自身の capturedAt がすでに語っている。
  expiresAt: string | null;
  // 投じられた票数ではなく、重複を除いた投票者の数。複数選択のアンケートでは2つが食い
  // 違う。報告するのは Mastodon だけ（voters_count）で、他は null。票の数は必ず
  // choices[].votes の合計になるので、二重には持たない。
  votersCount: number | null;
}

// #181: リンク共有の投稿が持つ OGP のプレビューカード。プラットフォーム自身の API が
// これを、属する投稿と一緒に同梱してくる（Bluesky の app.bsky.embed.external の view、
// Mastodon の status.card、X のリンクプレビューのカード。プラットフォームごとの取得元は
// bluesky.ts/mastodon.ts/x.ts を参照）ので、QuotedPost と同じく、これを組み立てるために
// 要求を1本余分に使うことはない。
//
// #195 のブックマークのレコードとは別物。ブックマークでは og:image/title/description
// 自身がレコードそのもの（rec.title/rec.text/rec.media[0]）になる。レコード自体が
// ブックマークしたページだから。こちらのカードは投稿とは別のもの（外部の記事）を説明して
// いるので、投稿自身の title/text を上書きするのではなく、自分の置き場が要る。
//
// v1 の範囲 (#181)。QuotedPost.media（URL は記録するが取りには行かない）と違い、
// `thumbnail` はダウンロードする＝native-host/post-record.mts の
// LinkCardShape.thumbnailFile を参照。取得したあとホストが埋める欄。
interface LinkCard {
  // 外部ページ自身の URL＝行き先。共有された記事の URL で検索したときに、それを共有した
  // 投稿が出てくるようにするため（#181 の「なぜ」）。
  url: string | null;
  title: string | null;
  description: string | null;
  // プラットフォームが相対 URL を返しうる場面では、ここへ来る時点で絶対 URL に直して
  // ある（bookmark.ts の extractOgp と同じ作法）。実際に観測した範囲では、どの
  // プラットフォームも常に絶対の CDN URL を返してくる。プラットフォームのカードが画像を
  // 持たなければ null。
  thumbnail: string | null;
}

// #289: 投稿者のプロフィールのリンク欄の1エントリ（Mastodon/Misskey の `fields[]`、
// pixiv の `webpage`/`social.*.url`）。verifiedAt は Mastodon 自身の `verified_at`
// （そのリンクがアカウントを参照し返していることをインスタンスが確認した）。この信号を
// 持たないプラットフォーム・欄ではすべて null（Misskey の fields[] に確認の概念は無く、
// pixiv の webpage/social のエントリはただの URL）。
interface ProfileLink {
  name: string;
  value: string;
  verifiedAt: string | null;
}

// 投稿自身の本文が使う `:shortcode:` 形式のカスタム絵文字1件 (#290)。プラットフォームの
// API レスポンスが申告したもの＝出所は Misskey の note.emojis（shortcode → URL の対応表）
// と Mastodon の status.emojis[]（{shortcode, url, static_url}）の2つだけ（それぞれ実際の
// インスタンスで確認、2026-08-02）。X/Bluesky/pixiv にカスタム絵文字の概念は無く、これを
// 作ることはない。`url` は、プラットフォームが持っていれば必ず動く方の原本（Mastodon なら
// `url` で、`static_url` は使わない）＝動く絵文字は動くためのもので、#119 が動画/GIF の
// メディアを既定でポスター画像へ落とさないのと同じ。
//
// 対象は保存する投稿自身の本文だけ。引用元・返信先のサブレコードの本文も :shortcode: の
// 文字列を持ちうるが、上の QuotedPost に customEmojis の欄は無い＝#180 の
// QuotedPost.media のコメントが引いたのと同じ、「メタデータとして URL を記録するだけで、
// 隣の投稿のものは何も取りに行かない」線。
interface CustomEmoji {
  shortcode: string;
  url: string;
}

// 正規化したサイドカーのレコードの形。emptyRecord() のリテラルからの推論に任せず明示で
// 宣言しているのは、どの欄も `null` で初期化するから。TS の strict では、返り値の型を
// 書かない `return { text: null, ... }` はそうした欄を `string | null` ではなくリテラル型
// の `null` と推論するので、後続の `rec.text = j.text || null`（実際の値）がすべて型
// エラーになる。`let x = null` と同じ落とし穴が、変数宣言ではなく return 位置の
// オブジェクトリテラルで起きているだけ。
interface PostRecord {
  url: string | null;
  platform: string | null;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  avatarReferer: string | null;
  // #289: 投稿者自身のプロフィールの自己紹介、リンク欄のエントリ、バナー画像。上の
  // avatar/followers/authorCreatedAt を供給しているのと同じ、すでに取得済みのプロフィール
  // ／ステータスのレスポンスからそのまま読む（どのプラットフォームでも要求は増やさない
  // ＝#289 の 2026-08-02 の設計コメント）。レスポンスにその概念が無いプラットフォームでは
  // すべて null（Bluesky はリンク欄が無い。pixiv はバナーが無い。X は3つとも無く、埋め
  // 込み用エンドポイントは displayName/screenName/avatar しか持たない）。
  bio: string | null;
  profileLinks: ProfileLink[] | null;
  banner: string | null;
  followers: number | null;
  authorCreatedAt: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  views: number | null;
  date: string | null;
  mediaType: string | null;
  media: MediaItem[];
  lang: string | null;
  isReply: boolean | null;
  isQuote: boolean | null;
  isThread: boolean | null;
  // プラットフォーム自身の API が、この投稿は最初の公開のあとに編集されたと言っている
  // か (#189)。true になるのは、サイトが積極的にそう確認したときだけ＝今の出所は
  // Mastodon の edited_at と X の edit_control.edit_tweet_ids の2つしかない。上の
  // isReply/isQuote/isThread と同じ約束で、API に編集の信号が無いサイト（および取得が
  // 失敗したとき）は、false を推し量らず null のまま残す。
  isEdited: boolean | null;
  // 最後の編集の ISO 8601 時刻。プラットフォームがそれを名指ししているときだけ入る。
  // Mastodon の edited_at は正確な時刻を寄こす。X の edit_control には「いつ」の欄が一切
  // 無いので、X では isEdited が true でも editedAt が null のままになる＝この2つの欄は
  // 独立していて、揃って埋まる対ではない。
  editedAt: string | null;
  // 投稿者がその投稿に付けた閲覧注意の文言 (#178)。Misskey の note.cw と Mastodon の
  // spoiler_text は投稿者が書いた自由記述の欄なので、これは実質その投稿自身の言葉の一部
  // （text/title と並べて posts_fts に入れる）。null は、プラットフォームにその欄が無い
  // （X、Bluesky。下の `sensitive` を参照）か、投稿者が空のままにしたという意味。本文
  // そのものから推し量ることは一切ない。
  cw: string | null;
  // プラットフォーム自身の API が、その投稿を配慮の要る内容・成人向けとして印を付けて
  // いるか (#178)。Mastodon の `sensitive` と X の `possibly_sensitive` は API が必ず
  // 答える真偽値（true/false が実際の値＝likes/reposts と同じ約束で、isReply/isEdited が
  // 使う「null は信号が無いこと」の約束ではない）なので、この2つのプラットフォームでは
  // 取得が成功すればここが null で残ることはない。Bluesky には真偽値の欄がそもそも無い
  // ので、投稿の自己ラベル（com.atproto.label.defs#selfLabels）が成人向けの値
  // （porn/sexual/nudity/graphic-media）のどれかを含むかから導く。取得に成功して該当の
  // ラベルが無ければ false で、こちらも同じく確たる答えとして扱う。Misskey はノート単位
  // の配慮の信号を出さない（添付ファイルごとの isSensitive があるだけで、これは「この
  // 投稿が配慮を要するか」とは別の事実）＝Misskey では null のまま。
  sensitive: boolean | null;
  quotedUrl: string | null;
  replyToId: string | null;
  // #180: この投稿が引用・リノート（4つのプラットフォームすべて）か Misskey の返信
  // （中身ごと同梱される唯一の返信先）であるときの、サイドカーのサブレコード一式。それ
  // 以外の返信先はすべて null。引用・リノートでも、API のレスポンスが使える相手を寄こさ
  // なかったとき（削除済み、浅い ShallowQuote など）は null。
  quotedPost: QuotedPost | null;
  replyToPost: QuotedPost | null;
  // #179: 投稿がアンケートを持つときの、そのアンケート。プラットフォームごとの取得元は
  // 上の Poll を参照。アンケートの無い投稿はすべて null。pixiv と Bluesky のレコードも
  // すべて null（どちらのプラットフォームにも概念が無い）。
  poll: Poll | null;
  // #181: リンク共有の投稿の OGP プレビューカード。上の LinkCard を参照。リンクを共有
  // していない投稿（圧倒的多数）はすべて null。v1 では Misskey と pixiv の投稿もすべて
  // null（#181 の範囲外＝Misskey の API はカードを同梱せず、pixiv の投稿にリンクカードの
  // 概念は無い）。
  linkCard: LinkCard | null;
  // pixiv のシリーズへの所属 (#188)。この作品がどのシリーズに属し、その中で何番目か
  // （1始まり）を、illust の payload の seriesNavData から取る。シリーズに属さない作品
  // （そこでは seriesNavData 自体が null）と、シリーズの概念が無い pixiv 以外の
  // プラットフォームでは、3つとも null のまま。
  seriesId: string | null;
  seriesTitle: string | null;
  seriesOrder: number | null;
  hashtags: string[];
  tags: string[];
  // 投稿自身の :shortcode: 形式のカスタム絵文字 (#290)。出所と対象範囲は上の CustomEmoji
  // を参照。Misskey と Mastodon 以外のプラットフォームでは空。Misskey/Mastodon でも、
  // 1つも使っていない投稿では空。
  customEmojis: CustomEmoji[];
  // このレコードの取得が受け取ったレスポンス本文のすべてを、届いた順に持つ。取得の連鎖が
  // 進むにつれて増える。buildRecord() がこれをネイティブホストへ渡し、ホストがレコードの
  // raw_payloads の行へ詰める (#292)。
  raw: RawAcquisition[];
  // プラットフォームの API が投稿の情報を返さなかった理由（'protected' |
  // 'ageRestricted' | 'unavailable' | 'fetchFailed'）。取得が成功していれば null。
  // 一時的な欄で、background.ts が部分保存のバナーの文言を選ぶために読む（URL から導いた
  // screenName を「メタデータが取れた」と数えないためでもある）。buildRecord() は明示した
  // 欄しか写さないので、これがサイドカーへ届くことはない。
  metaError: string | null;
  // #239: 一般の web ページを抽出する経路で、title/description/author/published/
  // siteName/url をどれ（schema.org の形式 / OGP / Dublin Core / Highwire / 素の HTML へ
  // の退避）が埋めたか。値の語彙は extractor/web-meta.ts の WebMetaResult.metaSource を
  // 参照。プラットフォームの extractor が作るレコードではすべて null（X/Bluesky/Misskey/
  // Mastodon/pixiv はここを一切設定しない＝あちらの欄はプラットフォーム自身の API から
  // 来るもので、出所を記録する必要のある退避の連鎖ではない）。
  metaSource: Record<string, string> | null;
}

// ある extractor の parseUrl() が見分けた中身。`platform` は固定で、それ以外は、その
// サイト自身の API に投稿を尋ねるのに要るもの（tweet id、handle + rkey、インスタンスの
// ホスト + note id …）。読み返すのは同じ extractor の fetchPost() だけ。
interface ParsedPost {
  platform: string;
  [key: string]: any;
}

// プロフィール URL を見分けた結果。投稿 URL と同じく、後で API に尋ねるための値は
// 見分けた extractor だけが読み返す。
interface ParsedProfile {
  platform: string;
  url: string;
  [key: string]: any;
}

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

// Alt+S でのスクリーンショット保存。どの要素が投稿か、強調をどこに描くか、permalink は
// 何か、スクリーンショットを撮る間ページ自身の hover のスタイルをどう黙らせるか。
interface CaptureSite {
  platform: string;
  postSelector?: string;
  captureStyleText?: string;
  findPostElement?(target: EventTarget | null): Element | null;
  isPostElement?(el: Element): boolean;
  getPermalink(post: Element): string;
  getCaptureRect?(post: Element): PostRect;
  prepareForCapture?(post: Element): (() => void) | null;
  // chase モードの取り込み（Alt+Shift+S）が歩ける一覧ページをそのサイトが持ち、今まさに
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

// この絵や動画はどの投稿のものか、そしてそれ単体で保存してよいか。ページ上の保存の経路
// 2つ＝drag.ts（画像をドロップゾーンへドラッグ）と overlay.ts のホバー保存ボタン (#94) が
// どちらも読む。この2つは一致していなければならない。同じ画像でも、ボタンで押したときと
// ドラッグしたときとで別の投稿が保存されるなら、それは黙って帰属を誤ることになる。
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
  // mediaIn が絵を1枚も見つけられなかった投稿で、保存済みの印をどこに留めるか (#575)。
  // 投稿自身の投稿者アバター＝メディアの有無にかかわらずどの投稿の形にも在る唯一の要素。
  // 参照されるのは mediaIn が何も返さなかったときだけ。null（または未実装）なら、その投稿
  // には印が付かない＝これが在る前と同じ。保存の対象になることは決してない。本文だけの
  // 投稿に保存ボタンは出さず、出すのは「これはもうライブラリに在るか」の答えだけ。
  textAnchorIn?(unit: Element): Element | null;
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
  parseProfileUrl?(u: URL): ParsedProfile | null;
  // このオリジンに居るタブは、このプラットフォームの保存をサービスワーカーへ頼んでよいか。
  // ホスト名だけでなく素のタブ URL も取る。インスタンス立てのサイトには比べるべき固定の
  // ホストが無く、https であることしか要求できないから。
  isAllowedOrigin(tabUrl: string, hostname: string): boolean;
  // この extractor が接触する API のホスト。ただし、そのホストが固定ではなく投稿 URL から
  // 来る場合に限る（Misskey / Mastodon のインスタンスは任意のホストに立つ）。ホストが固定
  // のサイトにはこの防ぎが要らないので、無い。
  derivedApiHost?(parsed: ParsedPost | ParsedProfile): string | null;

  // === API 相（サービスワーカー） ===

  fetchPost(parsed: any, url: string): Promise<PostRecord>;
  fetchProfile?(parsed: ParsedProfile, url: string): Promise<PostRecord>;

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

  // 今このサイトに居るか。ホストが固定のサイトではホストの検査、インスタンス立てのサイト
  // ではページの嗅ぎ分け（どのホストも Misskey/Mastodon でありうる）。
  matchesPage(): boolean;
  extractProfilePage?(parsed: ParsedProfile): Partial<PostRecord> | null;
  capture: CaptureSite;
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

export type { CaptureSite, CustomEmoji, DomMeta, Extractor, LinkCard, MediaIdentity, MediaIdentitySite, MediaItem, OverlaySite, ParsedPost, ParsedProfile, Poll, PollChoice, PostMediaElement, PostRecord, PostRect, ProfileLink, QuotedPost, RawAcquisition };
