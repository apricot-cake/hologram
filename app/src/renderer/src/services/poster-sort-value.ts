import { compactDate, formatCount } from './format.ts';
import { treeLeaves } from './query.ts';
import { sortOption } from './sort-direction.ts';

export function posterSortValue(user: HologramUserAgg, sort: string, tree: HologramQueryGroup) {
  switch (sortOption(sort)) {
    case 'local-views-desc':
      return { kind: 'views', label: formatCount(user.localViewCount || 0) };
    case 'count':
      return { kind: 'posts', label: formatCount(user.count) };
    case 'followers-pct':
      return { kind: 'followers', label: user.followers == null ? '—' : formatCount(user.followers) };
    case 'last-viewed-desc':
      return { kind: 'date', label: user.lastViewedAt ? compactDate(user.lastViewedAt) : '—' };
    case 'date-desc': {
      const field: 'latest' | 'lastCapture' | 'authorCreatedAt' = treeLeaves(tree).find((leaf) => leaf.type === 'date')?.dateField || 'latest';
      return { kind: 'date', label: user[field] ? compactDate(user[field]) : '—' };
    }
    default:
      return null;
  }
}
