// タブをまたぐ全文検索（#29）＝パレットの「本文を検索」モード。
//
// 設計（Issue #29 の 2026-07-11/07-14/07-18 のコメントと、メモリから移してきた実装の注記）:
// 検索はライブラリ全体（今のタブの絞り込みだけではなく）に対して走り、照合はタブ内の
// クイック検索が既に使っているのと同じもの（services/search.ts の compile()）を使う＝
// 照合の意味論はアプリ全体で1つで、この面のために2つ目を作ることはない。順序は main
// プロセスの posts_fts（#5 の FTS5 の索引）から得る bm25() の順位で、IPC 経由で取る
// （services/ipc.ts の searchFullText）＝このモジュールが SQLite に触れることはなく、
// 順位を尋ねて畳み込むだけ。
//
// この回が引き継ぐ #288 の宿題: posts_fts は、このモジュール自身の照合が見る欄をすべて
// 索引に入れているわけではない（メディアの代替テキスト、seriesTitle、引用／返信先の本文＝
// lib-db-schema.ts の POSTS_FTS_SQL の列の並びを参照）。そうした欄のおかげでだけ当たった
// 結果には bm25 の順位が返ってこないので、rankFullTextMatches はそれを日付順へ落とし、
// 順位の付いた結果すべての後ろに並べる＝#5 が入る前にこの機能を動かすために Issue の設計が
// 既に定めていた「順位がまだ無い → 日付順」の退避を、全体ではなく結果1件ごとの狭い隙間に
// 転用したもの。posts_fts をそれらの欄まで広げるのはスキーマの作り直し（FTS5 に ALTER は
// 無い）なので後続に回し、この Issue の受け入れ条件の妨げにはしない。
import { compile, snippetOf } from './search.ts';
import { hologramIpc } from './ipc.ts';

// 欄の優先順＝1つの投稿が複数の欄で当たった時に、どの欄が勝つか（受け入れ条件は、タグや
// ハッシュタグでの一致が本文での一致に見えてはいけない、というもの＝それが避ける驚きに
// ついては #29 の設計のコメントを参照）。本文寄りの欄が先で、タグとハッシュタグが最後。
export type FullTextFieldKey = 'text' | 'title' | 'memo' | 'seriesTitle' | 'alt' | 'quoted' | 'poll' | 'linkCard' | 'displayName' | 'screenName' | 'eagleName' | 'tag' | 'hashtag';

function fieldsOf(p: HologramPost): { key: FullTextFieldKey; value: string }[] {
  const out: { key: FullTextFieldKey; value: string }[] = [];
  const push = (key: FullTextFieldKey, v: unknown) => {
    if (v != null && String(v).trim()) out.push({ key, value: String(v) });
  };
  push('text', p.text);
  push('title', p.title);
  push('memo', p.memo); // #36: 利用者の自由文のメモ（Eagle からの移行の `description` の欄を吸収した）
  push('seriesTitle', p.seriesTitle); // #188: pixiv のシリーズ名
  for (const m of p.media || []) push('alt', (m as { alt?: unknown } | null | undefined)?.alt);
  // #180: 引用や返信の子レコード自体は、独立して検索できない＝その本文に当たった時に
  // 出るのは親の投稿（textHaystackOf と同じ作法）。
  const q = p.quotedPost || p.replyToPost;
  if (q) push('quoted', (q as { text?: unknown }).text);
  // #179: アンケートの選択肢のラベルは、投稿本文や閲覧注意と同じく作者が書いた語＝
  // 検索できるようにし、専用の欄として報告することで、選択肢での一致が本文での一致に
  // 見えないようにする。
  for (const c of (p.poll as { choices?: { text?: unknown }[] } | null | undefined)?.choices || []) push('poll', c?.text);
  // #181: リンク共有の投稿の OGP のカードのタイトルと説明＝引用した投稿の本文と同じく
  // 作者のすぐ隣にある語なので、こちらも専用の欄として報告し、そこでの一致が本文での
  // 一致に見えないようにする。
  const card = p.linkCard as { title?: unknown; description?: unknown } | null | undefined;
  if (card) {
    push('linkCard', card.title);
    push('linkCard', card.description);
  }
  push('displayName', p.displayName);
  push('screenName', p.screenName);
  push('eagleName', p.eagleName);
  for (const tag of p.tags || []) push('tag', tag);
  for (const h of p.hashtags || []) push('hashtag', h);
  return out;
}

export interface FullTextMatch {
  post: HologramPost;
  field: FullTextFieldKey;
  snippetText: string;
  matchStart: number;
  matchEnd: number;
}

/** 投稿1件の欄に対して `query` を優先順に当て、最初に一致した欄を抜粋付きで返す。その
 * 投稿のどこにも当たらなければ null。照合はタブ内のクイック検索（query.ts の 'text' の
 * 葉）と同じなので、今のタブの検索で当たる投稿は、ここでも当たる。 */
export function matchPost(query: string, post: HologramPost): FullTextMatch | null {
  const q = query.trim();
  if (!q) return null;
  const matcher = compile(q);
  for (const f of fieldsOf(post)) {
    if (!matcher(f.value)) continue;
    const snip = snippetOf(f.value, q);
    return { post, field: f.key, snippetText: snip.text, matchStart: snip.matchStart, matchEnd: snip.matchEnd };
  }
  return null;
}

/** 順位が得られる結果は bm25 の順位（負に大きいほど関連が強い）で並べる。posts_fts に行が
 * 無い結果（モジュールのヘッダを参照）は投稿日を代わりに使い、そうした結果はすべて、
 * 順位の付いた結果の後ろに並ぶ。 */
export function rankFullTextMatches(matches: readonly FullTextMatch[], ranks: ReadonlyMap<string, number>): FullTextMatch[] {
  return [...matches].sort((a, b) => {
    const ra = ranks.get(a.post.captureId);
    const rb = ranks.get(b.post.captureId);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return (Date.parse(b.post.date || '') || 0) - (Date.parse(a.post.date || '') || 0);
  });
}

export interface FullTextSearchResult {
  hits: FullTextMatch[];
  /** `limit` で頭打ちにする前の一致の総数＝パレットの「すべて表示」がこれを読む。 */
  total: number;
}

/** 走査の全体＝`allPosts` の投稿すべてに照合を当て、同じクエリの bm25 の順位を IPC 経由で
 * 取り、並べ、`limit` で頭打ちにする。IPC の呼び出しが失敗したり使えなかったりした時
 * （保存フォルダがまだ無い、MATCH の式が壊れている）は、エラーを出さずに全体を日付順へ
 * 落とす＝この面にはクエリの構文の誤りを出す UI が無い（searchPostsFts 自身の main
 * プロセス側の退避と同じ）。 */
export async function runFullTextSearch(query: string, allPosts: readonly HologramPost[], limit: number): Promise<FullTextSearchResult> {
  const q = query.trim();
  if (!q) return { hits: [], total: 0 };
  const matches: FullTextMatch[] = [];
  for (const p of allPosts) {
    const m = matchPost(q, p);
    if (m) matches.push(m);
  }
  let ranks = new Map<string, number>();
  try {
    const rows = await hologramIpc.searchFullText(q, 500);
    ranks = new Map((rows || []).map((r) => [r.postId, r.rank]));
  } catch {
    /* main プロセスに届かない＝下のすべての結果を日付順へ落とす */
  }
  const ranked = rankFullTextMatches(matches, ranks);
  return { hits: ranked.slice(0, limit), total: ranked.length };
}

// --- パレットへのブリッジ（#29） -----------------------------------------
// searchbox.ts の handlers()/init() と同じ、遅延して引く形。パレットのコンポーネントは
// orchestrator.ts が依存を結び終わる前に載るので、モジュールの読み込み時にキャッシュせず、
// 操作の時点でこれを引く。
export interface FullTextBridge {
  allPosts(): HologramPost[];
  /** 保存フォルダの asset:// の URL を組む関数（orchestrator.ts の fileSrc）＝結果の行は、投稿グリッドと同じやり方でサムネイルを出す。 */
  fileSrc(file: string, w?: number): string;
  /** `query` に絞った新しいタブを開き、`captureId` の1件をインスペクタに出す＝
   * 「飛ぶ」操作（#29 の受け入れ条件: 飛んでも今のタブを乱さない）。 */
  openResult(query: string, captureId: string): void;
}
let registeredBridge: FullTextBridge | null = null;
export function initFullTextBridge(b: FullTextBridge): void {
  registeredBridge = b;
}
export function fullTextBridge(): FullTextBridge | null {
  return registeredBridge;
}
