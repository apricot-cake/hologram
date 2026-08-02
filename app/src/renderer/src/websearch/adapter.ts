// The tree -> QueryState adapter (#207's own design comment: "詰め替えアダプタ（ツリー→
// QueryState）"). A pure function over the condition tree (services/query.ts's
// HologramQueryGroup) plus one injected dependency - resolveUser - since a leaf only
// carries the tree's own userKey string, and turning that into a real per-platform
// handle needs the post records (websearch/resolve-user.ts builds that lookup from a
// posts snapshot; this file stays independent of HOW that lookup was built).
//
// The UI only ever builds facet-CNF trees (services/query.ts's own comment on that
// domain): a root AND group whose children are per-type OR/AND clusters, standalone
// leaves, and negated ("Exclude") leaves. This walk assumes exactly that shape - a tree
// that isn't facet-CNF (real nesting, an OR root, etc.) is reported as one whole-tree
// drop rather than partially, best-effort translated (the Issue's own "保守的翻訳"
// principle: never guess at a shape the UI was not supposed to produce).
import { emptyQueryState, type DropNote, type QueryState, type ResolvedUser } from './types.ts';

export interface AdapterDeps {
  /** Resolves a 'user' leaf's tree-side userKey (services/query.ts's userKey) to a real,
   * platform-shaped handle - null when the underlying post record never captured enough
   * to build one (see resolve-user.ts). */
  resolveUser(userKey: string): ResolvedUser | null;
}

const TYPE_LABEL: Record<string, string> = {
  kind: '種類',
  folder: 'フォルダ',
  dimension: '画像サイズ',
  domain: 'サイト（未対応ドメイン）',
  user: '投稿者',
};

function leafLabel(type: string): string {
  return TYPE_LABEL[type] || type;
}

export function buildWebSearchState(tree: HologramQueryGroup | null | undefined, deps: AdapterDeps): { state: QueryState; treeDrops: DropNote[] } {
  const state = emptyQueryState();
  const treeDrops: DropNote[] = [];
  const dropShape = (why: string) => treeDrops.push({ reason: why });

  // No active tree yet (pre-boot, or nothing filtered) - nothing to translate, and NOT
  // a shape problem worth a warning icon over.
  if (!tree) return { state, treeDrops };
  if (tree.kind !== 'group' || tree.op !== 'and' || tree.neg) {
    dropShape('複雑な条件の組み合わせは翻訳できません（グループ分けが対応していない形です）');
    return { state, treeDrops };
  }

  // Collected across the whole walk so multiple positive 'user' leaves (whether AND
  // siblings or an OR cluster - either way ambiguous: "posts BY BOTH of these people" is
  // nearly always empty, and "posts by either" has no site-side translation) can be
  // judged together once the walk finishes, rather than the first one winning silently.
  const positiveUsers: ResolvedUser[] = [];
  const unresolvedUserLabels: string[] = [];

  function applyLeaf(leaf: HologramQueryLeaf, neg: boolean): void {
    switch (leaf.type) {
      case 'text': {
        const v = String(leaf.value ?? '').trim();
        if (!v) return;
        (neg ? state.exclude : state.terms).push(v);
        return;
      }
      case 'tag':
      case 'hashtag': {
        const v = String(leaf.value ?? '').trim();
        if (!v) return;
        (neg ? state.excludeHashtag : state.hashtag).push(v);
        return;
      }
      case 'user': {
        const resolved = deps.resolveUser(String(leaf.value ?? ''));
        if (!resolved) {
          unresolvedUserLabels.push(String(leaf.label ?? leaf.value ?? ''));
          return;
        }
        if (neg) state.excludeUser.push(resolved);
        else positiveUsers.push(resolved);
        return;
      }
      case 'date': {
        const field = leaf.dateField || 'date';
        if (field !== 'date') {
          dropShape('保存日時での絞り込みはライブラリ専用の条件のため翻訳できません');
          return;
        }
        if (leaf.from) state.since = leaf.from;
        if (leaf.to) state.until = leaf.to;
        return;
      }
      case 'media':
        if (leaf.value === 'video') state.videoOnly = true;
        else if (leaf.value === 'image' || leaf.value === 'gif') state.mediaOnly = true;
        return;
      case 'postType':
        if (leaf.value === 'reply') state.repliesOnly = true;
        else if (leaf.value === 'post') state.excludeReplies = true;
        else dropShape(`投稿種別「${leaf.value}」は翻訳できません`);
        return;
      case 'engagement': {
        const min = Number(leaf.min);
        if (!(min > 0)) return;
        if (leaf.op === 'lte') {
          dropShape('エンゲージメント数の「以下」条件は翻訳できません');
          return;
        }
        if (leaf.engType === 'likes') state.minLikes = min;
        else if (leaf.engType === 'reposts') state.minReposts = min;
        else if (leaf.engType === 'replies') state.minReplies = min;
        else dropShape(`エンゲージメント種別「${leaf.engType}」は翻訳できません`);
        return;
      }
      // A row IS one platform (or the home instance) - which site to open already says
      // "restrict to this platform/instance", so these two leaf types need no
      // translation of their own (neither applied nor dropped - they are not lost, they
      // are subsumed by the row itself).
      case 'platform':
      case 'instance':
        return;
      default:
        dropShape(`「${leafLabel(String(leaf.type))}」の条件は翻訳できません（ライブラリ内専用の条件です）`);
    }
  }

  function applyOrCluster(type: string, leaves: HologramQueryLeaf[]): void {
    if (type === 'text') {
      state.keywordsOr.push(...leaves.map((l) => String(l.value ?? '').trim()).filter(Boolean));
      return;
    }
    if (type === 'tag' || type === 'hashtag') {
      state.hashtagOr.push(...leaves.map((l) => String(l.value ?? '').trim()).filter(Boolean));
      return;
    }
    dropShape(`「${leafLabel(type)}」の「いずれか」条件は翻訳できません`);
  }

  for (const child of tree.children) {
    if (child.kind === 'cond') {
      applyLeaf(child, !!child.neg);
      continue;
    }
    // A group child: either a positive OR cluster (2+ values, "any of") or a positive AND
    // cluster (multi-value "all of", e.g. hashtag narrowing) - both homogeneous-type,
    // never negated, never nested (facet-CNF has no deeper nesting than this).
    if (child.neg || !child.children.length || child.children.some((c) => c.kind !== 'cond' || c.neg)) {
      dropShape('入れ子になった条件グループは翻訳できません');
      continue;
    }
    const leaves = child.children as HologramQueryLeaf[];
    const types = new Set(leaves.map((l) => l.type));
    if (types.size > 1) {
      dropShape('複数の種類が混ざった条件グループは翻訳できません');
      continue;
    }
    const type = leaves[0].type;
    if (child.op === 'or') applyOrCluster(type, leaves);
    else for (const l of leaves) applyLeaf(l, false); // AND cluster: every value must be positive by construction
  }

  // Resolve the collected 'user' leaves down to at most one author, per platform - two
  // DIFFERENT people can never both be "the" author of one post, whether they arrived as
  // AND siblings or an OR cluster (this engine has no per-platform OR support anyway).
  const distinctHandles = new Set(positiveUsers.map((u) => `${u.platform}:${u.handle}`));
  if (distinctHandles.size === 1) {
    state.fromUser = positiveUsers[0];
  } else if (distinctHandles.size > 1) {
    dropShape('複数の投稿者条件は翻訳できません');
  }
  if (unresolvedUserLabels.length) {
    dropShape(`投稿者（${unresolvedUserLabels.join('・')}）の実データが無いため翻訳できません`);
  }

  return { state, treeDrops };
}
