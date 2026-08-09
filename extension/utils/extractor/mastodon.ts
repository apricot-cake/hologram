// Mastodon。
//
// API は <instance>/api/v1/statuses/<id>（公式の公開 REST）。Misskey と同じくインスタンス
// は投稿 URL から取る任意のホストなので、derivedApiHost を持つ。

import { prepareScopedCaptureState } from './dom.ts';
import { parseCount } from './dom-meta.ts';
import { fileBasenameKey } from './media.ts';
import { emptyRecord, htmlToText, normalizeHashtags, readJsonKeepingRaw, toIso } from './record.ts';
import type { DomMeta, Extractor, LinkCard, Poll, PostRecord } from './types.ts';

// === DOM ===

function looksLikeMastodon(): boolean {
  return Boolean(document.querySelector('#mastodon')) || document.querySelector('meta[name="application-name"]')?.getAttribute('content') === 'Mastodon';
}

interface MastodonStatusLink {
  id: string;
  url: string;
}

function parseMastodonStatusLink(href: string): MastodonStatusLink | null {
  try {
    const url = new URL(href, location.origin);
    if (url.hostname !== location.hostname) return null; // このインスタンスのステータスだけ
    const match = url.pathname.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/);
    if (!match) return null;
    const id = match[1];
    if (id === undefined) return null;
    return { id: decodeURIComponent(id), url: `${url.origin}${url.pathname}` };
  } catch {
    return null;
  }
}

function getMastodonStatusLink(post: Element): MastodonStatusLink | null {
  if (!(post instanceof Element)) return null;
  const timeLink = post.querySelector('a[class*="relative-time"], a[class*="detailed-status__datetime"]');
  let parsed = timeLink ? parseMastodonStatusLink(timeLink.getAttribute('href') || '') : null;
  if (parsed) return parsed;
  for (const link of post.querySelectorAll('a[href]')) {
    // 埋め込みの引用プレビュー（4.4 以降）に属するリンクは決して取らない。それは引用元の
    // 投稿の URL であって、このステータスのものではない。
    if (link.closest('.status__quote')) continue;
    parsed = parseMastodonStatusLink(link.getAttribute('href') || '');
    if (parsed) return parsed;
  }
  return null;
}

function findMastodonPostElement(target: EventTarget | null): Element | null {
  let el: Element | null = target instanceof Element ? target : ((target as Node | null)?.parentElement ?? null);
  while (el) {
    // 引用プレビューの中に入れ子になったステータス要素は飛ばす（Mastodon 4.4 以降の引用
    // は .status__quote の中に StatusContainer を丸ごと描く）。そのまま遡り続けることで、
    // プレビューの中をクリックしても引用した側の投稿が選ばれる。X/Bluesky/Misskey と同じ。
    if (el.matches?.('.status__wrapper, .status, .detailed-status, article') && !el.closest('.status__quote') && getMastodonStatusLink(el)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

// #202 の段2。このステータスについてページ自身が出しているもの。インスタンスの公開 API が
// null のまま残した欄（フォロワー限定のステータス、または匿名の API アクセスを閉じている
// インスタンス。モジュール冒頭を参照）も、これで保存できるようにする。当て推量ではなく
// mastodon/mastodon 自身のソースに基づく（main ブランチを 2026-08-03 に確認）。Misskey と
// 違い、Mastodon の web クライアントはクラス名をハッシュ化しない＝status_action_bar/
// index.jsx、display_name/*.tsx、relative_timestamp/index.tsx はどれも、下で当てている
// BEM 風のクラスをそのまま出す。このファイルの他所で既存の .status__quote /
// .detailed-status__datetime のセレクタが寄りかかっているのと同じ種類の、安定した契約。
//
// 対象はタイムラインのカードの形（.status__*）だけ。permalink ページ自身のコンポーネント
// （features/status/components/detailed_status.tsx）は、並行するが名前の違う木を描く
// （.detailed-status__display-name。ブースト／お気に入り／引用の数も、アクションバーの
// アイコンボタンではなく素の .detailed-status__reblogs/__favorites/__quotes のリンク）。
// ここはそちらを狙わない。投稿をその permalink ページから保存すること自体は今もできる
// （findMastodonPostElement のセレクタは .detailed-status を含む）が、その場合は本物の
// 改装のときと同じ「セレクタが外れ、何も埋まらない」という安全な結果に落ちる。どちらでも
// 落ちる危険は無い。
function mastodonReadText(el: Element): string {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      continue;
    }
    if (node.nodeType !== 1) continue;
    const child = node as Element;
    // Mastodon 4.4 以降は、引用を、引用した側の投稿自身の .status__content の中に流し込んで
    // 描くことがある（`quote-inline` の差し込み用トークンが、入れ子の .status__quote の箱
    // ごと置き換わる＝status_content.jsx 自身の handleElement）。X では引用カードがテキスト
    // ノードの兄弟であって子孫になることはないので、あちらにこの防ぎに当たるものは無い。
    // ここでその部分木を飛ばすことだけが、引用の保存と、この機能の唯一の本当の壊れ方
    // ＝他人の言葉を引用した側の投稿の本文に書き込むこと、との間に立っている。
    if (child.classList.contains('status__quote')) continue;
    const tag = child.tagName.toLowerCase();
    if (tag === 'img') out += child.getAttribute('alt') || '';
    else if (tag === 'br') out += '\n';
    else out += mastodonReadText(child);
  }
  return out;
}

// 埋め込みの引用自身の部分木の外にある、最初の一致。x.ts の xOwn と同じ形で、要る理由も
// 同じ（引用されたステータスも自分の .status__display-name / .status__content を描く）。
function mastodonOwn(post: Element, selector: string): Element | null {
  for (const el of post.querySelectorAll(selector)) {
    if (!el.closest('.status__quote')) return el;
  }
  return null;
}

// icon_button.tsx は押せる数を <span class="icon-button__counter">
// <AnimatedNumber .../></span> として描き、AnimatedNumber 自身の表示の値は ShortNumber。
// これは K/M/B（そしてロケールによっては 万/億）の略記で、dom-meta.ts の parseCount が
// まさにそれを読むために在るので、ここで別に解析する必要は無い。
function mastodonActionCount(post: Element, iconClass: string): number | null {
  const btn = mastodonOwn(post, `.status__action-bar__button:has([class*="${iconClass}"])`);
  const counter = btn?.querySelector('.icon-button__counter');
  return counter ? parseCount(mastodonReadText(counter)) : null;
}

function extractMastodonDomMeta(post: Element): DomMeta {
  const meta: DomMeta = {};
  if (!(post instanceof Element)) return meta;

  // LinkedDisplayName（display_name/index.tsx）は、包んでいる <a> 自身の title を
  // `@acct` にする。属性を読む方が .display-name__account のテキストを掘り出すより1手
  // 短いし、名前そのものと違ってカスタム絵文字のマークアップに乱されない。
  const nameLink = mastodonOwn(post, '.status__display-name');
  if (nameLink) {
    const acct = nameLink.getAttribute('title') || '';
    if (acct.startsWith('@')) meta.screenName = acct.slice(1);
    const nameEl = nameLink.querySelector('.display-name__html');
    if (nameEl) meta.displayName = mastodonReadText(nameEl);
  }

  const textEl = mastodonOwn(post, '.status__content');
  if (textEl) meta.text = mastodonReadText(textEl);

  // relative_timestamp/index.tsx の <time dateTime> は、API 自身の created_at をそのまま
  // 通したもの＝Misskey のそれと違って本当に ISO。
  const timeEl = mastodonOwn(post, '.status__relative-time time[datetime]');
  if (timeEl) meta.date = toIso(timeEl.getAttribute('datetime'));

  const replies = mastodonActionCount(post, 'icon-reply'); // icon-reply と icon-reply-all の両方に当たる
  if (replies != null) meta.replies = replies;
  const reposts = mastodonActionCount(post, 'icon-retweet'); // boost_button.tsx 自身のアイコン id。ブーストと引用の合算で、API の欄と同じ
  if (reposts != null) meta.reposts = reposts;
  const likes = mastodonActionCount(post, 'icon-star');
  if (likes != null) meta.likes = likes;
  // 読むべきブックマーク数はそもそも無く（Mastodon は公開しない）、表示回数は UI に一切
  // 存在しない。どちらもここでは永久に未設定のまま＝この Issue が名指ししていない他の
  // プラットフォームと同じ。

  return meta;
}

// === API ===

function mastodonItemType(a): 'video' | 'gif' | 'image' | null {
  const t = a && a.type;
  if (t === 'video') return 'video';
  if (t === 'gifv') return 'gif'; // gifv は mp4 のループであって、本物の .gif ではない
  if (t === 'image') return 'image';
  return null;
}
function mastodonMediaType(atts) {
  return mastodonItemType(atts && atts[0]);
}

// `a.url` は、どの type（image でも video/gifv でも）でも原寸の添付。`preview_url` は
// 後の2つでのポスターのコマ (#119 St1)。
function mastodonMedia(atts) {
  if (!Array.isArray(atts)) return [];
  return atts
    .filter((a) => a && a.url && mastodonItemType(a))
    .map((a) => {
      // ここで mastodonItemType が null になることはない（上の filter が除いている）。
      // `|| undefined` は MediaItem.type を満たすためだけのもの（null の変種が無い）。
      const type = mastodonItemType(a) || undefined;
      return {
        url: a.url,
        alt: a.description || null,
        width: (a.meta && a.meta.original && a.meta.original.width) || null,
        height: (a.meta && a.meta.original && a.meta.original.height) || null,
        type,
        poster: type !== 'image' ? a.preview_url || null : undefined,
      };
    });
}

// Mastodon のステータスの permalink は /@user/<numericId> の形をしている。Mastodon 以外の
// ソフトウェア（Lemmy/PieFed/Mbin/…）から連合で流れてきた投稿は、そのソフトウェア自身の
// 体系で正規の s.url を申告してくるが、それはステータスとしては開かない（404 か拒否）。
function isMastodonStatusUrl(u) {
  try {
    return /^\/@[^/]+\/\d+\/?$/.test(new URL(u).pathname);
  } catch {
    return false;
  }
}

// #180: これは完全な Status オブジェクトか、それとも Status を名指しするだけの引用の
// 切り株（ShallowQuote＝{state, quoted_status_id}）か。本物の Status は必ず .content を
// 持つ（本文が空の投稿でもキーはあり、htmlToText がそれに対して null を返すだけ）。
// 切り株が決して持たない唯一の欄がこれ。
function mastodonFullStatus(x): any | null {
  return x && typeof x === 'object' && x.content !== undefined ? x : null;
}

// #179: status.poll は {id, expires_at, expired, multiple, votes_count,
// voters_count, options[{title, votes_count}], emojis[]}（実物で確認＝
// scripts/canary/snapshots/mastodon.json の 'poll' の出所）。残すのは、アンケート自体を
// 説明している部分だけ:
//   - `expired` は落とす。これは expires_at を「今」と比べたもので、表示側が後からいつでも
//     自分で問える（types.ts の Poll.expiresAt を参照）。
//   - `votes_count` は落とす。これは各選択肢の集計の合計。
//   - `emojis[]` は落とす。アンケートの選択肢も :shortcode: のカスタム絵文字を持ちうるが、
//     #290 は絵文字の保存先を投稿自身の本文に限った。下部構造の絵文字は、QuotedPost.media
//     と同じ範囲外の場合に当たる。いずれにせよ shortcode の文字列は選択肢のラベルにその
//     まま残る。
// 選択肢ごとの votes_count が null（見ている人が投票するまで結果を隠している）のときは、
// 0へ畳まず null のまま通す＝types.ts の PollChoice を参照。
function mastodonPoll(poll): Poll | null {
  if (!poll || !Array.isArray(poll.options)) return null;
  return {
    choices: poll.options.filter((o) => o && typeof o.title === 'string').map((o) => ({ text: o.title as string, votes: typeof o.votes_count === 'number' ? o.votes_count : null })),
    multiple: typeof poll.multiple === 'boolean' ? poll.multiple : null,
    expiresAt: toIso(poll.expires_at),
    votersCount: typeof poll.voters_count === 'number' ? poll.voters_count : null,
  };
}

// #290: status.emojis[] は {shortcode, url, static_url, visible_in_picker}＝公式の
// CustomEmoji の形（mstdn.jp/pawoo.net/mastodon.cloud の実物で確認、2026-08-02）。残すのは
// `url` で、`static_url` は使わない。元画像が動くものであれば、こちらが動く方の原本になる
// （mstdn.jp の meow_beanbag が実際の .webp の例）。絵文字は動くためのもので、#119 の
// 動画/GIF のメディアが従うのと同じ「動く絵は動いたまま残す」という規則。
// #289: status.account.fields[] は {name, value, verified_at}＝公式の Account.Field
// エンティティ（docs.joinmastodon.org/entities/Account/#Field を 2026-08-02 に確認）。
// `value` は HTML と文書化されている（インスタンスが裸の URL を <a href> へ自動リンクする）
// ので、値がリンクである欄は、描画されたテキストではなくその href から読む。テキストの方は
// 実際の行き先と違う短縮表示（`example.com/…`）でありうるから。アンカーを持たない値
// （`Pronouns: she/her` など）は、下の `note` と同じく htmlToText でタグを落としたテキスト
// へ退避する。
function mastodonFieldValue(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  const m = html.match(/<a\s+[^>]*href="([^"]+)"/i);
  if (m?.[1]) return m[1];
  return htmlToText(html) || '';
}
function mastodonProfileLinks(fields: unknown): { name: string; value: string; verifiedAt: string | null }[] | null {
  if (!Array.isArray(fields) || !fields.length) return null;
  const out: { name: string; value: string; verifiedAt: string | null }[] = [];
  for (const f of fields) {
    if (!f || typeof f.name !== 'string' || !f.name) continue;
    const value = mastodonFieldValue(f.value);
    if (!value) continue;
    out.push({ name: f.name, value, verifiedAt: f.verified_at ? toIso(f.verified_at) : null });
  }
  return out.length ? out : null;
}

function mastodonCustomEmojis(emojis) {
  if (!Array.isArray(emojis)) return [];
  return emojis.filter((e) => e && typeof e.shortcode === 'string' && e.shortcode && typeof e.url === 'string' && e.url).map((e) => ({ shortcode: e.shortcode as string, url: e.url as string }));
}

// #181: status.card は、投稿本文の中の URL についてインスタンス自身のサーバーが取ってきた
// OGP のプレビュー＝公式の PreviewCard エンティティ
// （docs.joinmastodon.org/entities/PreviewCard を 2026-08-02 に確認。url/title/description/
// image を持ち、`type` は link/photo/video/rich のいずれか）。どの `type` も同じ
// url/title/description/image の形を持つので、ここで分岐はしない。photo/video の oEmbed の
// プレビュー（埋め込まれた YouTube のリンクなど）も、素の記事へのリンクとまったく同じく
// 「この投稿が共有したリンクを説明するカード」だから。image は null でありうると文書化
// されている（og:image を持たないページへのリンクでもカードは付き、サムネイルが無いだけ）。
function mastodonLinkCard(card): LinkCard | null {
  if (!card || typeof card.url !== 'string' || !card.url) return null;
  return { url: card.url, title: card.title || null, description: card.description || null, thumbnail: card.image || null };
}

async function fetchMastodonStatus(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'mastodon');
  try {
    const res = await fetch(`https://${parsed.host}/api/v1/statuses/${parsed.id}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return rec;
    const s = await readJsonKeepingRaw(rec, 'api:mastodon/status', res);
    // 正規の permalink を採るのは、それが本物の Mastodon のステータス URL のときだけ。
    // そうでなければ、こちらが保存したインスタンスの URL へ退避する（そちらは必ず
    // Mastodon の UI で開く）。連合で流れてきた Lemmy/PieFed の投稿が死んだリンクに
    // ならないようにするため。
    rec.url = s.url && isMastodonStatusUrl(s.url) ? s.url : url;
    rec.text = htmlToText(s.content);
    rec.customEmojis = mastodonCustomEmojis(s.emojis);
    // #178: spoiler_text は投稿者が書いた閲覧注意の文言（付けていなければ null ではなく
    // 空文字。ここで他の自由記述の欄と同じく null に正規化する）。sensitive は API が必ず
    // 答える本物の真偽値なので（黙りうる isEdited の edit_control とは違う）、確たる
    // false はそのまま残し、null へ畳まない。
    rec.cw = s.spoiler_text || null;
    rec.sensitive = typeof s.sensitive === 'boolean' ? s.sensitive : null;
    rec.poll = mastodonPoll(s.poll);
    rec.linkCard = mastodonLinkCard(s.card);
    rec.date = toIso(s.created_at);
    if (s.account) {
      rec.displayName = s.account.display_name || s.account.username || null;
      rec.screenName = s.account.acct || s.account.username || null;
      rec.userId = s.account.id || null;
      // ステータスの account は完全な Account オブジェクト＝アバター、フォロワー数、
      // アカウントの作成日がその場に揃っている（追加の要求は要らない）。
      rec.avatar = s.account.avatar || s.account.avatar_static || null;
      rec.followers = s.account.followers_count ?? null;
      rec.authorCreatedAt = toIso(s.account.created_at);
      // #289: 自己紹介とリンクは、上の完全な Account オブジェクトにそのまま相乗りする＝
      // 追加の要求は無い。バナーは取らない。Mastodon の Account もバナーを持つ
      // （header/header_static）が、この Issue の受け入れ範囲がバナーについて名指ししたのは
      // Misskey と Bluesky だけ（rec.banner は emptyRecord() の null のまま）。
      rec.bio = htmlToText(s.account.note);
      rec.profileLinks = mastodonProfileLinks(s.account.fields);
    }
    rec.likes = s.favourites_count ?? null;
    rec.reposts = s.reblogs_count ?? null;
    rec.replies = s.replies_count ?? null;
    // edited_at は文書化された形＝投稿者がそのステータスを編集していれば ISO の時刻、
    // 一度も編集していなければ null (#189)。本物のステータスにはこの欄が必ず在るので、
    // ここで欠けている場合も null と同じに読む。黙っていることから編集済みと推し量る
    // ことは一切ない。
    if (s.edited_at) {
      rec.isEdited = true;
      rec.editedAt = toIso(s.edited_at);
    }
    rec.lang = s.language || null;
    // status.tags[] は { name, url } で、name は「the value of the hashtag after the #
    // sign」と文書化されている (#177)。インスタンス自身が解決した結果なので、その投稿の
    // 連合先の複製にしか存在しないタグも含む。
    rec.hashtags = normalizeHashtags((Array.isArray(s.tags) ? s.tags : []).map((t) => t && t.name));
    rec.mediaType = mastodonMediaType(s.media_attachments);
    rec.media = mastodonMedia(s.media_attachments);
    if (s.in_reply_to_id) {
      rec.isReply = true;
      rec.replyToId = String(s.in_reply_to_id);
      if (s.account && s.in_reply_to_account_id && s.in_reply_to_account_id === s.account.id) {
        rec.isThread = true;
        rec.isReply = null;
      }
    }
    // 引用。フォーク（Fedibird/glitch-soc）は完全なステータスを `quote` に直接入れる。
    // 本流の Mastodon 4.4 以降は { state, quoted_status } で包む（ShallowQuote は
    // { state, quoted_status_id }）。3つの形すべてを扱う。
    const q = s.quote;
    if (q && (q.url || q.uri || q.quoted_status || q.quoted_status_id)) {
      rec.isQuote = true;
      rec.quotedUrl = q.url || q.uri || (q.quoted_status && (q.quoted_status.url || q.quoted_status.uri)) || null;
      // #180: サブレコードを組み立てる材料を持つのは、完全なステータスを持つ2つの形
      // （フォークの裸の `quote`、本流の `quote.quoted_status`）だけ。浅い ShallowQuote
      // （{state, quoted_status_id}）は引用元の投稿を名指しするだけで中身を含まず、それを
      // 取りにいくのは2本目の要求＝この Issue の v1 の範囲が除いている（サブレコードを
      // 得られない返信先のプラットフォームと同じ理屈）。見分け方は #178/#189 が完全な
      // Status と ID だけの切り株を見分けるのと同じ＝本物の Status は必ず .content を持つ。
      const qStatus = mastodonFullStatus(q) || mastodonFullStatus(q.quoted_status);
      if (qStatus) {
        rec.quotedPost = {
          url: (qStatus.url && isMastodonStatusUrl(qStatus.url) ? qStatus.url : qStatus.url || qStatus.uri || null) || rec.quotedUrl,
          displayName: (qStatus.account && (qStatus.account.display_name || qStatus.account.username)) || null,
          screenName: (qStatus.account && (qStatus.account.acct || qStatus.account.username)) || null,
          userId: (qStatus.account && qStatus.account.id) || null,
          avatar: (qStatus.account && (qStatus.account.avatar || qStatus.account.avatar_static)) || null,
          text: htmlToText(qStatus.content),
          date: toIso(qStatus.created_at),
          cw: qStatus.spoiler_text || null,
          media: mastodonMedia(qStatus.media_attachments),
        };
      }
    }
  } catch {
    // 部分的なまま残す
  }
  return rec;
}

// === extractor 本体 ===

const mastodon: Extractor = {
  platform: 'mastodon',

  parseUrl(u) {
    // Mastodon の web の URL は /@user/<numericId>。id が数字で始まるので、/@user/media の
    // ようなプロフィールの下位ページは外れる。
    const m = u.pathname.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/);
    if (!m) return null;
    const id = m[1];
    if (id === undefined) return null;
    return { platform: 'mastodon', host: u.hostname, id: decodeURIComponent(id) };
  },
  isAllowedOrigin: (tabUrl) => /^https:/i.test(tabUrl || ''),
  derivedApiHost: (parsed) => parsed.host ?? null,

  fetchPost: fetchMastodonStatus,

  mediaKey: fileBasenameKey,

  matchesPage: looksLikeMastodon,

  capture: {
    platform: 'mastodon',
    captureStyleText: `
        .__snsCaptureMastodonNoHover,
        .__snsCaptureMastodonNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureMastodonNoHover,
        .__snsCaptureMastodonNoHover:hover,
        .__snsCaptureMastodonNoHover .status,
        .__snsCaptureMastodonNoHover .status:hover {
          background-color: transparent !important;
        }
      `,
    findPostElement(target: EventTarget | null) {
      return findMastodonPostElement(target);
    },
    getPermalink(post: Element): string {
      return getMastodonStatusLink(post)?.url || parseMastodonStatusLink(location.href)?.url || '';
    },
    prepareForCapture(post: Element) {
      return prepareScopedCaptureState('__snsCaptureMastodonNoHover', [post, post.parentElement]);
    },
    extractDomMeta: extractMastodonDomMeta,
  },
};

export default mastodon;
export { extractMastodonDomMeta, fetchMastodonStatus, findMastodonPostElement, getMastodonStatusLink, looksLikeMastodon, mastodonCustomEmojis, mastodonMedia, parseMastodonStatusLink };
export type { MastodonStatusLink };
