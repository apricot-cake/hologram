import { hologramIpc } from './ipc.ts';

// エンジンが返す一致箇所の表示名。
export type FullTextFieldKey = 'text' | 'title' | 'seriesTitle' | 'alt' | 'quoted' | 'poll' | 'linkCard' | 'displayName' | 'screenName' | 'eagleName' | 'tag' | 'hashtag';

export interface FullTextMatch {
  post: HologramPost;
  field: FullTextFieldKey;
  snippetText: string;
  matchStart: number;
  matchEnd: number;
}

export interface FullTextSearchResult {
  hits: FullTextMatch[];
  /** `limit` で頭打ちにする前の一致の総数。 */
  total: number;
}

/** Meilisearchの一致結果を画面上の投稿へ対応させる。 */
export async function runFullTextSearch(query: string, allPosts: readonly HologramPost[], limit: number): Promise<FullTextSearchResult> {
  const q = query.trim();
  if (!q) return { hits: [], total: 0 };
  const rows = await hologramIpc.searchFullText(q);
  const byId = new Map(allPosts.map((p) => [p.captureId, p]));
  const hits: FullTextMatch[] = [];
  for (const row of rows) {
    const post = byId.get(row.postId);
    if (!post) continue;
    hits.push({ post, field: (row.field || 'text') as FullTextFieldKey, snippetText: row.snippetText || post.text || post.title || '', matchStart: row.matchStart ?? -1, matchEnd: row.matchEnd ?? -1 });
  }
  return { hits: hits.slice(0, limit), total: hits.length };
}

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
