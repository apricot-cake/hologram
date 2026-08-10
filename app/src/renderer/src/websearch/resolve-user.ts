// アダプタが 'user' の葉を変換するのに要る userKey → ResolvedUser の索きを組み立てる
//（types.ts の ResolvedUser の doc コメントを参照）。'user' の葉が持っているのは、木自身の
// userKey の文字列（services/query.ts の userKey＝platform + ':' + (userId または
// '@'+screenName)）と表示用のラベルだけで、どちらもそれ単体ではサイトで使えるハンドルに
// ならない（#207 自身の注記:「fromUserのハンドル解決はレコード実データ依存」）。
// プラットフォームごとの本当の同一性は投稿のレコード側にある＝`screenName` で、どの
// extractor もすでにプラットフォームごとに正しい形にしてある（services/profile-url.ts の
// ProfileUrlSubject のコメントを参照。ここはそれをそのまま写している）。x と bluesky は
// 裸のハンドル、misskey と mastodon は username または username@remoteHost、pixiv は
// 数字の利用者 id。
//
// このモジュールは意図してアダプタ自身の import の網には繋いでいない。アダプタは木だけを
// 見る純粋な関数のまま（buildWebSearchState(tree, deps)）。このファイルは、呼び出し側
//（websearch/prefs.ts のホームインスタンスの提案や、ポップオーバー自身）が、すでに手元に
// ある投稿のスナップショットから `deps.resolveUser` の関数を組み立てるための道具
//（スナップショットは hologramIpc.listPosts() で一度だけ取る＝prefs.ts を参照）。
// このディレクトリが orchestrator.ts の実時間の一覧取得の経路に手を伸ばさずに済む。
import { hostOf, userKey } from '../services/query.ts';
import type { PlatformId, ResolvedUser } from './types.ts';

const KNOWN_PLATFORMS = new Set<PlatformId>(['x', 'bluesky', 'misskey', 'mastodon', 'pixiv']);

/** ここで必要な最小限の投稿の形＝HologramPost の構造上の部分集合。 */
export interface UserSourcePost {
  platform?: string | null;
  screenName?: string | null;
  url?: string | null;
  userId?: string | number | null;
}

function toResolvedUser(p: UserSourcePost): ResolvedUser | null {
  if (!p.platform || !KNOWN_PLATFORMS.has(p.platform as PlatformId)) return null;
  const platform = p.platform as PlatformId;
  if (!p.screenName) return null; // このレコードでハンドルを一度も取れていない＝解決できない。dialect 自身の罠と同じ
  if (platform === 'misskey' || platform === 'mastodon') {
    if (p.screenName.includes('@')) return { platform, handle: p.screenName }; // extractor がすでにリモートのホストを付けている
    const host = hostOf(p.url);
    if (!host) return null; // ローカルの投稿者だが元のホストを取り戻せない＝acct を完全な形にできない
    return { platform, handle: `${p.screenName}@${host}` };
  }
  return { platform, handle: p.screenName }; // x / bluesky / pixiv: screenName がすでに正しい形になっている
}

/** (platform, key) ごとに1エントリ。同じ人の後の投稿が前の投稿を上書きするのは、前のほうが
 * 解決に失敗していた時だけ（同じ人の投稿の間で screenName が変わることはないはずなので、
 * それ以外では最初に解決したものが勝つ）。 */
export function buildUserHandleIndex(posts: readonly UserSourcePost[]): Map<string, ResolvedUser> {
  const map = new Map<string, ResolvedUser>();
  for (const p of posts) {
    if (!p.platform) continue;
    const key = userKey(p as any);
    if (map.has(key)) continue;
    const resolved = toResolvedUser(p);
    if (resolved) map.set(key, resolved);
  }
  return map;
}
