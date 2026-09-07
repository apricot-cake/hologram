// 共有の投稿レコードの形（#5 St2 / #295）と、その正規化の組み立て役。欠けた欄すべてを、
// 文書化された既定値で埋める唯一の場所だ。だからどの書き手が作ったレコードも、まったく
// 同じキーを持って出てくる。
//
// 今日、同じものであるはずの「イラストのレコード」（bridge.mts のコメントでの呼び名）を、
// 3か所が独立に組み立てている:
//   - native-host/bridge.mts の保存ハンドラ
//   - app/src/main/ipc-transfer.ts の import-posts（ZIP の取り込み）＝自前で手書きした
//     約30の欄。他の2つの書き手が持つ media[] と replyToId が既に欠けていることが
//     分かっている（2026-07-18 のコードベースの通し確認、#5 のコメント）
//   - Eagle 移行のコンバータ（外部ツール。このリポジトリには無い）
// 片方にだけ足した欄は、知らせを受け取らなかった経路で黙って落ちる。
// normalizePostRecord がその知らせであり、機械に守らせたものだ。
//
// 欄の集合の正本は #5 の確定したスキーマ（2026-07-18 のコメント）。この形はそのスキーマの
// 行の形であって、DB の行の形ではない。タグはここでは素の名前の文字列のままだ（ID の
// 実体への解決＝名前から tagId へ、重複除去付きは、St5/St6 でこれを DB につなぐ人にとって
// のデータベース書き込み時の関心事であり、キャプチャ時の正規化の関心事ではない）。ただし
// グリフの正規化（NFKC と trim、#197）はここで当てる。これは ID の実体の話ではなく保存の
// 流れの話だからだ。どの書き手のタグやハッシュタグもこの1つの組み立て役に集まるので、
// ここが、どの書き手の生のテキストも正規化されずにライブラリへ届かないと保証する唯一の
// 場所になる。
//
// Electron から切り離してある（node の組み込みモジュールと、このディレクトリの兄弟だけ）
// ので、native-host のランタイムでもアプリのランタイムでも、素の node で単体テストできる
// ＝native-host/post-key.mts が既に果たしているのと同じ、境界をまたぐ役割だ。
//
// St2 が作るのは型と組み立て役だけ。bridge.mts と app/src/main/ipc-transfer.ts が自前の
// 場当たりの欄の並びではなくこれを通してレコードを組み立てるようにつなぎ直すのは St5/St6
// の仕事だ（#295）。それまでこのファイルは動いていない。

import { normalizeTagNames } from './tag-normalize.mts';

export interface MediaItemShape {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  file: string;
  // 'video' | 'gif' | 'ugoira' | null（null または無しは静止画）。posterFile は、その
  // どれについても、ダウンロードした poster フレームのファイル名（#119 St1）。
  type: string | null;
  posterFile: string | null;
  // 'ugoira' のときだけ（#119 St3）。保存する zip の中でのフレームの順番と、フレーム
  // ごとの表示時間。ディスク上の2つ目のファイルではなく構造化データとして保つ。書庫
  // だけでは各フレームをどれだけの時間見せるかを言えないし、pixiv のページが消えた後、
  // ライブラリの他の何からも導き直せない。
  frames: { file: string; delay: number }[] | null;
  // 元画像を変更せず、表示範囲だけを記録する。値は元画像に対する 0..1 の正規化座標。
  crop: CropRectShape | null;
}

export interface CropRectShape {
  x: number;
  y: number;
  width: number;
  height: number;
}

// #180: 引用・リポストした投稿や返信先の投稿を、サイドカーの
// 下位レコードとして保存したもの。extension/utils/extractor/types.ts の QuotedPost を
// 写す＝欄も同じ、「URL は記録するが、メディアは決してダウンロードしない」という v1 の
// 範囲も同じ。
export interface QuotedPostShape {
  url: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  text: string | null;
  date: string | null;
  cw: string | null;
  media: MediaItemShape[];
}

// #179: 投稿のアンケートの選択肢1つと、アンケートそのもの。
// extension/utils/extractor/types.ts の PollChoice と Poll を写す＝欄も同じ、「保存時点で
// アンケートが言っていたことのスナップショットであり、投票は一切しない」という範囲も同じ。
export interface PollChoiceShape {
  text: string;
  votes: number | null;
}
export interface PollShape {
  choices: PollChoiceShape[];
  multiple: boolean | null;
  expiresAt: string | null;
}

// #181: リンク共有の投稿が持つ OGP のプレビューカード。
// extension/utils/extractor/types.ts の LinkCard を写し、`thumbnailFile` を足したもの
// ＝拡張機能が埋められない唯一の欄だ（画像をダウンロードしたホストだけが、できた
// ファイル名を知る。上の MediaItemShape.file や avatarFile と同じ分け方）。
export interface LinkCardShape {
  url: string | null;
  title: string | null;
  description: string | null;
  thumbnailFile: string | null;
}

// #289: 投稿者のプロフィールのリンク欄の項目1つ。extension/utils/extractor/types.ts の
// ProfileLink を写す。
export interface ProfileLinkShape {
  name: string;
  value: string;
}

export interface PostRecordShape {
  captureId: string;
  mediaType: string | null;
  image: string | null;
  // 画像ビューからの動画の取り込みやドラッグ保存で、ダウンロードした動画のファイル名
  // （#299: 共有の DB 書き手を切り出すのに合わせて追加した。アプリ内部の動画取り込みの
  // 経路は、既に `as any` の抜け穴でこの欄を場当たりに作っていた。共有の型にも posts
  // テーブルにも列が無かったので、DB を往復すると黙って落ちていた）。media[].file
  // （投稿に添付されたメディア）とは別物だ＝こちらはレコード自身の主となる動画で、
  // `image` の動画版にあたる。レンダラーの `image || video` という UI の取り決め
  // （records.ts ほか）はこの欄より古い。これはその取り決めのもう半分だ。
  video: string | null;
  url: string | null;
  platform: string | null;
  text: string | null;
  title: string | null;
  displayName: string | null;
  screenName: string | null;
  userId: string | null;
  avatar: string | null;
  avatarFile: string | null;
  // #289: 投稿者自身のプロフィールの自己紹介、リンク欄の項目、バナー画像＝このレコード
  // 自身のどこかに表示するのではなく、poster_profiles へ保存する。
  // プラットフォームごとの出所は extension/utils/extractor/types.ts の PostRecord.bio、
  // profileLinks、banner を参照。
  bio: string | null;
  profileLinks: ProfileLinkShape[] | null;
  banner: string | null;
  // ダウンロードしたバナーの、共有の avatars/ ストアでのファイル名（#289 の
  // "2026-08-02 バナーは実体保存する" という判断）＝上の avatarFile と同じ分け方だ。
  // ダウンロードしたホストだけがファイル名を付けられる。
  bannerFile: string | null;
  followers: number | null;
  following: number | null;
  authorCreatedAt: string | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
  views: number | null;
  date: string | null;
  capturedAt: string;
  updatedAt: string;
  // このレコードを作った取り込みの経路（'x-bookmarks' はブックマークの一括取り込み、
  // #362。将来の一括取り込みのアダプタは自前の値を足す）。null は1件ずつのふつうの
  // 保存を表す。レコードがどうやってライブラリに入ったかという事実であって、整理の
  // 構造ではない＝フォルダとタグはユーザーが作るものであり続ける（#362 の判断）。
  capturedVia: string | null;
  lang: string | null;
  isReply: boolean | null;
  isQuote: boolean | null;
  isThread: boolean | null;
  // プラットフォーム自身の API が、この投稿は編集されたと言っているか（#189）。
  // プラットフォームごとの出所は extension/utils/extractor/types.ts の
  // PostRecord.isEdited を参照＝null は「プラットフォームからの手がかりが無い」を意味し、
  // 「編集されていないと確認できた」を意味することは決してない。
  isEdited: boolean | null;
  // 投稿者が付けた content warning のテキストと、プラットフォーム自身の API がこの投稿を
  // sensitive・成人向けと印を付けているか（#178）。プラットフォームごとの出所と、null と
  // false の使い分けの約束は extension/utils/extractor/types.ts の PostRecord.cw と
  // sensitive を参照（sensitive を持つプラットフォームでは、それは手がかり無しの null
  // ではなく、はっきりした答えだ）。
  cw: string | null;
  sensitive: boolean | null;
  quotedUrl: string | null;
  replyToId: string | null;
  // #180: プラットフォーム自身の、既に取得済みの応答がまとめて持っていたときの、完全な
  // 下位レコード（プラットフォームごとの規則は QuotedPostShape と
  // extension/utils/extractor/types.ts の PostRecord.quotedPost を参照）。引用や返信でも、その相手が extractor に組み立てる材料を
  // 何も与えなかったときは null。
  quotedPost: QuotedPostShape | null;
  replyToPost: QuotedPostShape | null;
  // #179: この投稿に付いたアンケート。無い投稿ではすべて null。
  // プラットフォームごとの出所は上の PollShape と extension/utils/extractor/types.ts の
  // Poll を参照。
  poll: PollShape | null;
  // #181: リンク共有の投稿の OGP のプレビューカード＝プラットフォームごとの出所は上の
  // LinkCardShape と extension/utils/extractor/types.ts の PostRecord.linkCard を参照
  // （v1 では Bluesky と X）。リンクを共有していない投稿ではすべて null。
  linkCard: LinkCardShape | null;
  // pixiv のシリーズへの所属（#188）＝出所は extension/utils/extractor/types.ts の
  // PostRecord.seriesId、seriesTitle、seriesOrder を参照。pixiv 以外のレコードと、
  // シリーズに入っていない pixiv の作品では3つとも null。
  seriesId: string | null;
  seriesTitle: string | null;
  seriesOrder: number | null;
  hashtags: string[];
  tags: string[];
  // このレコードのどの欄が、プラットフォームの API ではなくページから来たか（#202）
  // ＝たとえば ['text','displayName','views']。API が全部答えたレコードでは空になり、
  // それが圧倒的多数だ。
  //
  // 記録する理由は、2つの出所が同じ品質ではなく、値がどちらから来たかをレコードの他の
  // 何も言わないからだ。ページから読んだ件数はサイトが表示していた丸めた形であり
  // （"1.2万" → 12000）、ページから読んだテキストは描画されていたもの、省略記号ごと
  // そのままだ。単一の目印ではなく欄の一覧として持つので、後の読み手はレコード全体を
  // 疑わずに1つの値だけに但し書きを付けられる。
  //
  // （#202 の設計コメントは「空なら省く」と言っている。ここでは代わりに無条件で書く。
  // normalizePostRecord の約束が、どの書き手も同じキーの集合を出すことだからだ
  // ＝hashtags と tags が、無しではなく常に在って空になるのと同じ理由。空の配列も
  // 「ページから埋めたものは何も無い」という同じ意味を運ぶ。）
  domFilled: string[];
  media: MediaItemShape[];
  // 複数画像の投稿のうち何枚目をこのレコードが持つか（1始まり）と、その投稿に何枚
  // あったか（#560）。埋められるのはドラッグ保存だけだ。ドラッグ保存は投稿から画像を
  // 1枚取り出し、その media[] はそのファイルだけを持つので、元の投稿でのその画像の
  // 位置は後からレコードでは辿れない。他の経路はどれも投稿の画像をまとめて保存し、
  // そこでは media[] の順番が既に元の順番そのもので「何枚目」に意味は無い。それらは
  // 両方 null のままにする。画像が1枚の投稿も同じだ。
  imageIndex: number | null;
  imageCount: number | null;
  eagleName: string | null;
  source: string | null;
  shotW: number | null;
  shotH: number | null;
  // #8: カードの画像（shotW と shotH が言うのと同じファイル）がアニメーション webp か
  // ＝app/src/main/lib-card-dims.ts の fillCardDims と、records.ts の imgW の例外扱いを
  // 参照。add-post-shot-animated の移行より前に書かれた行ではすべて null。shotW と
  // shotH 自身と同じ約束だ。
  shotAnimated: boolean | null;
  // #162: レコードごとのメディアのサイズの集計（media[] 全体での最大値。media[] が空の
  // ときはカードの画像に退避する＝書き込み時の実測は app/src/main/lib-media-dims.ts を
  // 参照。shotW と shotH 自身の約束をここでも写している）。保存フォルダを手元に持つ
  // 書き手が実測するまでは null。0は「実測したが、サイズと言えるものが無い」を意味する
  // （動画だけのレコードや、読めないヘッダ）。shotW と shotH と同じ番兵だ。
  mediaMaxW: number | null;
  mediaMaxH: number | null;
  mediaMaxBytes: number | null;
  trashedAt: string | null;
  // このレコードが置き換える相手の captureId（#34）。二重保存の警告にユーザーが
  // 「置き換える」と答えたときに書かれる。ふつうの保存ではすべて null。
  //
  // これは印であって、動作ではない。Native Messaging ホストは1度きりの書き込みしか
  // しない（既存のファイルを変更も削除もしない）ので、デスクトップアプリを閉じたまま
  // 取ったキャプチャは、自分では何もゴミ箱へ移せない。印を使い切るのはアプリの側だ
  // ＝古いキャプチャをゴミ箱へ移し、そのタグを統合し、フォルダと手動グループへの所属を
  // 付け替え、済んだらこの欄を消す（app/src/main/lib-db-replaces.ts）。それまで2つの
  // レコードはただ共存する。それは、この機能がまったく無かった場合のライブラリと同じ
  // 状態だ。
  replaces: string | null;
  // #239: 対応サイト外の画像を右クリックで保存する際に読むページ文脈で、
  // title・description・author・published・siteName・url を埋めたのがどの規約か
  // （schema.org format / OGP / Dublin Core / Highwire / 素の HTML への退避）＝値の語彙は
  // extension/utils/extractor/web-meta.ts の WebMetaResult を参照。プラットフォームの
  // extractor が作ったレコードではすべて null（あちらの欄は退避の連鎖ではなく、その
  // プラットフォーム自身の API から来る）。v1 はこれを保存するだけで、まだ読む UI は無い
  // （設計コメント7）。
  metaSource: Record<string, string> | null;
}

// 書き手が渡してよい欄すべて。全部が省略可能で、欠けたものは組み立て役が補う。captureId
// は、どの書き手も自分で計算する唯一の欄で（bridge.mts では uniqueBase から、
// app/src/main/ipc-transfer.ts では時刻と連番から）、同じ理由でここでは必須にしてある。
//
// `media` を書き下してあるのは、素の Partial<> が浅いからだ。あれだと項目そのものが完全な
// MediaItemShape になってしまい、そんなものを渡した書き手は1つも無い。下の normMedia()
// が各要素を `unknown` から読んで残りを埋めていて、実在の2つの書き手はそれに頼っている。
// ブリッジはダウンローダが確定したものを渡し（poster フレームが無ければ `posterFile` は
// 無い）、ドラッグの経路は `{ url, file }` だけを渡す。このモジュール群が CommonJS
// だった間、この食い違いは見えなかった。tsc がそこから export を読めず、モジュールを
// またぐ呼び出しがすべて `any` の型になっていたからだ（#1052）。
export type PostRecordInput = Partial<Omit<PostRecordShape, 'captureId' | 'media'>> & {
  captureId: string;
  media?: Partial<MediaItemShape>[];
};

function normStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}
function normNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function normBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
function normStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
// #239: 欄の名前から出所の文字列への素の map（quotedPost や poll や linkCard のような
// 下位レコードではない）＝形の壊れた入力は、絞り込んだオブジェクトではなく null になる
// （出所の記録がまるごと無い状態）。一部のキーしか信用できない metaSource は、まったく
// 無いのと同じだけしか安全でないからだ。
function normMetaSource(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val) out[k] = val;
  }
  return Object.keys(out).length ? out : null;
}
// #180: QuotedPostShape は、下の normFrames のフレームの表と同じく、全部か無しかだ
// ＝形の壊れた下位レコード（オブジェクトでない）は、半分埋まったものではなく null に
// なる。テキストも投稿者も無い中途半端な下位レコードは、プラットフォームが使えるものを
// 何も渡さなかったと認めるより値打ちが無いからだ。
function normQuotedPost(v: unknown): QuotedPostShape | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const q = v as Record<string, unknown>;
  return {
    url: normStr(q.url),
    displayName: normStr(q.displayName),
    screenName: normStr(q.screenName),
    userId: normStr(q.userId),
    avatar: normStr(q.avatar),
    text: normStr(q.text),
    date: normStr(q.date),
    cw: normStr(q.cw),
    media: normMedia(q.media),
  };
}

// #179: 上の normQuotedPost と同じく全部か無しかだ。読める選択肢の一覧が無いアンケートは
// アンケートではないし、空のものは誰にも答えようがない調査として描画されてしまう。壊れた
// 選択肢が1つあってもアンケート全体を失敗にはせず、その選択肢だけを落とす（normFrames
// とは違う。あちらは項目1つの壊れがそれ以降のフレームすべての対応をずらす。選択肢に
// そういう項目間の依存は無い）。ただしテキストの無い選択肢は、ラベルの無い棒として残さず
// 落とす。
function normPoll(v: unknown): PollShape | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  if (!Array.isArray(p.choices)) return null;
  const choices: PollChoiceShape[] = [];
  for (const c of p.choices) {
    if (!c || typeof c !== 'object') continue;
    const { text, votes } = c as Record<string, unknown>;
    if (typeof text !== 'string' || !text) continue;
    choices.push({ text, votes: normNum(votes) });
  }
  if (!choices.length) return null;
  return { choices, multiple: normBool(p.multiple), expiresAt: normStr(p.expiresAt) };
}

// #181: normQuotedPost と同じく `url` について全部か無しかだ。行き先のリンクが無い
// カードはリンクカードではない（要点はリンク先の記事そのものだ。#181 の Why）。ただし
// title と description と thumbnailFile はそれぞれ独立に省略できる。サムネイルの
// ダウンロードの失敗はできる範囲での話であり（media や avatar や customEmojis と同じ
// 約束）、それでカード自身の検索できるテキストを落としてはいけない。
function normLinkCard(v: unknown): LinkCardShape | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = v as Record<string, unknown>;
  const url = normStr(c.url);
  if (!url) return null;
  return { url, title: normStr(c.title), description: normStr(c.description), thumbnailFile: normStr(c.thumbnailFile) };
}

// #289: 項目ごとに全部か無しかだ（下の normCustomEmojis と同じ）。name か value の無い
// リンクはリンクではない。空のときは欄まるごとが null になる（[] ではない）。
// poster_profiles でのリンク自身の「空の一覧ではなく、欄が無い」という約束に揃えてある
// （JSON の null の列であって、'[]' ではない）。
function normProfileLinks(v: unknown): ProfileLinkShape[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: ProfileLinkShape[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') continue;
    const { name, value } = e as Record<string, unknown>;
    if (typeof name !== 'string' || !name || typeof value !== 'string' || !value) continue;
    out.push({ name, value });
  }
  return out.length ? out : null;
}

function normMedia(v: unknown): MediaItemShape[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
    .map((m) => ({
      url: typeof m.url === 'string' ? m.url : '',
      alt: normStr(m.alt),
      width: normNum(m.width),
      height: normNum(m.height),
      file: typeof m.file === 'string' ? m.file : '',
      type: normStr(m.type),
      posterFile: normStr(m.posterFile),
      frames: normFrames(m.frames),
      crop: normalizeCropRect(m.crop),
    }));
}

export function normalizeCropRect(v: unknown): CropRectShape | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const x = normNum(r.x);
  const y = normNum(r.y);
  const width = normNum(r.width);
  const height = normNum(r.height);
  if (x == null || y == null || width == null || height == null) return null;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return null;
  return { x, y, width, height };
}
// フレームの表は全部か無しかだ。壊れた項目が1つあると、それ以降のフレームすべてが
// 自分の画像とずれる。だから壊れた一覧は、絞り込んだものではなく null になる。
function normFrames(v: unknown): { file: string; delay: number }[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const out: { file: string; delay: number }[] = [];
  for (const f of v) {
    if (!f || typeof f !== 'object') return null;
    const { file, delay } = f as Record<string, unknown>;
    if (typeof file !== 'string' || !file || typeof delay !== 'number' || !Number.isFinite(delay)) return null;
    out.push({ file, delay });
  }
  return out;
}

// #290: 上の normFrames と同じく、項目ごとに全部か無しかだ。壊れた項目（shortcode か
// url が無い）は、半分埋まったまま残さず落とす。画像の URL が無い shortcode は何の
// 値打ちも無いからだ（どちらにせよ表示側には出せる画像が無い）。`file` は書き手が渡した
// ものをそのままにする（拡張機能が組み立てた入力ではすべて null。ブリッジがダウンロードの
// 後に埋める。MediaItemShape.file と同じ分け方）。
// ライブラリが動く画像を保存するときのファイル拡張子＝<img src> では決して描画できない
// ファイルだ。レンダラーはこの一覧を import せず自前の写しを持つ（records.ts の
// isVideoFile）。このモジュールには Node.js 向けの正規化処理も含むため、レンダラーの
// バンドルに入れない。形式を足すときは、2つの一覧に必ず一緒に足す。
const VIDEO_FILE = /\.(mp4|webm|mov|m4v)$/i;
export function isVideoFileName(name: string | null | undefined): boolean {
  return typeof name === 'string' && VIDEO_FILE.test(name);
}

// ライブラリはこの投稿について、そのパーマリンクが既に言っていること以上の何かを持って
// いるか。platform も screenName も（X では）投稿の日付も、URL だけから導ける。だから
// それ以外に何も運ばないレコードは空の抜け殻だ。見せるものが無く、後で保存し直せば同じ
// だけ得られないものも無い。
//
// これは、一致していなければならない2つの判断（#492）の裏にある1つの規則だ。ブリッジ
// はそういうレコードを書くのを拒み、「保存済み」の印はそういうレコードについて答えるのを
// 拒む。この2つがずれれば、ライブラリが何も持っていない投稿に印が付いたままになり、
// 以降の取り込みはどれもその投稿を飛ばす。失敗が成功として記録されたからこそ、その失敗が
// 恒久になる。
//
// テキストだけの投稿は空ではない（#365）。そのテキストが中身だからだ。メディアが全部
// ダウンロードに失敗しても投稿者とテキストが届いた投稿も空ではない＝得られたものには
// まだ残す値打ちがあり、保存し直せば残りを足せる。
//
// #181: リンク共有の投稿自身の linkCard も数に入る。付け加えた文の無い素のリンク共有
// （text は null、添付メディアも無い＝カードが投稿まるごとだ。#181 の Why:
// "カードが投稿の見た目の主役なのにデータとして何も残らない"）を、他に何も埋まらなかった
// というだけで空の抜け殻と読んではいけない。
export function recordHoldsContent(record: Partial<PostRecordShape> | null | undefined): boolean {
  if (!record) return false;
  if (normStr(record.image) || normStr(record.video) || normStr(record.text) || normStr(record.title) || normStr(record.displayName)) return true;
  if (Array.isArray(record.media) && record.media.length > 0) return true;
  return !!(record.linkCard && normStr(record.linkCard.url));
}

// `input` のすべての欄を、文書化された既定値で埋める。now は差し替えられる（テストは
// 固定した時点を渡す）。本番の呼び出し側はこれを省いて実物の時計を得る。
// extension/metadata.ts の toIso() の呼び出し側や、これが置き換える
// app/src/main/ipc-transfer.ts の `|| new Date().toISOString()` の退避と同じだ。
export function normalizePostRecord(input: PostRecordInput, now: () => string = () => new Date().toISOString()): PostRecordShape {
  const capturedAt = normStr(input.capturedAt) || now();
  // `image` は静止画の枠であり、そこに動画のファイル名が入るとレコードは端から端まで
  // 表示できなくなる（#496）。どの読み手も image を静止画として扱うので、カードも詳細の
  // 表示も mp4 を <img> に渡して何も描かない。一方で、その投稿の poster フレームは
  // ダウンロード済みでディスクに在るのに、それを指す欄が無くなり、代わりに宙に浮いた
  // メディアとして現れる。#377 より前の一括取り込みの保存は、まさにこの形を書いていた。
  //
  // 移し先は当て推量ではない。`video` は `image` の動く画像側の半分であり
  // （PostRecordShape.video を参照）、その読み手はどれも <img> では見せられないファイル
  // を既に期待している。だからレコードは、ファイルへの唯一の手がかりを失う代わりに、
  // 表示できるまま残る。この処理がここに在るのは、writePost が DB へ入るすべての
  // レコードを正規化するからだ＝どの書き手がレコードを作ったのであれ、posts.image が
  // 通るゲートはここ1つだ。
  const rawImage = normStr(input.image);
  const imageIsVideo = isVideoFileName(rawImage);
  return {
    captureId: input.captureId,
    mediaType: normStr(input.mediaType),
    image: imageIsVideo ? null : rawImage,
    // 明示された `video` が勝つ。両方を埋めた書き手は、どのファイルを指しているかを
    // 言っているし、置き場所を間違えた方はどちらにせよ静止画ではない。
    video: normStr(input.video) || (imageIsVideo ? rawImage : null),
    url: normStr(input.url),
    platform: normStr(input.platform),
    text: normStr(input.text),
    title: normStr(input.title),
    displayName: normStr(input.displayName),
    screenName: normStr(input.screenName),
    userId: normStr(input.userId),
    avatar: normStr(input.avatar),
    avatarFile: normStr(input.avatarFile),
    bio: normStr(input.bio),
    profileLinks: normProfileLinks(input.profileLinks),
    banner: normStr(input.banner),
    bannerFile: normStr(input.bannerFile),
    followers: normNum(input.followers),
    following: normNum(input.following),
    authorCreatedAt: normStr(input.authorCreatedAt),
    likes: normNum(input.likes),
    reposts: normNum(input.reposts),
    replies: normNum(input.replies),
    bookmarks: normNum(input.bookmarks),
    views: normNum(input.views),
    date: normStr(input.date),
    capturedAt,
    updatedAt: normStr(input.updatedAt) || capturedAt,
    capturedVia: normStr(input.capturedVia),
    lang: normStr(input.lang),
    isReply: normBool(input.isReply),
    isQuote: normBool(input.isQuote),
    isThread: normBool(input.isThread),
    isEdited: normBool(input.isEdited),
    cw: normStr(input.cw),
    sensitive: normBool(input.sensitive),
    quotedUrl: normStr(input.quotedUrl),
    replyToId: normStr(input.replyToId),
    quotedPost: normQuotedPost(input.quotedPost),
    replyToPost: normQuotedPost(input.replyToPost),
    poll: normPoll(input.poll),
    linkCard: normLinkCard(input.linkCard),
    seriesId: normStr(input.seriesId),
    seriesTitle: normStr(input.seriesTitle),
    seriesOrder: normNum(input.seriesOrder),
    // NFKC と trim（#197）＝どの書き手のハッシュタグとタグも通る、保存の流れの合流点だ
    // （取込キュー、ZIP の取り込み、宙に浮いたものの復旧）。domFilled は素の
    // normStrArray のままにする。あれは欄の名前の識別子であって、タグのテキストではない。
    hashtags: normalizeTagNames(input.hashtags),
    tags: normalizeTagNames(input.tags),
    domFilled: normStrArray(input.domFilled),
    media: normMedia(input.media),
    imageIndex: normNum(input.imageIndex),
    imageCount: normNum(input.imageCount),
    eagleName: normStr(input.eagleName),
    source: normStr(input.source),
    shotW: normNum(input.shotW),
    shotH: normNum(input.shotH),
    shotAnimated: normBool(input.shotAnimated),
    mediaMaxW: normNum(input.mediaMaxW),
    mediaMaxH: normNum(input.mediaMaxH),
    mediaMaxBytes: normNum(input.mediaMaxBytes),
    trashedAt: normStr(input.trashedAt),
    replaces: normStr(input.replaces),
    metaSource: normMetaSource(input.metaSource),
  };
}
