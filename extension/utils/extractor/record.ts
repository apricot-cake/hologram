// 複数の extractor が共有する API 相の補助関数。どの fetchPost() も埋める正規化済み
// レコードと、レスポンスを読む周りの配管。
//
// ここはプラットフォームを一切知らない。エンドポイントの URL、レスポンスの形、欄の
// 対応付けは、そのサイト自身のモジュールに置く。

import type { PostRecord } from './types.ts';

function emptyRecord(url: string | null | undefined, platform: string | null | undefined): PostRecord {
  return {
    url: url || null,
    platform: platform || null,
    text: null,
    title: null,
    displayName: null,
    screenName: null,
    userId: null,
    // 投稿者のプロフィール。avatar は全プラットフォーム（X は埋め込み用 API の user
    // 経由）。followers / authorCreatedAt は公開 API に出しているプラットフォームだけ
    // （Bluesky）。応答に欄がなければ null のまま
    // （欄が無ければ表示側が省く、という穏当な隠し方）。avatarReferer が要るのは
    // pixiv だけ（i.pximg.net は Referer で門を張っている）＝ダウンロードの際に
    // ブリッジがこれを尊重する。
    avatar: null,
    avatarReferer: null,
    // #289: bio/profileLinks/banner。プラットフォームごとの取得元は types.ts の
    // PostRecord を参照。
    bio: null,
    profileLinks: null,
    banner: null,
    followers: null,
    following: null,
    authorCreatedAt: null,
    likes: null,
    reposts: null,
    replies: null,
    bookmarks: null,
    views: null,
    date: null,
    mediaType: null,
    media: [],
    lang: null,
    isReply: null,
    isQuote: null,
    isThread: null,
    isEdited: null,
    cw: null,
    sensitive: null,
    quotedUrl: null,
    // 返信先の親の、プラットフォーム内での投稿 ID（tweet id / rkey / note id /
    // status id）。親子ともライブラリにあるとき、表示側が自己返信を親とまとめられる。
    replyToId: null,
    // #180/#806: 引用・リノートと返信先の親の、サイドカーのサブレコード。
    // プラットフォームごとの規則は types.ts の PostRecord.quotedPost/replyToPost を
    // 参照。
    quotedPost: null,
    replyToPost: null,
    // #179: 投稿のアンケート。現在は x.ts が埋める。
    poll: null,
    // #181: リンク共有投稿の OGP プレビューカード。埋めるのは bluesky.ts / x.ts だけ。
    linkCard: null,
    seriesId: null,
    seriesTitle: null,
    seriesOrder: null,
    hashtags: [],
    tags: [],
    metaError: null,
    metaSource: null,
  };
}

async function readJsonResponse(res: Response) {
  return JSON.parse(await res.text());
}

// どのプラットフォームのハッシュタグも1つの形に揃える (#177)。欄の名前はサイトの
// API ごとに違う（X の entities.hashtags[].text、Bluesky の tag ファセットと
// record.tags[]、pixiv の tags.tags[].tag）が、意味はどれも同じ。だからレコードに入るものがサイトで違っては
// いけない＝先頭に '#' を持たない裸のタグを、初出順で重複を除いて入れる。あるプラット
// フォームで '#' を残し別のプラットフォームで落とすと、表示側のハッシュタグの
// ファセットで1つのタグが2つのバケットに割れる。1投稿の中で同じタグが繰り返されれば、
// そのバケットの件数が膨らむ。
//
// 大小文字と文字幅は、プラットフォームが報告したとおりのまま一切いじらない。X / Bluesky / pixiv は
// 投稿者の綴りをそのまま保つので、同じ語がプラットフォームをまたいで2通りの綴りで
// 届くことはある。それをまとめるのはグリフの正規化であって、ここではなく #197 の担当。
function normalizeHashtags(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    if (typeof v !== 'string') continue;
    // '#' と全角の '＃' を落とす。上に挙げたプラットフォームの欄はどちらも持たない
    // が、本文から起こす退避経路は持つし、クライアントが自由記述のタグ配列に接頭辞
    // ごと入れるのも自由だから。
    const tag = v
      .trim()
      .replace(/^[#＃]+/, '')
      .trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function toIso(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// API がレンダリング済みのテキストを返すプラットフォーム（pixiv の caption）では、
// 投稿の本文が HTML で届く。ここで平らにして、
// キャプションの語を表示側で検索できるようにする。
function htmlToText(html) {
  if (!html) return null;
  let s = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '');
  // タグは1回で落とさず、必ず不動点まで落とす。1回だけだと、残骸から新しいタグが
  // 継ぎ合わさることがある（`<scr<b>ipt>` → `<script>`）。結果が本当にタグ無しになる
  // のはこのループのおかげ（CodeQL js/incomplete-multi-character-sanitization）。
  let previous: string;
  do {
    previous = s;
    s = s.replace(/<[^>]+>/g, '');
  } while (s !== previous);
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return s.trim() || null;
}

export { emptyRecord, htmlToText, normalizeHashtags, readJsonResponse, toIso };
