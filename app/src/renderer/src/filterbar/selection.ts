import type { FilterRow } from '../services/orchestrator.ts';
import { includesNormalized } from '../services/search.ts';

// 同名のタグや、サイト一覧に混在するドメインを区別する。
export function rowKey(row: FilterRow): string {
  return JSON.stringify([row.type ?? '', row.tagId ?? row.v]);
}

export function matchesRow(row: FilterRow, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (q.startsWith('@')) return includesNormalized(row.sn, q.slice(1));
  return includesNormalized(row.l, q) || includesNormalized(row.sn, q);
}

export function groupRows(rows: FilterRow[]): { name: string; rows: FilterRow[] }[] {
  const groups: { name: string; rows: FilterRow[] }[] = [];
  for (const row of rows) {
    if (row.ghead != null) groups.push({ name: row.ghead, rows: [] });
    else {
      if (!groups.length) groups.push({ name: '', rows: [] });
      groups[groups.length - 1].rows.push(row);
    }
  }
  return groups;
}
