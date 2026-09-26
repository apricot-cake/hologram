import type Database from 'better-sqlite3';
import type { PosterName } from '../shared/data-schemas.ts';

export function observePosterName(db: Database.Database, key: string, name: PosterName): void {
  if (!name.value.trim()) return;
  db.prepare(`INSERT INTO poster_names (posterKey,field,value,firstObservedAt,lastObservedAt) VALUES (?,?,?,?,?)
    ON CONFLICT(posterKey,field,value) DO UPDATE SET
    firstObservedAt=min(firstObservedAt,excluded.firstObservedAt), lastObservedAt=max(lastObservedAt,excluded.lastObservedAt)`).run(key, name.field, name.value, name.firstObservedAt, name.lastObservedAt);
}

export function posterNamesByKey(db: Database.Database): Map<string, PosterName[]> {
  const result = new Map<string, PosterName[]>();
  const rows = db.prepare('SELECT * FROM poster_names ORDER BY lastObservedAt DESC, field, value').all() as (PosterName & { posterKey: string })[];
  for (const { posterKey, ...name } of rows) {
    const names = result.get(posterKey) || [];
    names.push(name);
    result.set(posterKey, names);
  }
  return result;
}
