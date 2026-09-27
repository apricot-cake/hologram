import { ExtractedPostSchema } from '../../../native-host/protocol.mts';
// 複数の extractor が共有する API 相の補助関数。どの fetchPost() も埋める正規化済み
// レコードと、レスポンスを読む周りの配管。
//
// ここはプラットフォームを一切知らない。エンドポイントの URL、レスポンスの形、欄の
// 対応付けは、そのサイト自身のモジュールに置く。

import type { PostRecord } from './types.ts';

function emptyRecord(url: string | null | undefined, platform: string | null | undefined): PostRecord {
  return ExtractedPostSchema.parse({ url: url ?? null, platform: platform ?? null });
}

async function readJsonResponse(res: Response) {
  return JSON.parse(await res.text());
}

// 正常な空欄とは別に、取得できなかった工程を呼び出し元へ返す。
function acquisitionFailed(rec: PostRecord, scope: 'post' | 'profile' | 'media', reason: 'unavailable' | 'fetchFailed' | 'invalidResponse' = 'fetchFailed') {
  if (!rec.acquisitionIssues.some((issue) => issue.scope === scope && issue.reason === reason)) rec.acquisitionIssues.push({ scope, reason });
  if (scope === 'post') rec.metaError = reason;
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

export { acquisitionFailed, emptyRecord, htmlToText, normalizeHashtags, readJsonResponse, toIso };
