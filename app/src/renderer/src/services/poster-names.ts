import type { PosterName } from '../../../shared/data-schemas.ts';

type Names = { displayName: string; screenName: string; names?: PosterName[] };
export function previousNames(user: Names): PosterName[] {
  return (user.names || []).filter((name) => name.value !== user[name.field]);
}
export function posterNameKeywords(user: Names): string {
  return previousNames(user)
    .map((name) => (name.field === 'screenName' ? `@${name.value}` : name.value))
    .join(' ');
}
export function matchingPreviousName(user: Names, query: string): string {
  const normalize = (s: string) => s.normalize('NFKC').toLowerCase();
  const q = normalize(query.trim());
  if (!q || normalize(`${user.displayName} @${user.screenName}`).includes(q)) return '';
  const found = previousNames(user).find((name) => normalize(name.field === 'screenName' ? `@${name.value}` : name.value).includes(q));
  return found ? (found.field === 'screenName' ? `@${found.value}` : found.value) : '';
}
