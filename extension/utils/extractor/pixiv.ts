import { ExtractedPostSchema } from '../../../native-host/protocol.mts';
import { PixivEnvelopeSchema, PixivIllustSchema, PixivPagesSchema, PixivProfileSchema, PixivUgoiraSchema, rethrowContractError } from './api-schemas.ts';
// pixiv。
//
// API は www.pixiv.net/ajax/*（サイト自身の、文書化されていないフロントエンド用 API）。
// ログイン済みの利用者が R-18 やフォロワー限定の作品を読めるように、host_permissions と
// 資格情報が要る。

import { anySrc, findAncestorContainerLink, hostnameMatches, mediaHostIs, mediaSrcs, parseMediaUrlPath } from './dom.ts';
import { emptyRecord, htmlToText, normalizeHashtags, readJsonResponse, toIso } from './record.ts';
import type { Extractor, MediaIdentity, MediaItem, PostMediaElement, PostRecord } from './types.ts';

const HOSTS = ['www.pixiv.net', 'pixiv.net'];
const PIXIV_REFERER = 'https://www.pixiv.net/';

// 同じ pximg のファイル名 <artworkId>_p<page>_<size>.<ext> に対する3通りの見方。1本にまとめて
// 2つのグループを持たせず別々のパターンのままにしてあるのは、肝心なところで末尾が違うから
// ＝ARTWORK_ID はページ番号の後に文字列の終端を決して受け付けず、MEDIA_KEY は受け付け、
// PAGE_INDEX はページ番号だけを求める。まとめると、どの呼び出し元がどの URL を見分けるかが
// 黙って変わってしまう。
//
// 一括取り込みのたびに入口が注入し直されるが、モジュールのスコープに置いて問題ない。入口は
// 単体のスクリプトとしてバンドルされるので、注入のたびにこれらは新しい関数スコープで
// 評価される（包まれていないトップレベルの `const` は、スクリプトが自前の再注入の防ぎを走ら
// せる前に「already declared」で例外を投げていた）。
const PXIMG_ARTWORK_ID = /\/(\d+)_p\d+(?:_|\.)/;
const PXIMG_MEDIA_KEY = /\/(\d+_p\d+)(?:[._]|$)/;
const PXIMG_PAGE_INDEX = /\/\d+_p(\d+)[._]/;
const ARTWORK_PATH = /^\/(?:[a-z]+\/)?artworks\/(\d+)/;
// /users/<id>/bookmarks/artworks。日本語以外のブラウザ向けに pixiv が足す /<locale>/ の
// 接頭辞が付くこともある（/en/users/123/bookmarks/artworks など）。タグでの絞り込みや
// 公開／非公開の切り替えはクエリ文字列（?tag=…、?rest=hide）として乗ってくるが、ここでは
// 一切見ない。誰のブックマーク一覧かは pathname だけで分かる (#280)。
const BOOKMARKS_PATH = /^\/(?:[a-z]{2}\/)?users\/(\d+)\/bookmarks\/artworks(?:\/|$)/;

// === DOM ===

function pixivIdFromImg(img: Element | null): string | null {
  if (!(img instanceof HTMLImageElement)) return null;
  for (const src of [img.src, img.currentSrc]) {
    const m = src && src.match(PXIMG_ARTWORK_ID);
    if (m) return m[1] ?? null;
  }
  return null;
}

function pixivIdFromArtworkLink(link: Element | null): string | null {
  if (!(link instanceof Element)) return null;
  const m = (link.getAttribute('href') || '').match(/\/artworks\/(\d+)/);
  return m ? (m[1] ?? null) : null;
}

function pixivPointerOverlayInMedia(overlay: Element, mediaBox: Element): boolean {
  const button = overlay.tagName === 'BUTTON' ? overlay : overlay.querySelector(':scope > button');
  const controls = button?.parentElement;
  if (!button || !controls) return false;
  const buttons = [...controls.children].filter((child) => child.tagName === 'BUTTON');
  if (buttons.length !== 2 || buttons.some((child) => child.textContent?.trim())) return false;
  const viewer = controls.closest('[role="presentation"]');
  return !!viewer && viewer.contains(mediaBox);
}

// 右クリック／ホバーの対象を起点にして { id, el } を解決する。closest() で上へ遡るだけで、
// 広い範囲の子孫を文書順に走査することは決してしない。走査すると、作品が並ぶグリッドでは
// クリックしたものではなく隣（DOM 順で最初の pximg）を拾ってしまう。（これが「隣を拾う」
// 不具合。対象を起点に closest() で辿れば、作りからしてそうならない。）
// 優先順位は、対象自身の pximg の画像（曖昧さが無い）→ いちばん近い外側の /artworks/ の
// リンク → いちばん近い <figure> の主画像 → /artworks/ の URL バー。
function resolvePixivTarget(target: EventTarget | null): { id: string; el: Element } | null {
  const el = target instanceof Element ? target : (target as Node | null)?.parentElement;
  if (!el) return null;

  const img = el.matches('img') ? el : el.closest('img');
  const idFromImg = pixivIdFromImg(img);
  if (idFromImg && img) return { id: idFromImg, el: img };

  const link = el.closest('a[href*="/artworks/"]');
  const idFromLink = pixivIdFromArtworkLink(link);
  if (idFromLink && link) return { id: idFromLink, el: link };

  const fig = el.closest('figure');
  if (fig) {
    const figImg = fig.querySelector('img');
    const idFromFig = pixivIdFromImg(figImg);
    if (idFromFig) return { id: idFromFig, el: figImg || fig };
  }

  const locId = (location.pathname.match(/\/artworks\/(\d+)/) || [])[1];
  if (locId) {
    // 退避先は、素のクリック対象ではなく作品そのものに留める。そうしないと、コメント者の
    // アバターやタグのチップをクリックしたとき、その要素の画素が作品のメタデータの下に
    // 保存されてしまう。(audit 2026-06-11)
    const mainImg = document.querySelector('main figure img, figure img[src*="i.pximg.net"]');
    return { id: locId, el: fig || (mainImg ? mainImg.closest('figure') || mainImg : el) };
  }
  return null;
}

function getPixivPermalink(post: Element): string {
  const r = resolvePixivTarget(post);
  return r ? `https://www.pixiv.net/artworks/${r.id}` : '';
}

// 一覧のカード／サムネイルと、個別作品ページの未展開表示は作品全体。個別
// 作品ページで展開した画像だけは1ページ。右クリック保存がこの区別を使う。
//
// pixiv の個別作品ページでは、未展開の主画像も原寸画像へのリンクになって
// いる。そのリンクだけでは展開画像と区別できないので、URL が指す現在作品と
// 対象画像の作品 id を照合し、ハッシュ付きの原寸表示か、同じ作品の複数ページ
// が原寸リンクとして並んだ状態だけを展開済みとする。
// === ブックマーク一覧（まとめての取り込み、#280） ===

// このブックマーク一覧が誰のものだと URL が主張しているか、そのユーザー id。その一覧から
// 外れていれば null。純粋で同期的な関数にしてある。bulk-capture.ts の中の「利用者が
// 離脱していないか」を見張る検査が DOM の変化のたびにこれを呼ぶので、これ自身がネット
// ワークへ手を伸ばすことは決してあってはならない（伸ばすのは下の isPixivOwnBookmarksPage
// だけで、しかも1回の実行につき1度だけ）。
function pixivBookmarksUserIdFromUrl(pathname: string = location.pathname): string | null {
  return (pathname.match(BOOKMARKS_PATH) || [])[1] || null;
}

// 1回の実行の間だけ覚えておく。このページが開いている間にログイン中の利用者自身の id が
// 変わることはないし、一括取り込みを注入し直せばどのみち新しいモジュール
// スコープになる（上の PXIMG_* のコメントを参照）ので、これを途中で捨てる必要のある道は
// そもそも無い。
let selfUserIdPromise: Promise<string | null> | null = null;

// pixiv は、誰の公開ブックマークにも同じ形の URL を出す。だから一覧を読むときは、このモード
// が動く前に、それが誰のものかを確かめなければならない。さもないと、赤の他人が集めたものを
// 利用者自身のアカウントの下へ自動で保存してしまう（#280 の「なぜ」＝この機能の存在理由は
// まるごと、利用者自身が1つずつ押したブックマークをもう一度形にすることにある）。ブック
// マーク一覧のページの DOM には、突き合わせる相手になるログイン中の利用者の id が無い
// （ここには #meta-global-data が無い。実物の保存で確認、2026-08-02）。セッションの Cookie
// に対してそれを今も答えてくれる唯一の場所が、pixiv 自身の個人設定のエンドポイント。
async function fetchPixivSelfUserId(): Promise<string | null> {
  if (!selfUserIdPromise) {
    selfUserIdPromise = (async () => {
      try {
        const res = await fetch('https://www.pixiv.net/ajax/settings/self', { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json();
        if (data.error) return null;
        const id = data.body && data.body.user_status && data.body.user_status.user_id;
        return typeof id === 'string' && id ? id : null;
      } catch (error) {
        rethrowContractError(error);
        return null;
      }
    })();
  }
  return selfUserIdPromise;
}

// isBulkCapturePage の門 (#280)。true になるのは、見ている本人自身のブックマーク一覧の
// ときだけ。タグでの絞り込みや公開／非公開の切り替えでこれは変わらない。どちらも同じ人の
// 一覧を絞り込んだだけだから（Issue #280 の設計＝
// 「取込元の値はどれも pixiv-bookmarks とし、タグやページごとに分けない」）。
async function isPixivOwnBookmarksPage(): Promise<boolean> {
  const urlUserId = pixivBookmarksUserIdFromUrl();
  if (!urlUserId) return false;
  const selfId = await fetchPixivSelfUserId();
  return selfId != null && selfId === urlUserId;
}

// === API ===

// うごイラ (#119 St3)。illustType 2 は、pixiv がコマ画像の ZIP と、コマごとの表示時間の表と
// いう別々の2つで配るアニメーション。どちらも illust の payload には無く、両方を持っている
// のが /ugoira_meta。書庫は手を加えずそのまま保存する（変換しないので、配布物にエンコーダが
// 紛れ込まないし、コマは pixiv が出した品質のまま）。`originalSrc` が原寸の書庫で、`src` は
// 600x600 のプレビューの書庫＝退避先にすぎない。illust の `urls.original` は素の jpg として
// のコマ0で、こちらでコマを取り出さずにポスターとして使える。

async function pixivUgoiraMedia(_rec: PostRecord, id, il): Promise<MediaItem[]> {
  try {
    const res = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(id)}/ugoira_meta`, { credentials: 'include' });
    if (!res.ok) return [];
    const data = PixivEnvelopeSchema.parse(await readJsonResponse(res));
    if (data.error) return [];
    const body = PixivUgoiraSchema.parse(data.body);
    const url = body.url;
    const frames = body.frames;
    // コマの表が無ければ、その書庫を再生できるものは何も無い。時間を刻めないアニメーション
    // を保存するのではなく、取得の失敗として扱う。
    // URL とコマの必須条件は PixivUgoiraSchema で検証済み。
    return [{ url, alt: null, width: il.width || null, height: il.height || null, referer: PIXIV_REFERER, type: 'ugoira', poster: (il.urls && il.urls.original) || null, frames }];
  } catch (error) {
    rethrowContractError(error);
    return [];
  }
}

// 原寸の静止画。複数ページの作品では、ページ0が urls.original に出ていて、他のページは
// 同じパスの _p0 を _pN に置き換えたもの。各エントリが Referer を持つのは、i.pximg.net が
// Referer 無しのダウンロードを 403 で断るから（ネイティブホストが media[].referer を
// 尊重する）。
function pixivMedia(il) {
  const original = il && il.urls && il.urls.original;
  if (!original) return [];
  const pageCount = il.pageCount || 1;
  const out: MediaItem[] = [];
  for (let i = 0; i < pageCount; i++) {
    const url = i === 0 ? original : original.replace(/_p0(\.[a-z]+)$/i, `_p${i}$1`);
    out.push({
      url,
      alt: null,
      width: i === 0 ? il.width || null : null,
      height: i === 0 ? il.height || null : null,
      referer: PIXIV_REFERER,
    });
  }
  return out;
}

// #289: user のレスポンスの `webpage`（自由記述の URL 1つ）と `social.<key>.url`（連携した
// サービスごとに1エントリ＝twitter や pixiv-fanbox など。サービス名をキーにした素の
// オブジェクト）。pixiv に確認の概念は無い。
function pixivProfileLinks(input: unknown): { name: string; value: string }[] | null {
  const body = PixivProfileSchema.parse(input);
  const out: { name: string; value: string }[] = [];
  if (body.webpage) out.push({ name: 'webpage', value: body.webpage });
  const social = body.social;
  if (social) {
    for (const [key, entry] of Object.entries(social)) {
      const socialUrl = entry.url;
      if (socialUrl) out.push({ name: key, value: socialUrl });
    }
  }
  return out.length ? out : null;
}

async function fetchPixivIllust(parsed, url): Promise<PostRecord> {
  const rec = emptyRecord(url, 'pixiv');
  try {
    // credentials:include にして、ログイン済みの利用者が R-18 やフォロワー限定の作品を
    // 読めるようにする。
    const res = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(parsed.id)}`, { credentials: 'include' });
    if (!res.ok) return rec;
    const data = PixivEnvelopeSchema.parse(await readJsonResponse(res));
    // 削除済み・非公開・未ログインでの R-18 では、pixiv は 200 と { error:true } を返す。
    if (data.error) return rec;
    const il = PixivIllustSchema.parse(data.body);
    rec.title = il.illustTitle || null;
    // キャプション（HTML）をテキストにする。キャプションの語を表示側で検索できるように。
    rec.text = htmlToText(il.illustComment || il.description || '');
    rec.displayName = il.userName || null;
    rec.screenName = il.userId || null; // pixiv に @ のハンドルは無く、安定した id は userId
    rec.userId = il.userId || null;
    rec.likes = il.likeCount ?? null;
    rec.bookmarks = il.bookmarkCount ?? null;
    rec.views = il.viewCount ?? null;
    rec.replies = il.commentCount ?? null;
    rec.date = toIso(il.createDate || il.uploadDate);
    // pixiv の tags.tags[].tag はもともと裸のタグ。共通の規則 (#177) は重複を除くだけで
    // 足り、それがどのプラットフォームでも綴りを揃えている。
    rec.hashtags = normalizeHashtags((il.tags?.tags ?? []).map((t) => t.tag));
    // シリーズへの所属 (#188)。seriesNavData が在るのは、シリーズに属する作品のときだけ
    // （実物の保存で確認。単独の作品では null、シリーズ内の作品ではオブジェクトになっている）。
    // その直下の `order`
    // がこの作品自身の位置（1始まり）。next.order/prev.order は隣の作品を説明するもので
    // この作品のものではないので、ここでは使わない。
    if (il.seriesNavData) {
      rec.seriesId = il.seriesNavData.seriesId || null;
      rec.seriesTitle = il.seriesNavData.title || null;
      rec.seriesOrder = il.seriesNavData.order;
    }
    // うごイラは音の無い繰り返しのアニメーション。ライブラリを眺める人にとっては、X の
    // animated_gif と同じ類のもので、あちらはすでに 'gif' と名付けて
    // いる。mediaType は表示のための名前（それが何であるか）、media[].type は運び方
    // （どうダウンロードするか）で、ここで2つが食い違うのは意図してのこと。
    // ファセットの値を増やさないし、UI に語をでっち上げない。
    const ugoira = il.illustType === 2 ? await pixivUgoiraMedia(rec, parsed.id, il) : [];
    rec.mediaType = ugoira.length ? 'gif' : 'image';
    rec.media = ugoira.length ? ugoira : pixivMedia(il);
    // 複数ページの作品は、ページごとにファイル形式が混じりうる（p0=.jpg、p2=.png …）ので、
    // 上の _p0 → _pN の置き換えは 404 になりうる。/ajax/illust/<id>/pages が出すページごとの
    // 原本を優先し、置き換えの方は退避先として残す。
    if (!ugoira.length && (il.pageCount || 1) > 1) {
      try {
        const pres = await fetch(`https://www.pixiv.net/ajax/illust/${encodeURIComponent(parsed.id)}/pages`, { credentials: 'include' });
        if (pres.ok) {
          const pdata = PixivEnvelopeSchema.parse(await readJsonResponse(pres));
          if (!pdata.error) {
            rec.media = PixivPagesSchema.parse(pdata.body).map((p) => ({
              url: p.urls.original,
              alt: null,
              width: p.width || null,
              height: p.height || null,
              referer: PIXIV_REFERER,
            }));
          }
        }
      } catch (error) {
        rethrowContractError(error);
        /* 置き換えで作った退避先をそのまま残す */
      }
    }
    // 投稿者のアバター。illust の payload はアバターを持たないので、user のレコードを取りに
    // いく。pixiv の公開 ajax はフォロワー数もアカウントの作成日も出さないので、そちらは
    // null のまま（X と同じ穏当な隠し方）。失敗すればアバターは null のままになる。
    if (il.userId) {
      try {
        const ures = await fetch(`https://www.pixiv.net/ajax/user/${encodeURIComponent(il.userId)}?full=1`, { credentials: 'include' });
        if (ures.ok) {
          const udata = PixivEnvelopeSchema.parse(await readJsonResponse(ures));
          if (!udata.error) {
            const profile = PixivProfileSchema.parse(udata.body);
            rec.avatar = profile.imageBig || profile.image || null;
            // i.pximg.net は pixiv の Referer が無いと 403 を返す＝ブリッジに付けて送るよう
            // 伝える。
            if (rec.avatar) rec.avatarReferer = PIXIV_REFERER;
            // #289: 自己紹介とリンクは、上と同じ user のレスポンスに相乗りする＝追加の要求
            // は無い。pixiv にバナーの概念は無い（rec.banner は null のまま）。
            rec.bio = profile.commentHtml ? htmlToText(profile.commentHtml) : profile.comment ? profile.comment : null;
            rec.profileLinks = pixivProfileLinks(profile);
          }
        }
      } catch (error) {
        rethrowContractError(error);
        /* アバター無し */
      }
    }
  } catch (error) {
    rethrowContractError(error);
    // ネットワークか解析の失敗＝手元にあるもの（URL だけ）を残す
  }
  return ExtractedPostSchema.parse(rec);
}

// === extractor 本体 ===

const pixiv: Extractor = {
  platform: 'pixiv',

  parseUrl(u) {
    // pixiv の作品は /artworks/<id>（/en /ja のロケールの接頭辞が付くこともある）。
    if (!(u.hostname === 'www.pixiv.net' || u.hostname === 'pixiv.net')) return null;
    const m = u.pathname.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/);
    if (!m) return null;
    return { platform: 'pixiv', id: m[1] };
  },
  isAllowedOrigin: (_tabUrl, hostname) => HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`)),

  fetchPost: fetchPixivIllust,

  // <artworkId>_p<page> は pximg のどの書き換えでも生き残る。square/master のサムネイルは
  // その後ろにサイズの接尾辞を持ち、原本は何も持たない。
  mediaKey: (url) => (url.match(PXIMG_MEDIA_KEY) || [])[1] || null,
  mediaReferer: PIXIV_REFERER,
  // ファイル名の中のページ番号が、ドラッグされた絵が投稿の media[] の何番目のエントリかを、
  // URL の照合なしに言い当てる（pixiv の media[] は1ページ1エントリで、ページ順に並ぶ）。
  mediaPageIndex(imageUrls) {
    for (const u of imageUrls) {
      const m = u && u.match(PXIMG_PAGE_INDEX);
      if (m) return Number.parseInt(m[1] as string, 10);
    }
    return null;
  },

  matchesPage: () => hostnameMatches('pixiv.net'),

  content: {
    platform: 'pixiv',
    getPermalink(post: Element): string {
      return getPixivPermalink(post);
    },
    // まとめての取り込み専用 (#280)。ブックマークのカードは /artworks/ のアンカーを2つ持つ
    // （サムネイルとタイトル）が、harvestFrom がそれらの解決先の permalink で重複を除くので、
    // ここで両方に当たっても害は無い。
    postSelector: 'a[href*="/artworks/"]',
    isBulkCapturePage: isPixivOwnBookmarksPage,
    capturedVia: 'pixiv-bookmarks',
    // X の仮想のブックマーク一覧と違い、ここのカードは一覧が最初の描画を終えた時点で全部が
    // DOM に在る（実物の保存で確認、2026-08-02＝Issue #280 を参照）。だから実行中に、一覧の
    // どこまで進んだかを割合で出せる。
    bulkKnowsTotal: true,
  },

  mediaIdentity: {
    platform: 'pixiv',
    extractIdentity(el: PostMediaElement): MediaIdentity | null {
      let postId: string | null = null;
      for (const src of mediaSrcs(el)) {
        const m = src.match(PXIMG_ARTWORK_ID);
        if (m) {
          postId = m[1] ?? null;
          break;
        }
      }
      if (!postId) {
        const link = (el.closest('a[href*="/artworks/"]') as HTMLAnchorElement | null) || (findAncestorContainerLink(el, 'a[href*="/artworks/"]', 'li, figure') as HTMLAnchorElement | null);
        if (link) {
          const parsed = parseMediaUrlPath(link.href, ARTWORK_PATH);
          if (parsed) postId = parsed.match[1] ?? null;
        }
      }
      if (!postId) {
        const m = location.pathname.match(ARTWORK_PATH);
        if (m) postId = m[1] ?? null;
      }
      if (!postId) return null;
      return { postId: decodeURIComponent(postId), link: `https://www.pixiv.net/artworks/${postId}` };
    },
    // pximg の URL を、小説の表紙やユーザーのアイコン（どちらも i.pximg.net に在る）では
    // なく作品のページにしているのが、<id>_p<N> というファイル名。
    isPostMedia: (el) => anySrc(el, (src) => mediaHostIs(src, 'i.pximg.net') && PXIMG_ARTWORK_ID.test(src)),
  },

  overlay: {
    // 形は2つで、どちらもアンカー:
    //  - 一覧のサムネイル: a[href*="/artworks/"]＝カード自身のリンク（カードは同じ作品への
    //    タイトルのリンクも持つので、画像があることを要求してカード1枚につき操作部品1つに
    //    保つ）。
    //  - 作品ページの主イラスト: a[href*="i.pximg.net"]＝各ページの画像を包む原寸ビューアへ
    //    のリンク。X と Bluesky が只で賄っている（あちらは投稿コンテナが詳細ページにも出る）
    //    のに pixiv では賄えていなかった唯一の画面がここで、そのせいでボタンが、まさに保存
    //    しに来たイラストに届いていなかった (#340)。関連作品のサムネイルとはきれいに読み
    //    分かれる＝あちらは /artworks/ のリンクを使い、主画像は i.pximg.net のリンクを使う。
    //    漫画のページはそれぞれがこのアンカー1つ → ページごとにボタン1つ。うごイラは _p の
    //    画像ではなく <canvas> なので、isPostMedia が退け、ボタンは出ない。
    unitSelector: 'a[href*="/artworks/"], a[href*="i.pximg.net"]',
    mediaIn: (unit) => [...unit.querySelectorAll('img')],
    pointerOverlayInMedia: pixivPointerOverlayInMedia,
  },

  residentMatches: ['https://www.pixiv.net/*', 'https://pixiv.net/*'],
  apiHostPermissions: ['https://www.pixiv.net/*'],
};

export default pixiv;
export { fetchPixivIllust, getPixivPermalink, pixivBookmarksUserIdFromUrl, pixivMedia, pixivPointerOverlayInMedia, resolvePixivTarget, PIXIV_REFERER };
