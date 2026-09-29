type ByteRange = { start: number; end: number };

// Chromium の <video> は Range を使って必要な箇所だけを読む。複数 range は multipart 応答が
// 必要になるため受け付けず、Chromium が通常送る単一 range（先頭・末尾・suffix）だけを扱う。
export function parseAssetByteRange(value: string | null, size: number): ByteRange | null | 'unsatisfiable' {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return 'unsatisfiable';

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) return 'unsatisfiable';
  return { start, end: Math.min(requestedEnd, size - 1) };
}
