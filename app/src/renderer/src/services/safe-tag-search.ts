import { tagNameInputIsSafe } from '../../../../../native-host/tag-normalize.mts';

// 候補行を走査する前に、問い合わせを一度だけ検査する。search の中では行ごとに NFKC を
// 行うため、危険な問い合わせを渡してから filter するのでは遅い。
export function runSafeTagSearch<T>(query: string, search: () => T[], empty: T[] = []): T[] {
  return tagNameInputIsSafe(query) ? search() : empty;
}
