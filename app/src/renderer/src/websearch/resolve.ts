// プラットフォームのモジュールの build() を、UI が1行の中で見せる必要のある2種類の落とし
// と束ねる。1つは木の形による落とし（どの行でも同じ内容＝アダプターがライブラリ専用の葉の
// 種別か、読めない木の形を見つけた場合）。もう1つはプラットフォームごとの投稿者の食い違い
// （この行とは別のプラットフォームで取得した ResolvedUser。それが決して翻訳できない理由は
// types.ts の ResolvedUser のコメントを参照）。
import type { DropNote, PlatformCtx, PlatformDef, PlatformId, PlatformQueryState, PlatformResult, QueryState, ResolvedUser } from './types.ts';

const PLATFORM_LABEL: Record<PlatformId, string> = { x: 'X', bluesky: 'Bluesky', pixiv: 'pixiv' };

/** エンジン側の QueryState（ResolvedUser のオブジェクト）を、プラットフォームのモジュールが
 * 読む素の文字列の形へ狭める。別のプラットフォームで取得した投稿者条件はすべて落とす
 * （黙って捨てることはない＝食い違い1件ごとに DropNote になる）。 */
export function narrowForPlatform(state: QueryState, platformId: PlatformId): { narrowed: PlatformQueryState; extraDropped: DropNote[] } {
  const extraDropped: DropNote[] = [];
  const belongs = (u: ResolvedUser) => u.platform === platformId;

  let fromUser: string | null = null;
  if (state.fromUser) {
    if (belongs(state.fromUser)) fromUser = state.fromUser.handle;
    else extraDropped.push({ reason: `投稿者条件は${PLATFORM_LABEL[state.fromUser.platform]}の投稿者のため、${PLATFORM_LABEL[platformId]}には翻訳できません` });
  }

  const excludeUser = state.excludeUser.filter(belongs).map((u) => u.handle);
  const mismatchedExcl = state.excludeUser.some((u) => !belongs(u));
  if (mismatchedExcl) extraDropped.push({ reason: `除外する投稿者の一部は${PLATFORM_LABEL[platformId]}以外の投稿者のため翻訳できません` });

  const { fromUser: _f, excludeUser: _e, ...rest } = state;
  return { narrowed: { ...rest, fromUser, excludeUser }, extraDropped };
}

export interface ResolvedRow extends PlatformResult {
  platform: PlatformDef;
}

/** treeDrops = どのプラットフォームでも初めから望みの無かった概念（ライブラリ専用の葉の
 * 種別、アダプターが読めなかった木の形）。どの行でも同じ内容なので、各プラットフォームの
 * モジュールの中で重複させず、ここで一度だけ足す。 */
export function resolve(state: QueryState, platform: PlatformDef, ctx: PlatformCtx, treeDrops: readonly DropNote[]): ResolvedRow {
  const { narrowed, extraDropped } = narrowForPlatform(state, platform.id);
  const r = platform.build(narrowed, ctx);
  return {
    platform,
    url: r.url,
    applied: r.applied,
    approximated: r.approximated,
    dropped: [...r.dropped, ...extraDropped, ...treeDrops],
  };
}

export function resolveAll(state: QueryState, platforms: readonly PlatformDef[], ctxFor: (p: PlatformDef) => PlatformCtx, treeDrops: readonly DropNote[]): ResolvedRow[] {
  return platforms.map((p) => resolve(state, p, ctxFor(p), treeDrops));
}
