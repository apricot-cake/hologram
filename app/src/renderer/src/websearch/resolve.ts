// Aggregates a platform module's build() with the two kinds of drop the UI needs to
// show on one row: tree-shape drops (identical across every row - the adapter found a
// library-only leaf type or a tree shape it could not read) and per-platform author
// mismatches (a ResolvedUser captured from a DIFFERENT platform than this row - see
// types.ts's ResolvedUser comment for why that can never translate).
import type { DropNote, PlatformCtx, PlatformDef, PlatformId, PlatformQueryState, PlatformResult, QueryState, ResolvedUser } from './types.ts';

const PLATFORM_LABEL: Record<PlatformId, string> = { x: 'X', bluesky: 'Bluesky', misskey: 'Misskey', mastodon: 'Mastodon', pixiv: 'pixiv' };

/** Narrows the engine-level QueryState (ResolvedUser objects) down to the plain string
 * shape a platform module reads, dropping any author condition that was captured from a
 * DIFFERENT platform (never silently discarded - each mismatch becomes a DropNote). */
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

/** treeDrops = concepts that never had a chance at ANY platform (library-only leaf
 * types, a tree shape the adapter could not read) - identical across every row, so they
 * are appended once here rather than duplicated inside each platform module. */
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
