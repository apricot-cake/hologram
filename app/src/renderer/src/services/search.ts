// タグ編集など、小さな候補一覧の文字列比較用。投稿検索はMeilisearchを使う。
export function normalize(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function includesNormalized(haystack: unknown, query: unknown): boolean {
  return normalize(haystack).includes(normalize(query));
}
