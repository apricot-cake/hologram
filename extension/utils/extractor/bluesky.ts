// Bluesky。
//
// API は public.api.bsky.app（公式の公開 AppView、CORS *）。投稿が動画を持つときは、
// 投稿者の DID ドキュメントのために plc.directory も使う。原本の blob を抱えている PDS を
// 名指ししているのがそのドキュメント（bskyMedia を参照）。

import { anySrc, findAncestorContainerLink, hostnameMatches, parseMediaUrlPath, prepareScopedCaptureState } from './dom.ts';
import { emptyRecord, normalizeHashtags, readJsonKeepingRaw, toIso } from './record.ts';
import type { Extractor, LinkCard, MediaIdentity, MediaItem, PostMediaElement, PostRecord } from './types.ts';

const HOSTS = ['bsky.app'];
const POST_CONTAINER = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';

// === DOM ===

function getBlueskyAuthorHandle(post: Element): string {
  const testId = post.getAttribute('data-testid') || '';
  const match = testId.match(/-by-(.+)$/);
  return match?.[1] || '';
}

interface BlueskyPostLink {
  url: string;
  handle: string;
  postId: string;
}

function getBlueskyPostLink(post: Element): BlueskyPostLink | null {
  const authorHandle = getBlueskyAuthorHandle(post);
  // 埋め込みの引用カード（入れ子の [role="link"]）に属するアンカーと、投稿本文のリッチ
  // テキストのリンクを除く。スレッドの起点の投稿（自分自身への permalink のアンカーを
  // 持たない）では、それらが残った唯一の候補になり、引用元の投稿の URL が保存されて
  // いた。除いてしまえば null が返り、getPermalink が location.href へ退避する。詳細
  // ページではそれがまさにクリックされた投稿。(audit 2026-06-11)
  const links: BlueskyPostLink[] =
    post instanceof Element
      ? Array.from(post.querySelectorAll<HTMLAnchorElement>('a[href]'))
          .filter((link) => {
            // 親から始める。アンカー自身が role="link" を持つことがあり
            // （react-native-web）、closest() がそれに当たって全部を除いてしまうため。
            const roleLink = link.parentElement && link.parentElement.closest('[role="link"]');
            if (roleLink && roleLink !== post && post.contains(roleLink)) return false;
            if (link.closest('[data-testid="postText"]')) return false;
            return true;
          })
          .map((link) => parseBlueskyPostLink(link.href))
          .filter((v): v is BlueskyPostLink => Boolean(v))
      : [];

  if (!links.length) {
    return null;
  }

  return links.find((link) => !authorHandle || link.handle === authorHandle) || links[0] || null;
}

function parseBlueskyPostLink(href: string): BlueskyPostLink | null {
  try {
    const url = new URL(href, location.origin);
    const match = url.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)\/?$/);
    if (!match) {
      return null;
    }
    const handle = match[1];
    const postId = match[2];
    if (handle === undefined || postId === undefined) return null;

    return {
      url: `${url.origin}/profile/${handle}/post/${postId}`,
      handle: decodeURIComponent(handle),
      postId: decodeURIComponent(postId),
    };
  } catch {
    return null;
  }
}

// === API ===

async function resolveBlueskyDid(rec: PostRecord, handle) {
  if (!handle || handle.startsWith('did:')) return handle || null;
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!res.ok) return null;
    const data = await readJsonKeepingRaw(rec, 'api:bluesky/resolveHandle', res);
    return data.did && /^did:[a-z]+:.+/.test(data.did) ? data.did : null;
  } catch {
    return null;
  }
}

// アカウントのリポジトリを、したがってその blob を抱えている PDS を名指ししているのは、
// そのアカウントの DID ドキュメントだけ。だから動画の保存には、AppView の先にもう1段の
// 解決が要る (#119 St2)。did:plc は PLC ディレクトリに（CORS *）、did:web は DID が名指し
// するドメインの well-known のパスに在る。
function blueskyDidDocUrl(did) {
  if (typeof did !== 'string') return null;
  if (did.startsWith('did:plc:')) return `https://plc.directory/${encodeURIComponent(did)}`;
  if (did.startsWith('did:web:')) {
    // did:web:<host>[:<path>…]。host はパーセントデコードする（ポートは %3A の形で来る）。
    // コロン区切りでそれ以降に続く区間はパスで、.well-known の接頭辞を置き換える。
    const parts = did.slice('did:web:'.length).split(':').map(decodeURIComponent);
    const host = parts.shift();
    if (!host || host.includes('/')) return null;
    return `https://${host}/${parts.length ? `${parts.join('/')}/` : '.well-known/'}did.json`;
  }
  return null; // 知らない DID メソッドには、こちらが辿れる解決の規則が無い
}

async function resolveBlueskyPds(rec: PostRecord, did): Promise<string | null> {
  const docUrl = blueskyDidDocUrl(did);
  if (!docUrl) return null;
  try {
    const res = await fetch(docUrl);
    if (!res.ok) return null;
    const doc = await readJsonKeepingRaw(rec, 'api:bluesky/didDocument', res);
    const services = Array.isArray(doc && doc.service) ? doc.service : [];
    // service の id は、PLC ディレクトリの出力では相対（'#atproto_pds'）で、手書きの
    // did:web のドキュメントでは絶対（'<did>#atproto_pds'）でありうる。
    const svc = services.find((s) => s && (s.id === '#atproto_pds' || s.id === `${did}#atproto_pds`));
    const ep = svc && svc.serviceEndpoint;
    // エンドポイントはアカウントの持ち主が選ぶので、Misskey/Mastodon のインスタンスと
    // まったく同じく任意のホストになる。ここでは https であることだけを要求し、解決した
    // アドレスの検査はダウンロード時にネイティブホストの SSRF の防ぎへ委ねる。
    if (typeof ep !== 'string' || !/^https:\/\//i.test(ep)) return null;
    return ep.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function bskyMediaType(post) {
  const e = post.embed || (post.record && post.record.embed);
  const type = e && e.$type ? e.$type : '';
  if (type.includes('app.bsky.embed.video')) return 'video';
  if (type.includes('app.bsky.embed.images')) return 'image';
  if (type.includes('recordWithMedia')) {
    const mt = e.media && e.media.$type ? e.media.$type : '';
    if (mt.includes('video')) return 'video';
    if (mt.includes('images')) return 'image';
  }
  return null;
}

// 動画の embed そのもの（view か、record 自身の embed）。recordWithMedia のエンベロープは
// 剥がす。投稿が動画を持たなければ null。
function bskyVideoEmbed(post) {
  const e = post.embed || (post.record && post.record.embed);
  if (!e) return null;
  const type = e.$type || '';
  if (type.includes('app.bsky.embed.video')) return e;
  if (type.includes('recordWithMedia') && e.media && (e.media.$type || '').includes('app.bsky.embed.video')) return e.media;
  return null;
}

// images か video の embed（あるいは recordWithMedia）から取る、原寸のメディア。
//
// 動画 (#119 St2)。embed の view が出すのは HLS のプレイリストで、これは変換後のもの。
// 投稿者が上げた原本は今もその repo の中の blob で、どのクライアントも
// <pds>/xrpc/com.atproto.sync.getBlob?did=…&cid=… で認証なしに読める。だから Bluesky も
// St1 のプラットフォームと同じ形で保存する＝要求1本、ファイル1つ、セグメントの継ぎ合わせも
// remux も無し。`pds` は resolveBlueskyPds が見つけたエンドポイント。これが無ければ動画へ
// 手が届かないので、代わりにサムネイルを1枚の静止画として残す。そうすれば保存はその投稿の
// 絵を持ったままになる（レコードの mediaType はどちらでも 'video' のまま）。
//
// DID ドキュメントの参照を bsky.social の getBlob のリダイレクトで代用してはいけない。
// あれは自分がホストしていないアカウントについても答え、自分のサーバーの1つを指すが、
// そこに blob は無い（2026-07-29 に実測＝did:plc:44ybard66vv44zksje25o7dz は
// pds.robocracy.org に居るのに、bsky.social は要求を
// morel.us-east.host.bsky.network へ送った）。
function bskyMedia(post, pds?: string | null) {
  const video = bskyVideoEmbed(post);
  if (video) {
    const did = (post.author && post.author.did) || null;
    const common = {
      alt: video.alt || null,
      width: (video.aspectRatio && video.aspectRatio.width) || null,
      height: (video.aspectRatio && video.aspectRatio.height) || null,
    };
    if (pds && did && video.cid) {
      return [{ ...common, url: `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(video.cid)}`, type: 'video' as const, poster: video.thumbnail || null }];
    }
    return video.thumbnail ? [{ ...common, url: video.thumbnail }] : [];
  }
  const e = post.embed || (post.record && post.record.embed);
  if (!e) return [];
  const type = e.$type || '';
  let images: any = null;
  if (type.includes('app.bsky.embed.images')) images = e.images;
  else if (type.includes('recordWithMedia') && e.media && (e.media.$type || '').includes('images')) images = e.media.images;
  if (!Array.isArray(images)) return [];
  return images
    .filter((im) => im && im.fullsize)
    .map((im) => ({
      url: im.fullsize,
      alt: im.alt || null,
      width: (im.aspectRatio && im.aspectRatio.width) || null,
      height: (im.aspectRatio && im.aspectRatio.height) || null,
    }));
}

// 投稿のタグは1つのレコードの中の2か所に在り、どちらも投稿者が付けたもの (#177)。本文に
// 打ち込まれた '#…' の並びはリッチテキストのファセット＝feature の $type が
// app.bsky.richtext.facet#tag で、その `tag` は '#' を含まない値を持つ（lexicon いわく
// 「the facet reference should not [include the prefix]」）。record.tags[] はそれとは別の、
// lexicon の言う「additional hashtags, in addition to any included in post text and
// facets」（最大8）で、本文に混ぜないタグ欄を出すクライアントはこちらへ書く。片方しか
// 読まないと、どのクライアントが投稿したかによって、その投稿のタグの半分を落とす。
function bskyHashtags(record): string[] {
  const facets = Array.isArray(record.facets) ? record.facets : [];
  const inline = facets
    .flatMap((f) => (f && Array.isArray(f.features) ? f.features : []))
    .filter((ft) => ft && String(ft.$type || '').includes('richtext.facet#tag'))
    .map((ft) => ft.tag);
  return normalizeHashtags([...inline, ...(Array.isArray(record.tags) ? record.tags : [])]);
}

// #178: Bluesky に自由記述の閲覧注意の欄は無く、自分で付けるモデレーションのラベルだけが
// ある（com.atproto.label.defs#selfLabels＝record.labels.values[].val。公式の lexicon で
// 確認: raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/
// {app/bsky/feed/post,com/atproto/label/defs}.json）。ここで配慮が要ると数えるのは内容の
// ラベルだけ。'bot'（アカウントの種類の印）とモデレーションの指示（'!hide'/'!warn'/
// '!no-unauthenticated'）は別の問いに答えるもので、これを数えると普通の bot アカウントや
// 自主モデレーションの印を成人向けと誤判定してしまう。この行まで来た投稿には必ず確たる
// 答えがある（レコードがラベルを持つか持たないかのどちらかで、ネットワークの取得のように
// 失敗しうるものは何も無い）ので、無いことは null ではなく確信のある false になる。
const BLUESKY_SENSITIVE_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media']);
function bskySensitive(record): boolean {
  const values = record.labels && Array.isArray(record.labels.values) ? record.labels.values : [];
  return values.some((v) => v && BLUESKY_SENSITIVE_LABELS.has(v.val));
}

// #180: 引用された ViewRecord のメディア。最上位の抽出である bskyMedia をあえて使わない。
// あちらは post.embed/post.record.embed を読むが、ViewRecord の解決済みのメディアは1段
// 浅い .embeds[] に在る（配列なのは、recordWithMedia が images の embed を video の embed と
// 並べて持てるから）。動画は view 自身の .playlist からそのまま読む＝最上位の経路のような
// PDS への往復はしない。あの往復はダウンロードできる blob の URL を組み立てるためだけに
// あり、#180 の v1 は引用のメディアをダウンロードしないから（URL は記録するが、ファイルは
// 取りに行かない＝#290 が他所で引いたのと同じ線）。
function bskyQuotedMedia(vr): MediaItem[] {
  const embeds = Array.isArray(vr && vr.embeds) ? vr.embeds : [];
  const out: MediaItem[] = [];
  for (const e of embeds) {
    if (!e) continue;
    const type = e.$type || '';
    if (type.includes('images') && Array.isArray(e.images)) {
      for (const im of e.images) {
        if (!im || !im.fullsize) continue;
        out.push({ url: im.fullsize, alt: im.alt || null, width: (im.aspectRatio && im.aspectRatio.width) || null, height: (im.aspectRatio && im.aspectRatio.height) || null });
      }
    } else if (type.includes('video') && e.playlist) {
      out.push({ url: e.playlist, alt: e.alt || null, width: (e.aspectRatio && e.aspectRatio.width) || null, height: (e.aspectRatio && e.aspectRatio.height) || null, type: 'video' as const, poster: e.thumbnail || null });
    }
  }
  return out;
}

// #181: app.bsky.embed.external の解決済みの view（recordWithMedia は、bskyMedia がすでに
// 剥がしているのと同じ1段の入れ子にする）。公式の lexicon で確認（bluesky-social/atproto の
// lexicons/app/bsky/embed/external.json を 2026-08-02 に確認）＝record 側の external.thumb は
// blob の参照だが、AppView がここへ届く前に素の https の URL へ解決している（view 自身の
// external.thumb は URL 文字列として文書化されている）。だからここが blob の参照に触ること
// はない。bskyMedia の動画の経路が PDS を解決するのは、そちらに触るから。
function bskyLinkCard(post): LinkCard | null {
  const e = post.embed || (post.record && post.record.embed);
  if (!e) return null;
  const type = e.$type || '';
  let ext: any = null;
  if (type.includes('app.bsky.embed.external')) ext = e.external;
  else if (type.includes('recordWithMedia') && e.media && (e.media.$type || '').includes('app.bsky.embed.external')) ext = e.media.external;
  if (!ext || typeof ext.uri !== 'string' || !ext.uri) return null;
  return { url: ext.uri, title: ext.title || null, description: ext.description || null, thumbnail: ext.thumb || null };
}

async function fetchBlueskyPost(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'bluesky');
  rec.screenName = parsed.handle;
  const did = await resolveBlueskyDid(rec, parsed.handle);
  if (did) rec.userId = did;
  if (!did) return rec;
  try {
    const uri = `at://${did}/app.bsky.feed.post/${parsed.rkey}`;
    // parentHeight=0 とする。返信先の親の ID は投稿自身の record（下の
    // record.reply.parent.uri）から来るので、祖先の投稿はもともとここでは使っていない。
    // レスポンス本文をそのまま残すようになった今 (#292)、要求しないままにしておかなければ
    // ならない＝原本の層の境界はこのレコードのための payload であって、誰も読まない隣の
    // 投稿がそれに便乗して入ってきてはいけない。
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=0`);
    if (!res.ok) return rec;
    const data = await readJsonKeepingRaw(rec, 'api:bluesky/getPostThread', res);
    const thread = data && data.thread;
    const post = thread && thread.post;
    if (!post) return rec;
    const record = post.record || {};
    rec.text = record.text || null;
    rec.date = toIso(record.createdAt);
    rec.likes = post.likeCount ?? null;
    rec.reposts = post.repostCount ?? null;
    rec.replies = post.replyCount ?? null;
    if (post.author) {
      rec.displayName = post.author.displayName || null;
      rec.screenName = post.author.handle || rec.screenName;
      rec.userId = post.author.did || rec.userId;
      rec.avatar = post.author.avatar || null; // ProfileViewBasic がアバターを持っている
    }
    // フォロワー数とアカウントの作成日。投稿の author の view は ProfileViewBasic で、
    // これらを持たないので、DID でプロフィール全体を取りにいく。失敗しても、author の
    // view からすでに得ているアバターはそのまま残る。
    const actor = (post.author && post.author.did) || did;
    if (actor) {
      try {
        const pres = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
        if (pres.ok) {
          const prof = await readJsonKeepingRaw(rec, 'api:bluesky/getProfile', pres);
          rec.avatar = prof.avatar || rec.avatar;
          rec.followers = prof.followersCount ?? null;
          rec.authorCreatedAt = toIso(prof.createdAt);
          // #289: 自己紹介とバナーは、上の followers/authorCreatedAt のためにすでに取得
          // している同じ getProfile のレスポンスに相乗りする（app.bsky.actor.defs の
          // profileViewDetailed の description/banner。公式の lexicon で確認）。
          // profileLinks は無い＝Bluesky にリンク欄の概念がそもそも無い
          // （rec.profileLinks は emptyRecord() の null のまま）。
          rec.bio = prof.description || null;
          rec.banner = prof.banner || null;
        }
      } catch {
        /* author の view から得たアバターはそのまま残す */
      }
    }
    if (record.langs && record.langs.length) rec.lang = record.langs[0];
    rec.hashtags = bskyHashtags(record);
    rec.sensitive = bskySensitive(record);
    rec.mediaType = bskyMediaType(post);
    // DID ドキュメントへの往復の代金を払うのは動画の投稿だけ。画像の投稿は、AppView から
    // すでに fullsize の URL を得ている。
    const pds = bskyVideoEmbed(post) ? await resolveBlueskyPds(rec, (post.author && post.author.did) || did) : null;
    rec.media = bskyMedia(post, pds);
    if (record.reply) {
      rec.isReply = true;
      // 自己返信（スレッド）＝親の投稿者 DID がこの投稿者と一致する
      const parentUri = record.reply.parent && record.reply.parent.uri;
      const m = parentUri && parentUri.match(/^at:\/\/(did:[^/]+)\//);
      const pm = parentUri && parentUri.match(/\/app\.bsky\.feed\.post\/([^/?#]+)/);
      rec.replyToId = pm ? pm[1] : null;
      if (m && post.author && m[1] === post.author.did) {
        rec.isThread = true;
        rec.isReply = null;
      }
    }
    rec.linkCard = bskyLinkCard(post);
    const embType = (post.embed && post.embed.$type) || (record.embed && record.embed.$type) || '';
    if (embType.includes('app.bsky.embed.record')) {
      const rec2 = (post.embed && post.embed.record) || {};
      const quri = rec2.uri || (rec2.record && rec2.record.uri);
      // 引用と数えるのは、引用された投稿だけ。embed.record は一覧・フィード・スターター
      // パックも包む（それらの uri は app.bsky.graph.* / app.bsky.feed.generator）が、
      // これらでその投稿を引用と印付けてはいけない。feed.post の uri で門を張る。
      const qm = typeof quri === 'string' ? quri.match(/^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)/) : null;
      if (qm) {
        rec.isQuote = true;
        // recordWithMedia は、引用された ViewRecord を1段深く入れ子にする
        // （embed.record.record）。handle は、それを持っている方の段から読む。この入れ子は
        // handle だけでなく ViewRecord 全体（author/value/embeds）に効く＝下の vr は、
        // どちらの形でもその唯一の本物の ViewRecord。
        const vr = rec2.uri ? rec2 : rec2.record || {};
        const qhandle = (vr.author && vr.author.handle) || qm[1];
        rec.quotedUrl = `https://bsky.app/profile/${qhandle}/post/${qm[2]}`;
        // #180: サブレコードに要るものは、すでにこの ViewRecord の中に全部ある＝.value が
        // 引用されたレコード自体（text/createdAt）で、.embeds が AppView がそれについて
        // すでに解決済みのメディア（fullsize の画像 URL、動画 view の playlist）。だから
        // これを組み立てるのに2本目の要求は使わない。
        const qval = vr.value || {};
        rec.quotedPost = {
          url: rec.quotedUrl,
          displayName: (vr.author && vr.author.displayName) || null,
          screenName: (vr.author && vr.author.handle) || null,
          userId: (vr.author && vr.author.did) || null,
          avatar: (vr.author && vr.author.avatar) || null,
          text: qval.text || null,
          date: toIso(qval.createdAt),
          cw: null, // Bluesky に自由記述の閲覧注意の欄は無い（上の rec.sensitive を参照）
          media: bskyQuotedMedia(vr),
        };
      }
    }
  } catch {
    // 部分的なまま残す
  }
  return rec;
}

async function fetchBlueskyProfile(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'bluesky');
  rec.screenName = parsed.actor;
  try {
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(parsed.actor)}`);
    if (!res.ok) return rec;
    const prof = await readJsonKeepingRaw(rec, 'api:bluesky/getProfile', res);
    rec.userId = prof.did || null;
    rec.screenName = prof.handle || rec.screenName;
    rec.displayName = prof.displayName || null;
    rec.avatar = prof.avatar || null;
    rec.bio = prof.description || null;
    rec.banner = prof.banner || null;
    rec.followers = prof.followersCount ?? null;
    rec.authorCreatedAt = toIso(prof.createdAt);
  } catch {
    /* URL から分かる identity は残す */
  }
  return rec;
}

// === extractor 本体 ===

const bluesky: Extractor = {
  platform: 'bluesky',

  parseUrl(u) {
    if (u.hostname !== 'bsky.app') return null;
    const m = u.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!m) return null;
    return { platform: 'bluesky', handle: m[1], rkey: m[2] };
  },
  parseProfileUrl(u) {
    if (u.hostname !== 'bsky.app') return null;
    const m = u.pathname.match(/^\/profile\/([^/]+)\/?$/);
    if (!m) return null;
    const actor = decodeURIComponent(m[1] as string);
    return { platform: 'bluesky', actor, url: `https://bsky.app/profile/${encodeURIComponent(actor)}` };
  },
  isAllowedOrigin: (_tabUrl, hostname) => HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)),

  fetchPost: fetchBlueskyPost,
  fetchProfile: fetchBlueskyProfile,

  // blob の CID。feed_thumbnail と feed_fullsize が共有していて、@jpeg の形式の接尾辞は
  // 付いていることも付いていないこともある。
  mediaKey: (url) => (url.match(/\/([a-z0-9]{50,})(?:@|\b)/i) || [])[1] || null,
  highResUrl: (url) => (url.includes('cdn.bsky.app') ? url.replace(/@jpeg$/, '') : null),

  matchesPage: () => hostnameMatches('bsky.app'),

  capture: {
    platform: 'bluesky',
    postSelector: '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"], [role="link"]',
    isPostElement(el: Element): boolean {
      if (el.getAttribute('data-testid')) return true;
      return el.getAttribute('role') === 'link' && !!el.querySelector('[data-testid="postText"], [data-testid="repostBtn"]');
    },
    captureStyleText: `
        .__snsCaptureBskyNoHover,
        .__snsCaptureBskyNoHover * {
          pointer-events: none !important;
          transition: none !important;
        }

        .__snsCaptureBskyNoHover,
        .__snsCaptureBskyNoHover:hover,
        .__snsCaptureBskyNoHover > div,
        .__snsCaptureBskyNoHover > div:hover,
        .__snsCaptureBskyNoHover article,
        .__snsCaptureBskyNoHover article:hover {
          background-color: transparent !important;
          filter: none !important;
        }
      `,
    getPermalink(post: Element): string {
      return getBlueskyPostLink(post)?.url || parseBlueskyPostLink(location.href)?.url || '';
    },
    prepareForCapture(post: Element) {
      return prepareScopedCaptureState('__snsCaptureBskyNoHover', [post, post.parentElement, post.parentElement?.parentElement, post.closest('[data-testid^="feedItem-by-"]')?.parentElement, post.closest('[data-testid^="postThreadItem-by-"]')?.parentElement]);
    },
  },

  mediaIdentity: {
    platform: 'bluesky',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      const link = (el.closest('a[href*="/post/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(el, 'a[href*="/post/"]', POST_CONTAINER) as HTMLAnchorElement | null);
      const parsed = link ? parseMediaUrlPath(link.href, /^\/profile\/([^/]+)\/post\/([^/?#]+)/) : null;
      let handle: string | undefined, postId: string | undefined;
      if (parsed) {
        [, handle, postId] = parsed.match;
      } else {
        // 投稿の詳細ページで、どの投稿コンテナにも入っていないアンカー無しの画像
        // （画像ビューアなど）。これは URL バーが素性を示す。
        const loc = location.pathname.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/);
        if (!loc || el.closest(POST_CONTAINER)) return null;
        [, handle, postId] = loc;
      }
      if (!handle || !postId) return null;
      // 正規の permalink。アンカーは /liked-by、/reposted-by、/quotes の接尾辞を持つこと
      // がある（スレッドの起点の投稿に付くエンゲージメント数へのリンク）。
      return { postId: decodeURIComponent(postId), link: `https://bsky.app/profile/${handle}/post/${postId}` };
    },
    // feed_thumbnail / feed_fullsize は投稿の絵。アバターとバナーは同じ CDN の
    // /img/avatar/ と /img/banner/ の下に在る。
    isPostMedia: (el) => anySrc(el, (src) => src.includes('cdn.bsky.app/img/feed_')),
  },

  overlay: {
    unitSelector: POST_CONTAINER,
    mediaIn: (unit) => [...unit.querySelectorAll('img[src*="/img/feed_thumbnail/"], img[src*="/img/feed_fullsize/"], video')],
    // 投稿者のアバター (#575)。上の isPostMedia の検査が退けるのと同じ CDN パスの一族で、
    // だからこそ、印を留めても保存の対象と取り違えられることがない。
    textAnchorIn: (unit) => unit.querySelector('img[src*="/img/avatar"]'),
  },

  residentMatches: ['https://bsky.app/*'],
};

export default bluesky;
export { bskyMedia, fetchBlueskyPost, getBlueskyPostLink, parseBlueskyPostLink };
export type { BlueskyPostLink };
