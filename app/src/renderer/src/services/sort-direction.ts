const pairs = [
  ['date-asc', 'date-desc'],
  ['local-views-asc', 'local-views-desc'],
  ['captured-asc', 'captured-desc'],
  ['trashed-asc', 'trashed-desc'],
  ['likes-pct-asc', 'likes-pct'],
  ['count-asc', 'count'],
  ['followers-pct-asc', 'followers-pct'],
  ['name', 'name-desc'],
] as const;

export function isSortAscending(value: string): boolean {
  return pairs.some(([asc]) => asc === value);
}

export function sortWithDirection(value: string, ascending: boolean): string {
  const pair = pairs.find(([asc, desc]) => asc === value || desc === value);
  return pair ? pair[ascending ? 0 : 1] : value;
}

export function sortOption(value: string): string {
  return value === 'name-desc' || value === 'name' ? 'name' : sortWithDirection(value, false);
}
