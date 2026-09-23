import { ExtractedPostSchema } from '../../../native-host/protocol.mts';
import { XProfileUrlsSchema, XPostSchema, XMediaSchema, XQuotedSchema, DecimalCountSchema, CardStringBindingSchema, CardImageBindingSchema, rethrowContractError } from './api-schemas.ts';
// X（旧 Twitter）。
//
// API は cdn.syndication.twimg.com（非公式の埋め込み用 JSON。CORS が制限されているので
// host_permissions が要る）。公開された公式 API は無い＝取れるのは
// いいね/返信/本文/投稿者/日時/メディアだけで、リポスト/ブックマーク/表示回数は取れない。

import { anySrc, findAncestorContainerLink, hostnameMatches, mediaHostIs, parseMediaUrlPath } from './dom.ts';
import { parseCount } from './dom-meta.ts';
import { emptyRecord, normalizeHashtags, readJsonResponse, toIso } from './record.ts';
import type { DomMeta, Extractor, LinkCard, MediaIdentity, MediaItem, Poll, PostMediaElement, PostRecord, QuotedPost } from './types.ts';

const HOSTS = ['x.com', 'twitter.com'];

// 投稿のメディアのパスの許可リスト。ホストだけで判定することは決してしない。pbs.twimg.com は
// アバター（profile_images/）やリンクカードのプレビュー（card_img/）も配信していて、
// アバターに保存ボタンを出すことこそ #94 がしてはいけないこと。動画と GIF の投稿は、
// ポスターのコマを media/ ではなく *_video_thumb/ のパスに置く。だからほとんどの動画の投稿で
// ボタンが出ていなかった (#372)。下の項目はどれも、並べる前に実際の X で数えた（2026-07-28）
// ＝`filter:videos` で amplify_video_thumb/ と ext_tw_video_thumb/、GIF の投稿で
// tweet_video_thumb/。3つとも投稿自身の videoPlayer の箱の中にあり、アバターやカードの上に
// 現れることは無かった。
const POST_MEDIA_PATHS = ['media', 'amplify_video_thumb', 'ext_tw_video_thumb', 'tweet_video_thumb'];
const POST_MEDIA_PATH_PREFIXES = POST_MEDIA_PATHS.map((p) => `/${p}/`);
// 同じ許可リストを、メディアキーのパスの捕捉として持つ。1度だけ組み立てる＝mediaKey は
// オーバーレイの走査1回につき絵ごとに走るから。
const POST_MEDIA_KEY = new RegExp(`pbs\\.twimg\\.com/(${POST_MEDIA_PATHS.join('|')})/([^/.?:]+)`);

// === DOM ===

interface XPostLink {
  url: string;
  screenName: string | null;
  postId: string;
}

function getXPostLink(post: Element): XPostLink | null {
  const links = post instanceof Element ? Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) : [];

  // 時刻のアンカーを優先し、それが無ければ素の /user/status/<id> のアンカーを採る。
  // article の中で最初に出てくる /status/ のリンクは、/photo/N や /analytics のことがある。
  const preferredLink =
    links.find((link) => link.querySelector('time')) ||
    links.find((link) => {
      try {
        return /^\/[^/]+\/status\/\d+\/?$/.test(new URL(link.href, location.origin).pathname);
      } catch (error) {
        rethrowContractError(error);
        return false;
      }
    }) ||
    links[0];
  return preferredLink ? parseXPostLink(preferredLink.href) : null;
}

function parseXPostLink(href: string): XPostLink | null {
  try {
    const url = new URL(href, location.origin);
    let match = url.pathname.match(/^\/([^/]+)\/status\/([^/?#]+)/);
    if (match) {
      const screenName = match[1];
      const postId = match[2];
      if (screenName === undefined || postId === undefined) return null;
      return {
        // 正規の permalink。/photo/N、/analytics、クエリ、ハッシュを落とす。素の href は
        // たまたま選ばれたアンカーのものでしかない。
        url: `${url.origin}/${screenName}/status/${postId}`,
        screenName: decodeURIComponent(screenName),
        postId: decodeURIComponent(postId),
      };
    }

    match = url.pathname.match(/^\/i\/web\/status\/([^/?#]+)/);
    if (!match) {
      return null;
    }
    const postId = match[1];
    if (postId === undefined) return null;

    return {
      url: `${url.origin}/i/web/status/${postId}`,
      screenName: null,
      postId: decodeURIComponent(postId),
    };
  } catch (error) {
    rethrowContractError(error);
    return null;
  }
}

// 写真のビューア（ライトボックス）。絵をクリックすると URL バーに
// /<user>/status/<id>/photo/<n> が積まれ、その絵が独自のモーダルの層に描かれる。この部分木は
// タイムラインの article[data-testid="tweet"] の中には無い。これが #325 のすべて＝他のどの
// X の投稿も見つける祖先の遡りが、絵からモーダルを素通りして <article> に出会わないまま
// <body> まで行ってしまい、強調が出ず、クリックしてもどの投稿にも解決しなかった。
//
// ビューアが開いている間、投稿 ID が来るのもこのパスからで、URL バーにこの形を積むのは
// ビューアだけ。
const X_PHOTO_VIEWER_PATH = /^\/[^/]+\/status\/\d+\/photo\/\d+/;

// 写真のビューアが今見せている絵。絵そのもの（el が <img>/<video>）でも、それを含む包みでも
// 受け付ける。2つ目の形は机上のものではない。X は絵の上に、下へスワイプして閉じるための
// 当たり判定（`div[data-testid="swipe-to-dismiss"]`）を、<img> の数段上の祖先として重ねて
// いて、クリックやホバーの走査の単位が実際に着地するのはそこ。素の要素だけを受け付けて
// いた（ここの元の形）ときは、選択のクリックが包みに落ちて何にも解決しなかった＝下の
// オーバーレイの分岐が描いた強調と、その後に人が押したクリックとで、ポインタの下に何が
// あるかの答えが食い違っていた (#582)。
//
// 返すのは解決した絵そのもので、包み側は決して返さない。それが、保存する矩形をその絵自身の
// 箱にしている。モーダルは視野いっぱいに広がるが、送りの矢印も返信の列も暗くした背景も投稿の
// 一部ではない。permalink はその後、getPermalink の URL バーへの退避から来る。あちらは
// すでに /photo/<n> を落として投稿まで刈り込む。
//
// ビューアの中で保存できるものは他に無い。閉じるボタンと背景は絵を含まないし、投稿者の
// アバターは <img> なので URL バーが何の問題もなく投稿へ帰属させてしまう＝だからここでも、
// ホバー保存ボタンが門を張るのと同じ CDN のパスの許可リスト (#94) が判断する。
function findXViewerMedia(el: Element): Element | null {
  if (!X_PHOTO_VIEWER_PATH.test(location.pathname)) return null;
  const found = el.tagName === 'IMG' || el.tagName === 'VIDEO' ? el : el.querySelector('img, video');
  return found && x.mediaIdentity?.isPostMedia(found as PostMediaElement) ? found : null;
}

// === DOM: 投稿についてページが出しているもの (#202) ===
//
// 埋め込み用 API が何も答えない投稿のための、投稿情報の第2の出所。X では実測で、実ライブラリ
// の4.7%（951件のうち年齢制限が31件、鍵付きが14件。2026-07-29 に計測）がそれに当たり、
// そのどれもが、保存している当人の画面には完全に描かれている。埋め込み用 API がそもそも欄を
// 持たない3つの数（このファイルの冒頭を参照）もここが埋める。あの3つは、取得が成功したか
// どうかによらず、すべての X のレコードで欠けている。
//
// 以下はどれも投稿要素の中だけを引く。ここで document 全体を引けば、隣の投稿の本文をこの
// レコードへ帰属させてしまう。セレクタが当たらなくなるのは代償が無い（欄は API が残した
// ままになる）が、間違ったキャプションは黙ったまま永久に間違い続ける。

// 引用カードは、別の投稿の中に描かれた投稿。その本文も投稿者も時刻も、引用した側の article の
// 部分木の中にあり、そのどれもが別の投稿のもの。`[data-testid="quoteTweet"]` は、X がその
// testid を出す場合の名指し。`div[role="link"]` は昔から変わらない形（カードは引用元の投稿への
// 大きなリンク1つ）で、testid を持たない描画を捕まえるのがこちら。当てすぎる方向が安全＝広す
// ぎる規則は何も埋めないだけだが、狭すぎる規則は別の投稿の言葉を埋めてしまう。
const X_QUOTE_CARD = '[data-testid="quoteTweet"], div[role="link"]';

// 埋め込んだカードではなく、この投稿自身に属する最初の一致。
function xOwn(post: Element, selector: string): Element | null {
  return xOwnAll(post, selector)[0] ?? null;
}

function xOwnAll(post: Element, selector: string): Element[] {
  return [...post.querySelectorAll(selector)].filter((el) => {
    let inCard = false;
    for (let n: Element | null = el.parentElement; n && n !== post; n = n.parentElement) {
      if (n.matches?.(X_QUOTE_CARD)) {
        inCard = true;
        break;
      }
    }
    return !inCard;
  });
}

// 人が読むとおりの投稿の本文。絵文字は <img alt="😀">、改行は <br> なので、textContent だけ
// では両方を黙って落としてしまう。<svg> の部分木は丸ごと飛ばす。認証の印やアイコンがそこに
// 在り、その <title> のテキスト（「Verified account」）は飾りであって、書かれたものの一部
// ではない。
function xReadText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (tag === 'svg') continue;
    if (tag === 'img') out += child.getAttribute('alt') || '';
    else if (tag === 'br') out += '\n';
    else out += xReadText(child);
  }
  return out;
}

// エンゲージメントの操作部品1つ分の数。まず描かれた数字を読み、aria-label は次に読む。
// ラベルはブラウザの UI の言語で書かれた文（「1,234 Likes」／「いいね 1,234件」）で、数の
// 位置が言語ごとに違うから。そこから読むのは退避であって、原則ではない。
//
// X がそもそも描かない数（0 は隠す）は 0 ではなく null になる。ここでは「誰もいいねして
// いない」と「ページが言わなかった」を見分けられないし、レコードに手を触れずに済む答えが
// null だから。
function xControlCount(control: Element | null): number | null {
  if (!control) return null;
  const shown = control.querySelector('[data-testid="app-text-transition-container"]');
  // この容れ物は、X の数が変わるアニメーションの間だけ、数字の写しを2つ重ねて持つ
  // （そのアニメーションのためにこの容れ物が在る）。そのとき全体を読むと、`12` と `13` が
  // 継ぎ合わさって1213になる。最初に描かれている面は本物の2つの値のどちらかで、繋げた
  // ものはどちらでもない。
  const face = shown?.firstElementChild ?? shown;
  const direct = parseCount(face ? xReadText(face) : '');
  if (direct != null) return direct;
  const label = control.getAttribute('aria-label') || '';
  const run = label.match(/\d[\d.,  ]*[KkMmBb万億兆]?/);
  return run ? parseCount(run[0]) : null;
}

// 数ごとの testid を、両方の綴りで持つ。閲覧者がその投稿に対して動作すると、X は操作部品の
// testid を切り替える（like → unlike）。動作前の綴りしか知らない一覧は、まさに人が
// ブックマークする投稿で空になってしまう。
const X_COUNT_CONTROLS: ReadonlyArray<readonly ['replies' | 'reposts' | 'likes' | 'bookmarks', readonly string[]]> = [
  ['replies', ['reply']],
  ['reposts', ['retweet', 'unretweet']],
  ['likes', ['like', 'unlike']],
  ['bookmarks', ['bookmark', 'removeBookmark']],
];

function extractXDomMeta(post: Element): DomMeta {
  const meta: DomMeta = {};
  if (!(post instanceof Element)) return meta;

  const textEl = xOwn(post, '[data-testid="tweetText"]');
  // テキストのノードがまったく無いのは正常な状態であって、失敗ではない。画像だけの投稿に
  // キャプションは無いし、間に挟まる注意画面は本文を伏せたまま投稿を描くことがある。どちらに
  // せよ何も書かない。ここで空文字を入れると、本文を取り落としたテキストの投稿と見分けが
  // 付かなくなる。
  if (textEl) meta.text = xReadText(textEl);

  // 投稿者の塊。最初のリンクが表示名で、`@handle` と読めるものがスクリーンネーム。改装以来
  // X がそこに描き続けている2つのアンカーで、タイムラインの行で表示名を持つ唯一の場所。
  const nameEl = xOwn(post, '[data-testid="User-Name"]');
  if (nameEl) {
    for (const link of nameEl.querySelectorAll('a')) {
      const label = xReadText(link).trim();
      if (!label) continue;
      if (label.startsWith('@')) meta.screenName ??= label.slice(1);
      else meta.displayName ??= label;
    }
  }

  // <time datetime> はすでに ISO。人間向けの面（`10h`、`1月2日`）はロケール依存なので、
  // 解析することは決してない。
  const timeEl = xOwn(post, 'time[datetime]');
  if (timeEl) meta.date = toIso(timeEl.getAttribute('datetime'));

  for (const [field, testids] of X_COUNT_CONTROLS) {
    const control = xOwn(post, testids.map((t) => `[data-testid="${t}"]`).join(','));
    const n = xControlCount(control);
    if (n != null) meta[field] = n;
  }
  // 表示回数は testid の付いたボタンではなく analytics のリンクにぶら下がる。アクションバーの
  // 中で、閲覧者が押せる操作部品ではない唯一の数だから。
  const views = xControlCount(xOwn(post, 'a[href*="/analytics"]'));
  if (views != null) meta.views = views;

  return meta;
}

// ブックマークの一覧、そしてそれだけ。現行 UI は /i/history、旧 UI とフォルダは
// /i/bookmarks と /i/bookmarks/<folderId>。/i/history/likes、検索、その他の一覧ページを
// 対象にしないのは意図してのこと。chase モードの取り込み (#362) が歩くのは利用者が
// 自分で集めた一覧であって、X が組み上げた一覧ではない。
function isXBookmarksPage(): boolean {
  return /^\/i\/bookmarks(\/|$)/.test(location.pathname) || /^\/i\/history\/?$/.test(location.pathname);
}

// === API ===

function xToken(id) {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

// tweet の ID 自身から復号した投稿日時（snowflake＝22 ビット目より上に、Twitter の紀元から
// のミリ秒が入る）。でっち上げではなく正確で、埋め込み用 API が何も返さないとき（鍵付き
// アカウント・年齢の門・削除済み）にも残る。snowflake 以前の ID（連番。約 3e10 未満、
// 2010-11-04 より前）は時刻を符号化していない。> 4e10 の防ぎがそれらを退け、上限の方は、
// 復号すると未来になるような出鱈目を退ける。
const X_EPOCH_MS = 1288834974657n;
function xSnowflakeDate(id) {
  try {
    const n = BigInt(String(id));
    if (n <= 40000000000n) return null;
    const ms = Number((n >> 22n) + X_EPOCH_MS);
    if (ms > Date.now() + 60000) return null;
    return new Date(ms).toISOString();
  } catch (error) {
    rethrowContractError(error);
    return null;
  }
}

// 本文の中の t.co の短縮リンクを、entities.urls が申告する URL へ置き換える (#189)。j.text は
// どのリンクも短縮したまま持つので、保存した本文に対して検索や URL の問い合わせを掛けても
// t.co しか見えない。そしてリダイレクトが死ねば、それは何にも解決しなくなる。使うのは
// expanded_url で、display_url は決して使わない。X は後者を画面の幅に合わせて切り詰めるが
// （`en.wikipedia.org/wiki/…`）、全文検索と URL の問い合わせのために保存する値にそれが起きて
// はいけない（#189 自身の言葉＝元の URL／元のドメイン）。
//
// entities.urls[].indices ではなく、素の t.co の文字列で split/join する。indices は Twitter
// 自身が元の本文に対して数えた文字位置で、サロゲートペアの数え方も独自にある。一方、短縮 URL
// そのものは一意で曖昧さの無い部分文字列＝それで突き合わせれば位置の計算が要らないし、先の
// 置き換えで文字列の長さが変わってもずれようがない。
function xExpandUrls(text: string, entities): string {
  const urls = entities && Array.isArray(entities.urls) ? entities.urls : [];
  let out = text;
  for (const u of urls) {
    if (!u || typeof u.url !== 'string' || typeof u.expanded_url !== 'string') continue;
    out = out.split(u.url).join(u.expanded_url);
  }
  return out;
}

// X 自身の編集の履歴が2件以上あるか (#189)。edit_control.edit_tweet_ids は各版の tweet ID を
// 古い順に並べたもので、一度も編集されていない tweet では自分の ID が唯一の項目になる。
// このオブジェクトのどこにも「いつ」の欄は無い（editable_until_msecs は
// 未来の締切であって、過去の編集時刻ではない）ので、ここが答えられるのは可否の半分だけ。
function xWasEdited(editControl): boolean {
  const ids = editControl && Array.isArray(editControl.edit_tweet_ids) ? editControl.edit_tweet_ids : null;
  return !!ids && ids.length > 1;
}

// X のアンケートは tweet の欄ではなく、リンクプレビューと同じ仕組みの旧来のカード。card.name
// は 'poll<N>choice_text_only'（X 自身のカードの目録には '_image' の変種もあり、同じ接頭辞で
// 当たる）で、値はどれも card.binding_values の中に型付きの箱＝{string_value|boolean_value,
// type} として入っている。だからここでの読み出しは1回につき箱を1つ開ける。2026-08-02 に
// cdn.syndication.twimg.com で実測（tweet 1604617643973124097）＝choice1_label/choice1_count
// … choiceN_*、end_datetime_utc、counts_are_final、duration_minutes、
// last_updated_datetime_utc。
//
// 票数は数値ではなく10進の文字列（`10063044`）で届く。ここで Number() を掛け、レコードが他の
// どのプラットフォームの集計とも同じ数値の型を持つようにする。
//
// X が報告しているのに、あえて保存しない欄が2つ:
//   - counts_are_final＝「集計が動かなくなった」。これは end_datetime_utc とレコードの
//     capturedAt を比べればすでに答えが出る（types.ts の Poll.expiresAt）。
//   - duration_minutes＝アンケートの長さ。終了時刻と投稿自身の日時から復元できる。
// X に複数選択のアンケートの欄はそもそも無いので `multiple` は null のまま（信号が無い）。
const X_POLL_CARD = /^poll\d+choice/;

function xCardString(bindings, key: string): string | null {
  const v = bindings && bindings[key];
  return v == null ? null : CardStringBindingSchema.parse(v).string_value || null;
}

function xPoll(card): Poll | null {
  if (!card || typeof card.name !== 'string' || !X_POLL_CARD.test(card.name)) return null;
  const bindings = card.binding_values;
  if (!bindings || typeof bindings !== 'object') return null;
  const choices: { text: string; votes: number | null }[] = [];
  // カードは選択肢を choice1..choiceN と名付けるが、ループを打ち切るための個数の欄は無い。
  // card.name の中の数字は信じず、最初にラベルが欠けたところで止める。あの数字はカードの
  // ひな形を説明するもので、そのカードが実際に何を持っているかではない。
  for (let i = 1; ; i++) {
    const label = xCardString(bindings, `choice${i}_label`);
    if (label === null) break;
    const count = xCardString(bindings, `choice${i}_count`);
    choices.push({ text: label, votes: DecimalCountSchema.parse(count) });
  }
  if (!choices.length) return null;
  return { choices, multiple: null, expiresAt: toIso(xCardString(bindings, 'end_datetime_utc')) };
}

// #181: リンクプレビューのカードは、xPoll が読むのと同じ旧来のカードの仕組みの、アンケート
// ではない方の兄弟（あの関数のコメントを参照）。X はこの形式を一度も公開していないので、
// このファイルが叩くのと同じ cdn.syndication.twimg.com のエンドポイントを読む、独立した
// オープンソースの実装いくつかと突き合わせて確かめた（github.com/FxEmbed/FxEmbed、
// github.com/zernonia/tweetic、github.com/vladkens/twscrape、github.com/dimdenGD/OldTwitter
// を 2026-08-02 に確認。5つとも下のどのキーについても一致した）。card.name は「website」の
// カードのひな形の決まった集合のどれかで、X_POLL_CARD の 'poll<N>choice...' の名前とも、
// 他の種類の tweet が持つ broadcast/player のカードとも重ならない（生放送の NASA の
// broadcast のカードを 2026-08-02 に採取したところ、card.name は '<id>:broadcast' で、
// ここに挙げた binding はどれも持っていなかった）。
const X_LINK_CARD_NAMES = new Set(['summary', 'summary_large_image', 'summary_photo_image', 'promo_image', 'summary_large_image_app']);
// 静止画の binding の名前は、X のカードの歴史の中で変わってきた。上の実装群が認識する値を
// すべて、tweetic 自身の BindingValues 型が並べているのと同じ、限定的なものから先に試す。
// おかげで、古い tweet のカードも新しい tweet のカードも、実際にどのキーを持っているかに
// よらず同じように読める。
const X_LINK_CARD_IMAGE_KEYS = [
  'summary_photo_image_large',
  'photo_image_full_size_large',
  'summary_photo_image',
  'photo_image_full_size',
  'summary_photo_image_x_large',
  'photo_image_full_size_x_large',
  'thumbnail_image_large',
  'thumbnail_image',
  'thumbnail_image_original',
  'summary_photo_image_original',
  'photo_image_full_size_original',
];
function xCardImage(bindings, key: string): string | null {
  const v = bindings && bindings[key];
  return v == null ? null : CardImageBindingSchema.parse(v).image_value.url;
}
// card_url は、xExpandUrls が本文から追い出すのと同じ t.co の短縮リンク（#189 の理屈がここ
// にも、しかもより強く当てはまる＝この URL はリンクへの言及ではなくリンクそのもの）。
// entities.urls は xExpandUrls が読むのと同じ展開の表なので、追加の要求は要らない。
// vanity_url/domain は退避先にしない。どちらもパスを持たないホスト名だけの表示用の文字列で、
// リンクそのものの代わりにはならないから (#915)。
function xExpandCardUrl(url: string, entities): string {
  const urls = entities && Array.isArray(entities.urls) ? entities.urls : [];
  for (const u of urls) {
    if (u && u.url === url && typeof u.expanded_url === 'string') return u.expanded_url;
  }
  return url;
}

function xLinkCard(card, entities): LinkCard | null {
  if (!card || typeof card.name !== 'string' || !X_LINK_CARD_NAMES.has(card.name)) return null;
  const bindings = card.binding_values;
  if (!bindings || typeof bindings !== 'object') return null;
  const url = xCardString(bindings, 'card_url');
  if (!url) return null;
  let thumbnail: string | null = null;
  for (const key of X_LINK_CARD_IMAGE_KEYS) {
    thumbnail = xCardImage(bindings, key);
    if (thumbnail) break;
  }
  return { url: xExpandCardUrl(url, entities), title: xCardString(bindings, 'title'), description: xCardString(bindings, 'description'), thumbnail };
}

function xMediaType(details) {
  const t = details && details[0] && details[0].type;
  if (t === 'video') return 'video';
  if (t === 'animated_gif') return 'gif';
  if (t === 'photo') return 'image';
  return null;
}

// video_info.variants は、同じ映像の複数のビットレート（mp4）を持ち、`video` の type では
// HLS のプレイリスト（application/x-mpegURL）も持つ。animated_gif は mp4 の変種が1つだけ。
// ビットレートがいちばん高い mp4 を選ぶ（#119 St1＝tweet ごとに品質を選ばせることはしないし、
// ここは HLS に対応しない）。
function xVideoVariantUrl(info) {
  const variants = (info && info.variants) || [];
  let best: { bitrate?: number; url: string } | null = null;
  for (const v of variants) {
    if (!v || v.content_type !== 'video/mp4' || !v.url) continue;
    if (!best || (v.bitrate || 0) > (best.bitrate || 0)) best = v;
  }
  return best ? best.url : null;
}

// 素の pbs.twimg.com の URL が配信するのは中間の大きさの変種で、本当の原本には ?name=orig が
// 要る（実地で確認＝audit 2026-06-11）。写真の原本にも、video/animated_gif のポスターのコマ
// にも使う（X はどちらにも同じ静止画を配信している）。
//
// 下の highResUrl() とは意図して別物にしてある。こちらが格上げするのは API が申告した URL
// （必ずクエリの無い素の media/ の URL）で、highResUrl が格上げするのはページが見せた URL
// （すでに ?name=<size> を持っていて、書き換えてはいけない video-thumb のパスのことも
// ある）。
function xOrigUrl(url) {
  return url + (url.includes('?') ? '' : '?name=orig');
}

function xMedia(details) {
  const out: MediaItem[] = [];
  for (const m of XMediaSchema.parse(details ?? [])) {
    const alt = m.ext_alt_text || null;
    const width = (m.original_info && m.original_info.width) || null;
    const height = (m.original_info && m.original_info.height) || null;
    if (m.type === 'photo') {
      out.push({ url: xOrigUrl(m.media_url_https), alt, width, height, type: 'image' });
      continue;
    }
    if (m.type === 'video' || m.type === 'animated_gif') {
      const videoUrl = xVideoVariantUrl(m.video_info);
      if (!videoUrl) continue; // 使える mp4 の変種が無い＝取れない写真と同じく落とす
      out.push({ url: videoUrl, alt, width, height, type: m.type === 'animated_gif' ? 'gif' : 'video', poster: xOrigUrl(m.media_url_https) });
    }
  }
  return out;
}

// 投稿の本文の中の '#' の並びから起こすハッシュタグ。埋め込み用 API の payload が自分で
// 並べてくれない唯一の場合のためのもの（xHashtags を参照）。タグは、どの文字体系でも
// 文字・数字・下線＝X 自身の規則。だから URL の中の '#' や単独の '#' は何も生まないし、直前の
// 文字が語のようであってもいけない（文字の後ろに書かれた `#fff` のような色はタグではない）。
const X_HASHTAG_IN_TEXT = /(?<![\p{L}\p{N}_])[#＃]([\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*)/gu;

// entities.hashtags[].text は '#' を含まないタグ（埋め込み用エンドポイントが今も配信する
// 旧来の entities の形）。このキーが在る保証は無い。実際の保存の取得原本を見ると、ハッシュ
// タグの無い投稿では `entities` が urls / user_mentions / media しか持たず
// 。墓標には entities がまったく無い。だから欠けている
// ことは何も語らない。代わりに投稿の本文を読む。埋め込み用 API は本文を必ずそのまま返し、
// そこには '#' も含まれている。
function xHashtags(j): string[] {
  const ents = j?.entities?.hashtags;
  if (ents) return normalizeHashtags(ents.map((h) => h.text));
  return normalizeHashtags([...String((j && j.text) || '').matchAll(X_HASHTAG_IN_TEXT)].map((m) => m[1]));
}

function xProfileLinks(user): Array<{ name: string; value: string }> | null {
  const urls = user?.entities?.url?.urls;
  if (urls === undefined) return null;
  const out = XProfileUrlsSchema.parse(urls)
    .map((entry) => entry.expanded_url || entry.url)
    .filter(Boolean);
  return out.length ? [...new Set(out)].map((value) => ({ name: 'URL', value })) : null;
}

// #180/#806: 引用された tweet（quoted_tweet）と、返信先の親（parent。#806 で足した。両方を
// 裏付ける出所は同じ）は、このレスポンスの中で最上位の tweet と同じ形で届く
// （mediaDetails/entities/user がそのまま写っている）。だからサイドカーのサブレコードは、
// どちらについてもまったく同じ欄の読み方で組み立てられ、追加の要求も要らない。
function xQuotedRef(t): QuotedPost | null {
  if (!t) return null;
  XQuotedSchema.parse(t);
  // screen_name を守る。埋め込まれた tweet は screen_name を持たない user オブジェクトを
  // 持ちうるので、そのままだと .../undefined/status/<id> を組み立ててしまう。
  const url = t.user && t.user.screen_name && t.id_str ? `https://x.com/${t.user.screen_name}/status/${t.id_str}` : null;
  return {
    url,
    displayName: (t.user && t.user.name) || null,
    screenName: (t.user && t.user.screen_name) || null,
    userId: (t.user && t.user.id_str) || null,
    avatar: t.user && t.user.profile_image_url_https ? t.user.profile_image_url_https.replace(/_normal(\.[a-z]+)(?=$|\?)/i, '_400x400$1') : null,
    text: t.text ? xExpandUrls(t.text, t.entities) : null,
    date: toIso(t.created_at),
    cw: null, // このエンドポイントに自由記述の閲覧注意の欄は無い（上の rec.sensitive を参照）
    media: xMedia(t.mediaDetails),
  };
}

async function fetchXTweet(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'x');
  rec.screenName = parsed.screenName;
  // 正規の permalink。ページ上のアンカーは /photo/N、/analytics、クエリ文字列を持ちうるし、
  // サブドメインのホスト（pro.x.com）はステータスのページとして解決しないことがある。
  // だから素の https://x.com/<user>/status/<id> の形へ組み直す。
  if (parsed.screenName) rec.url = `https://x.com/${parsed.screenName}/status/${parsed.id}`;
  try {
    const api = `https://cdn.syndication.twimg.com/tweet-result?id=${parsed.id}&token=${xToken(parsed.id)}&lang=en`;
    const res = await fetch(api);
    if (!res.ok) {
      rec.metaError = 'unavailable';
      rec.date = xSnowflakeDate(parsed.id);
      return rec;
    }
    const j = await readJsonResponse(res);
    // 墓標は、投稿は在るのに公開 API がそれを出さないという意味。X は、削除された投稿には
    // 理由を名指しし（「This Post was deleted by the Post author」）、鍵の掛かった投稿にも
    // 名指しする（「limits who can view their Posts」）が、年齢制限の投稿には何も名指し
    // しない＝墓標が丸ごと {} で返る。だから理由が無いこと自体が理由になる (#505)。
    // 2026-07-29 に実ライブラリの X 投稿951件で実測したところ、空の墓標はどれも、ログアウト
    // 状態のページに「Age-restricted adult content … to view this media, you'll need to
    // log in to X」と出る投稿だった。空でない墓標はどれも、他のどの原因かを述べていた。
    //
    // こちら側でどうログインしてもこれは解けない。cdn.syndication.twimg.com は匿名の埋め込み
    // 用 API で、X の成人向けコンテンツの方針は、プロフィールに生年月日を持たない閲覧者は
    // 印の付いたコンテンツを見られないとしている。削除された投稿と見分けることこそが要点＝
    // 一方は永久に失われ、もう一方は生きていて、ただこの経路の手が届かないだけ。
    if (j && j.__typename === 'TweetTombstone') {
      const t = (j.tombstone && j.tombstone.text && j.tombstone.text.text) || '';
      rec.metaError = /limits who can view/i.test(t) ? 'protected' : !t || /age[ -]?restricted/i.test(t) ? 'ageRestricted' : 'unavailable';
      rec.date = xSnowflakeDate(parsed.id);
      return rec;
    }
    XPostSchema.parse(j);
    rec.text = j.text ? xExpandUrls(j.text, j.entities) : null;
    if (xWasEdited(j.edit_control)) rec.isEdited = true;
    // メディアなしの正常応答では省略される。届いた値の型は XPostSchema で検証済み。
    rec.sensitive = j.possibly_sensitive ?? null;
    rec.poll = xPoll(j.card);
    rec.linkCard = xLinkCard(j.card, j.entities);
    if (j.user) {
      rec.displayName = j.user.name || null;
      rec.screenName = j.user.screen_name || rec.screenName;
      rec.userId = j.user.id_str || null;
      // アバター。埋め込み用 API が配信するのは 48px の _normal の変種なので、400px のものへ
      // 組み直す。ほかの公開プロフィール欄は応答に含まれる場合だけ正規化して保存する。
      if (j.user.profile_image_url_https) {
        rec.avatar = j.user.profile_image_url_https.replace(/_normal(\.[a-z]+)(?=$|\?)/i, '_400x400$1');
      }
      rec.bio = j.user.description ? xExpandUrls(j.user.description, j.user.entities?.description) : null;
      rec.profileLinks = xProfileLinks(j.user);
      rec.banner = j.user.profile_banner_url_https || j.user.profile_banner_url || null;
      rec.followers = j.user.followers_count ?? null;
      rec.following = j.user.friends_count ?? null;
      rec.authorCreatedAt = toIso(j.user.created_at);
      if (j.user.screen_name) rec.url = `https://x.com/${j.user.screen_name}/status/${parsed.id}`;
    }
    rec.likes = j.favorite_count ?? null;
    rec.replies = j.conversation_count ?? null;
    rec.date = toIso(j.created_at);
    rec.lang = j.lang || null;
    rec.hashtags = xHashtags(j);
    rec.mediaType = xMediaType(j.mediaDetails);
    rec.media = xMedia(j.mediaDetails);
    if (j.quoted_tweet) {
      rec.isQuote = true;
      // screen_name を守る。quoted_tweet は screen_name を持たない user オブジェクトを
      // 持ちうるので、そのままだと .../undefined/status/<id> を組み立ててしまう。
      const qt = j.quoted_tweet;
      if (qt.user && qt.user.screen_name && qt.id_str) {
        rec.quotedUrl = `https://x.com/${qt.user.screen_name}/status/${qt.id_str}`;
      }
      rec.quotedPost = xQuotedRef(qt);
    }
    if (j.in_reply_to_screen_name) {
      rec.isReply = true;
      rec.replyToId = j.in_reply_to_status_id_str || null;
      // 自己返信（スレッド）＝スレッドへ格上げして isReply を消す。そうすることで4つの
      // プラットフォームの分類が互いに排他になる（自分で連ねたスレッドは返信ではない）。
      if (j.in_reply_to_user_id_str && j.user && j.in_reply_to_user_id_str === j.user.id_str) {
        rec.isThread = true;
        rec.isReply = null;
      }
      // #806: quoted_tweet の専用の印と違い、返信には「その取得が実際に親を同梱しようと
      // したか」を tweet ごとに示す信号が無い。j.parent が単に欠けるだけで（親が削除済み
      // か鍵付き、あるいはその返信が、埋め込み用 API にこの欄が入るより前のもの）、その場合は
      // xQuotedRef(undefined) がすでに null と答える。
      rec.replyToPost = xQuotedRef(j.parent);
    }
  } catch (error) {
    rethrowContractError(error);
    // ネットワークか解析の失敗＝手元にあるもの（URL と screenName）を残す
    rec.metaError = 'fetchFailed';
  }
  // API が何も寄こさなかったときでも、ID が投稿の時刻を符号化している。
  if (!rec.date) rec.date = xSnowflakeDate(parsed.id);
  return ExtractedPostSchema.parse(rec);
}

// === extractor 本体 ===

const x: Extractor = {
  platform: 'x',

  parseUrl(u) {
    // サブドメイン（pro.x.com、mobile.twitter.com …）は同じ web UI を出し、常駐コンテンツ
    // スクリプトのホストの照合でも受け入れられる。ここでも受け入れる。そうしないと、保存が
    // プラットフォーム名だけのメタデータで済んでしまう。(audit 2026-06-11)
    const host = u.hostname;
    if (!(host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com'))) return null;
    const m = u.pathname.match(/\/status\/(\d+)/);
    if (!m) return null;
    return { platform: 'x', id: m[1], screenName: (u.pathname.match(/^\/([^/]+)\/status/) || [])[1] || null };
  },
  isAllowedOrigin: (_tabUrl, hostname) => HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)),

  fetchPost: fetchXTweet,

  mediaKey(url) {
    // パスの両方の部分を使う。id だけだと、同じ投稿の写真と動画のポスターが、こちらの支配
    // していない共通の id 空間で衝突しうる。
    const m = url.match(POST_MEDIA_KEY);
    return m ? `${m[1]}/${m[2]}` : null;
  },
  highResUrl(url) {
    // 書き換えるのは media/ だけ。X はそこを ?name=<size> の変種付きで配信するので、
    // name=orig がサムネイルを絵の全体へ格上げする。動画/GIF のポスターのパス
    // （POST_MEDIA_PATHS を参照）は name= のパラメータを持たず、すでに原本＝そこへ
    // name=orig を付けても 200 とバイト単位で同じ中身が返る（実際の X で実測、2026-07-28）
    // ので、書き換えても候補の URL が重複して増えるだけになる。
    //
    // mediaHostIs は使わない。ここはバックグラウンドのサービスワーカーの中で、API が
    // すでに絶対 URL として返したものを相手にしていて、解決の基準になる `location` を持つ
    // コンテンツスクリプトの中ではない。mediaHostIs の `location.origin` はそこで例外を
    // 投げる（dom.ts 自身の冒頭＝DOM 相であり、呼び出し時に読む）。
    try {
      const u = new URL(url);
      if (u.hostname !== 'pbs.twimg.com' || !u.pathname.startsWith('/media/')) return null;
      u.searchParams.set('name', 'orig');
      return u.href;
    } catch (error) {
      rethrowContractError(error);
      return null;
    }
  },

  matchesPage: () => hostnameMatches('x.com') || hostnameMatches('twitter.com'),
  content: {
    platform: 'x',
    postSelector: 'article[data-testid="tweet"]',
    getPermalink(post: Element): string {
      // 単一のステータスのページでは URL バーへ退避する（Bluesky と揃える）。
      // これで、自分の permalink のアンカーが描かれていない article でも使える URL が出る。
      // 写真のビューアの絵 (#325) も同じ道でここへ来る＝あれは自分のアンカーを持たないし、
      // parseXPostLink が URL バーに出ている /photo/<n> を落とす。
      return getXPostLink(post)?.url || parseXPostLink(location.href)?.url || '';
    },
    isBulkCapturePage: isXBookmarksPage,
    capturedVia: 'x-bookmarks',
    // 仮想リストは、スクロールして到達するまで行を載せない。だから取り込みは、今キューが
    // 空だというだけで終わったとは言えない。一覧の続きがまだ画面の下に残っているかもしれない
    // (#280 が bulk-capture.ts のかつて直書きされていた checkEnd から切り出した)。
    bulkAtBottom: () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 100,
    extractDomMeta: extractXDomMeta,
  },

  mediaIdentity: {
    platform: 'x',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      // その画像を囲んでいる /status/ のアンカーが正本。URL バー（写真のビューアや詳細
      // ページ）が素性を示すのは、どの投稿コンテナにも入っていないアンカー無しの画像だけ。
      // そうしないと、ライトボックスが開いている間、ページ上のすべての画像（返信、おすすめ）が
      // ライトボックスの投稿へ帰属してしまう。(audit 2026-06-11)
      const link = (el.closest('a[href*="/status/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(el, 'a[href*="/status/"]', 'article') as HTMLAnchorElement | null);
      const parsedAnchor = link ? parseMediaUrlPath(link.href, /^\/([^/]+)\/status\/([^/?#]+)/) : null;
      const viewer = location.pathname.match(/^\/([^/]+)\/status\/(\d+)\/photo\/\d+/);
      const parsedLoc = location.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      let screenName: string | undefined, postId: string | undefined;
      if (parsedAnchor) {
        [, screenName, postId] = parsedAnchor.match;
      } else if ((viewer || parsedLoc) && !el.closest('article')) {
        [, screenName, postId] = (viewer || parsedLoc) as RegExpMatchArray;
      } else return null;
      if (!screenName || !postId) return null;
      const sn = decodeURIComponent(screenName);
      const pid = decodeURIComponent(postId);
      return { postId: pid, link: `https://x.com/${sn}/status/${pid}` };
    },
    isPostMedia: (el) => anySrc(el, (src) => mediaHostIs(src, 'pbs.twimg.com') && POST_MEDIA_PATH_PREFIXES.some((prefix) => src.includes(prefix))),
  },

  overlay: {
    // 形は3つ。タイムラインの `article`（permalink のアンカーもメディアも、どちらもその中の
    // どこかに在る）。メディアタブのグリッドのタイル＝自分の `/status/` のアンカーの数段上に
    // ある素の `<li>` で、`article` や testid の包みをまったく持たない（#349。間の div が
    // どう入れ子でも `:has()` はアンカーへ届く）。そして写真のビューアの
    // `div[data-testid="swipe-to-dismiss"]`。これは今見せている1枚のスライドだけをちょうど
    // 包み、どの article の外にも在る（#659。#325 が最初にぶつかったのと同じモーダル
    // の層の形）。あの testid は X の内部の命名で、黙って消えることもありうるので、mediaIn は
    // それを単位として扱う前に findXViewerMedia で裏を取る（URL の形 `/photo/<n>` と、
    // ここの他のどの分岐も使うのと同じ CDN のパスの許可リスト）。これは同時に、対象を写真の
    // ビューアだけに保ち、動画の没入ビューア（`/video/<n>`）は含めない＝誰も確かめていない形を
    // 推し量らない、という #325 の v1 の判断に沿う。
    unitSelector: 'article[data-testid="tweet"], li:has(a[href*="/status/"]), div[data-testid="swipe-to-dismiss"]',
    // querySelectorAll は文書順で返すので、最初のエントリは複数画像の投稿の1枚目の絵＝
    // 保存済みの印を置くべき場所になる。グリッドのタイルには手掛かりにできる
    // tweetPhoto/videoPlayer の testid が無く、その <img> がそのままメディアの箱なので、
    // 代わりにここで isPostMedia（保存ボタンがすでに門を張っているのと同じ CDN のパスの
    // 検査）を直接掛け、投稿自身のメディアでない画像に飾りが付かないようにする。動画と GIF の
    // タイルは #372 以降その検査を通るので、絵のタイルと同じように面倒を見る＝メディアタブは
    // タイムラインと同じ問いに答えなければならず、その食い違いを無くすために #349 が在った。
    //
    // ビューアの分岐は解決した絵そのものを返し、`swipe-to-dismiss` の包みは決して返さない
    // (#704 が #659 を訂正)。あの包みは下へスワイプするための当たり判定で、大きさは絵では
    // なくビューアのスライドに合わせてある。だからそれをメディアの箱として扱うと、保存済みの
    // 角（controlHost() の HTMLElement の分岐＝箱自身の左上からの寄せ）がビューアの左上、
    // つまり X の閉じる（×）ボタンの上に載ってしまう。グリッドのタイルはすでにこれを避けて
    // いる＝本物の <img> をそのまま返し、controlHost() の IMG の分岐に
    // box.parentElement の position:relative を借りさせて、置き場の規則をでっち上げずに
    // 済ませている。findXViewerMedia はすでにその解決済みの要素を返す（あちらの doc コメント
    // 自身の言葉＝「包み側は決して返さない」）＝この分岐は今、すぐ下の LI の分岐とまったく
    // 同じ形になっている。
    mediaIn: (unit) => {
      if (unit.tagName === 'LI') return [...unit.querySelectorAll('img')].filter((img) => x.mediaIdentity?.isPostMedia(img as HTMLImageElement) ?? false);
      if (unit.getAttribute('data-testid') === 'swipe-to-dismiss') {
        const media = findXViewerMedia(unit);
        return media ? [media] : [];
      }
      const boxes = xOwnAll(unit, '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]');
      // 同じ動画を包む入れ子の要素も、一つのメディアとして数える。
      return boxes.filter((box) => !boxes.some((other) => other !== box && other.contains(box)));
    },
    // 投稿者のアバター (#575)。本文だけの tweet が、絵を持つ tweet と今も共通して持つ唯一の
    // 要素。グリッドのタイル（上の LI の形）がここへ来ることはない。あれは必ずメディアを
    // 持つか、さもなければ mediaIn が何も返さないだけで、印を付けるべき「本文だけのタイル」は
    // 別に存在しない。
    textAnchorIn: (unit) => unit.querySelector('[data-testid="Tweet-User-Avatar"]'),
  },

  residentMatches: ['https://x.com/*', 'https://twitter.com/*'],
  apiHostPermissions: ['https://cdn.syndication.twimg.com/*'],
};

export default x;
export { extractXDomMeta, fetchXTweet, getXPostLink, isXBookmarksPage, parseXPostLink, xMedia, xSnowflakeDate, xToken };
export type { XPostLink };
