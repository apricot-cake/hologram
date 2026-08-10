// 木 → QueryState のアダプタ（#207 自身の設計コメント:「詰め替えアダプタ（ツリー→
// QueryState）」）。条件の木（services/query.ts の HologramQueryGroup）に対する純関数に、
// 注入する依存を1つ＝resolveUser を足したもの。葉が持つのは木の側の userKey という文字列
// だけで、それをプラットフォームごとの本物のハンドルにするには投稿のレコードが要るため
// （websearch/resolve-user.ts が投稿のスナップショットからその引き当てを組む。このファイルは
// その引き当てがどう組まれたかからは独立したままでいる）。
//
// UI が組む木は常にファセット CNF の木だけ（services/query.ts のその領域についてのコメント）
// ＝根が AND のグループで、その子が型ごとの OR/AND のクラスタ、単独の葉、そして否定された
// （「〜以外」の）葉。この走査はまさにその形を前提にする＝ファセット CNF でない木（本当の
// 入れ子・根が OR など）は、部分的にできる範囲で翻訳するのではなく、木まるごとを1件の落とし
// として報告する（Issue 自身の「保守的翻訳」の原則＝UI が作るはずのない形を当てにいかない）。
import { emptyQueryState, type DropNote, type QueryState, type ResolvedUser } from './types.ts';

export interface AdapterDeps {
  /** 'user' の葉が持つ木の側の userKey（services/query.ts の userKey）を、プラットフォーム
   * の形をした本物のハンドルへ解決する＝もとになる投稿のレコードがそれを組むだけのものを
   * 保存していなければ null（resolve-user.ts 参照）。 */
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

  // 有効な木がまだ無い（起動前、または何も絞っていない）＝翻訳するものが無く、警告の
  // アイコンを出すほどの形の問題でもない。
  if (!tree) return { state, treeDrops };
  if (tree.kind !== 'group' || tree.op !== 'and' || tree.neg) {
    dropShape('複雑な条件の組み合わせは翻訳できません（グループ分けが対応していない形です）');
    return { state, treeDrops };
  }

  // 走査の全体を通して集めておき、肯定の 'user' の葉が複数あるとき（AND の兄弟でも OR の
  // クラスタでも、どちらにせよ曖昧＝「この2人の両方が書いた投稿」はほぼ常に空になり、
  // 「どちらかが書いた投稿」にはサイト側の訳が無い）に、最初の1つが黙って勝つのではなく、
  // 走査が終わってからまとめて判断できるようにする。
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
      // 行そのものが1つのプラットフォーム（またはホームのインスタンス）＝どのサイトを
      // 開くかが既に「このプラットフォーム/インスタンスに限定する」と言っているので、この
      // 2つの葉の型は自前の翻訳を要さない（適用にも落としにも数えない＝失われてはおらず、
      // 行そのものに吸収されている）。
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
    // 子がグループの場合＝肯定の OR のクラスタ（値が2つ以上の「どれか」）か、肯定の AND の
    // クラスタ（複数値の「すべて」。ハッシュタグでの絞り込みなど）のどちらか。どちらも型は
    // 均質で、否定されることも入れ子になることもない（ファセット CNF はこれより深い入れ子を
    // 持たない）。
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
    else for (const l of leaves) applyLeaf(l, false); // AND のクラスタ＝作りからして値はすべて肯定
  }

  // 集めた 'user' の葉を、プラットフォームごとに最大1人の投稿者へ落とし込む＝別々の2人が
  // 1つの投稿の投稿者に同時になることはありえない。AND の兄弟として来ようが OR のクラスタ
  // として来ようが同じ（どのみちこのエンジンはプラットフォームごとの OR に対応していない）。
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
