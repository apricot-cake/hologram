export function hashtagParts(text: string, tags: string[]): { text: string; tag?: string }[] {
  const names = [...new Set(tags)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return [{ text }];
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`https?:\\/\\/[^\\s]+|(?<![\\p{L}\\p{N}_/#＃])([#＃](${escaped.join('|')}))(?![\\p{L}\\p{N}_])`, 'gu');
  const parts: { text: string; tag?: string }[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > end) parts.push({ text: text.slice(end, match.index) });
    parts.push({ text: match[0], tag: match[2] });
    end = match.index + match[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts;
}
