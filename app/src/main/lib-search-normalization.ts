const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export const normalizeSearchText = (text: string): string => text.normalize('NFKC');

// 索引のUTF-8位置を原文のUTF-16位置へ戻す。濁点の合成や互換文字の
// 展開では長さが変わるため、書記素を単位に元の文字全体を示す。
export function originalSearchRange(source: string, start: number, length: number): { start: number; end: number } {
  let byteOffset = 0;
  let originalStart = -1;
  let originalEnd = -1;
  for (const part of graphemes.segment(source)) {
    const next = byteOffset + Buffer.byteLength(normalizeSearchText(part.segment));
    if (next > start && byteOffset < start + length) {
      if (originalStart < 0) originalStart = part.index;
      originalEnd = part.index + part.segment.length;
    }
    byteOffset = next;
    if (byteOffset >= start + length) break;
  }
  return { start: originalStart, end: originalEnd };
}
