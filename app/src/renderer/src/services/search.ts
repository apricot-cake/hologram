// 検索は表記ゆれを正規化した部分一致。空白で区切った語をすべて要求する。
export function normalize(s: unknown): string {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function includesNormalized(haystack: unknown, query: unknown): boolean {
  return normalize(haystack).includes(normalize(query));
}

export function compile(query: string): (hay: string) => boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return (hay) => {
    const normalized = normalize(hay);
    return terms.every((term) => normalized.includes(term));
  };
}

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

// 正規化で文字数が変わるため、書記素ごとに原文の範囲を記録して強調位置へ戻す。
export function matchSpan(hay: string, query: string): { start: number; end: number } | null {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  let normalized = '';
  const ranges: { start: number; end: number }[] = [];
  for (const { segment, index } of segmenter.segment(hay)) {
    const part = normalize(segment);
    normalized += part;
    for (let i = 0; i < part.length; i++) ranges.push({ start: index, end: index + segment.length });
  }
  let first: { start: number; end: number } | null = null;
  for (const term of terms) {
    const index = normalized.indexOf(term);
    if (index < 0) continue;
    const span = { start: ranges[index].start, end: ranges[index + term.length - 1].end };
    if (!first || span.start < first.start) first = span;
  }
  return first;
}

export interface Snippet {
  text: string;
  /** `text` の中での位置（先頭の省略記号や窓の切り出し分は調整済み）。-1/-1 は一致が見つからなかったことを表す＝`text` は素の先頭の抜粋で、強調するものが無い。 */
  matchStart: number;
  matchEnd: number;
}

/** `query` の最初の一致の周りを窓で切り出した `raw` の抜粋。全文検索の結果の行のためのもの
 * （#29）。空白を畳むので、複数行の投稿本文も結果の行では1行として読める。 */
export function snippetOf(raw: string, query: string, radius = 40): Snippet {
  const s = raw.replace(/\s+/g, ' ').trim();
  const span = matchSpan(s, query);
  if (!span) {
    const head = s.slice(0, radius * 2);
    return { text: head + (s.length > head.length ? '…' : ''), matchStart: -1, matchEnd: -1 };
  }
  const start = Math.max(0, span.start - radius);
  const end = Math.min(s.length, span.end + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < s.length ? '…' : '';
  return { text: prefix + s.slice(start, end) + suffix, matchStart: span.start - start + prefix.length, matchEnd: span.end - start + prefix.length };
}
