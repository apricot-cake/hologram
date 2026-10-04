// A routing guard, not a video/archive validator. Unrecognized content must use
// the prepared-image boundary or fail; it must never fall back to raw delivery.
export const ASSET_STREAM_HEADER_BYTES = 4096;

const VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'dash', 'msdh', 'msix', 'M4V ', 'M4VH', 'M4VP', 'F4V ', 'qt  ']);
const IMAGE_BRANDS = new Set(['avif', 'avis', 'mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'vvi1', 'vvic', 'vvis', 'j2ki', 'j2is', 'jpeg', 'jpgs']);

function videoFileTypeBox(header: Uint8Array): boolean {
  const bytes = Buffer.from(header.buffer, header.byteOffset, header.byteLength);
  if (bytes.length < 16 || bytes.toString('ascii', 4, 8) !== 'ftyp') return false;
  const size = bytes.readUInt32BE(0);
  // Only a complete, bounded ftyp box can establish the raw-stream route.
  if (size < 16 || size > bytes.length || size > ASSET_STREAM_HEADER_BYTES || size % 4 !== 0) return false;
  const major = bytes.toString('ascii', 8, 12);
  if (!VIDEO_BRANDS.has(major)) return false;
  if (IMAGE_BRANDS.has(major)) return false;
  for (let offset = 16; offset < size; offset += 4) {
    if (IMAGE_BRANDS.has(bytes.toString('ascii', offset, offset + 4))) return false;
  }
  return true;
}

function webmHeader(header: Uint8Array): boolean {
  if (header.length < 4 || header[0] !== 0x1a || header[1] !== 0x45 || header[2] !== 0xdf || header[3] !== 0xa3) return false;
  // MIME Sniffing's bounded EBML DocType search. A generic EBML signature alone
  // does not establish WebM (Matroska and other formats share it).
  for (let offset = 4; offset < 38 && offset + 3 < header.length; offset++) {
    if (header[offset] !== 0x42 || header[offset + 1] !== 0x82) continue;
    const start = offset + 2;
    let marker = 0x80;
    let length = 1;
    while (length <= 8 && !(header[start] & marker)) {
      marker >>= 1;
      length++;
    }
    if (length > 8 || start + length > header.length) return false;
    let size = header[start] & (marker - 1);
    for (let index = 1; index < length; index++) {
      size = size * 256 + header[start + index];
      if (size > ASSET_STREAM_HEADER_BYTES) return false;
    }
    const value = start + length;
    if (size < 4 || value + size > header.length) return false;
    const padding = size - 4;
    for (let index = 0; index < padding; index++) if (header[value + index] !== 0) return false;
    return header[value + padding] === 0x77 && header[value + padding + 1] === 0x65 && header[value + padding + 2] === 0x62 && header[value + padding + 3] === 0x6d;
  }
  return false;
}

function quicktimeHeader(header: Uint8Array): boolean {
  const bytes = Buffer.from(header.buffer, header.byteOffset, Math.min(header.byteLength, ASSET_STREAM_HEADER_BYTES));
  for (let offset = 0; offset + 8 <= bytes.length; ) {
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'ftyp') return videoFileTypeBox(bytes.subarray(offset));
    let size = bytes.readUInt32BE(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) return false;
      const extended = bytes.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      size = Number(extended);
      headerSize = 16;
    }
    if (size !== 0 && size < headerSize) return false;
    // Legacy QuickTime starts with these atoms rather than ftyp. Chromium's
    // image decoder rejects such prefixes, including when AVIF follows them.
    if (type === 'moov' || type === 'mdat') return true;
    if ((type !== 'wide' && type !== 'free') || size === 0 || size > bytes.length - offset) return false;
    offset += size;
  }
  return false;
}

export function canStreamAssetOriginal(mime: string, header: Uint8Array): boolean {
  if (['video/mp4', 'video/x-m4v'].includes(mime)) return videoFileTypeBox(header);
  if (mime === 'video/quicktime') return quicktimeHeader(header);
  if (mime === 'video/webm') return webmHeader(header);
  if (mime === 'application/zip') return header.length >= 4 && header[0] === 0x50 && header[1] === 0x4b && ((header[2] === 3 && header[3] === 4) || (header[2] === 5 && header[3] === 6) || (header[2] === 7 && header[3] === 8));
  return false;
}
