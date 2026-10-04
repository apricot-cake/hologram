import { expect, test } from 'vitest';
import { canStreamAssetOriginal } from './lib-asset-stream-signature.ts';

function atom(type: string, data = Buffer.alloc(0)) {
  const bytes = Buffer.alloc(8 + data.length);
  bytes.writeUInt32BE(bytes.length);
  bytes.write(type, 4);
  data.copy(bytes, 8);
  return bytes;
}

function fileType(major: string, compatible: string[] = []) {
  const data = Buffer.alloc(8 + compatible.length * 4);
  data.write(major);
  compatible.forEach((brand, index) => data.write(brand, 8 + index * 4));
  return atom('ftyp', data);
}

test('画像を非画像 MIME に改名しても原本配信を許可しない', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const avif = fileType('avif');
  for (const mime of ['application/octet-stream', 'video/mp4', 'video/x-m4v', 'video/quicktime', 'video/webm', 'application/zip']) {
    expect(canStreamAssetOriginal(mime, png)).toBe(false);
    expect(canStreamAssetOriginal(mime, avif)).toBe(false);
  }
});

test('video ftyp は完全な有限 box と既知 brand を必要とする', () => {
  expect(canStreamAssetOriginal('video/mp4', fileType('iso5', ['mp42']))).toBe(true);
  expect(canStreamAssetOriginal('video/x-m4v', fileType('M4V '))).toBe(true);
  expect(canStreamAssetOriginal('video/mp4', fileType('xxxx'))).toBe(false);
  expect(canStreamAssetOriginal('video/mp4', fileType('isom').subarray(0, 12))).toBe(false);
  const oversized = fileType('isom');
  oversized.writeUInt32BE(8192);
  expect(canStreamAssetOriginal('video/mp4', oversized)).toBe(false);
});

test('major が動画でも image compatible brand を原本配信しない', () => {
  for (const brand of ['avif', 'avis', 'mif1', 'heic']) expect(canStreamAssetOriginal('video/mp4', fileType('isom', [brand]))).toBe(false);
});

test('legacy MOV atom を保持し padding の先の AVIF を拒否する', () => {
  for (const type of ['moov', 'mdat']) expect(canStreamAssetOriginal('video/quicktime', atom(type))).toBe(true);
  for (const type of ['wide', 'free']) {
    expect(canStreamAssetOriginal('video/quicktime', Buffer.concat([atom(type), atom('mdat')]))).toBe(true);
    expect(canStreamAssetOriginal('video/quicktime', Buffer.concat([atom(type), fileType('avif')]))).toBe(false);
    expect(canStreamAssetOriginal('video/quicktime', atom(type))).toBe(false);
  }
});

test('WebM は EBML だけでなく bounded DocType を確認する', () => {
  const ebml = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
  expect(canStreamAssetOriginal('video/webm', ebml)).toBe(false);
  expect(canStreamAssetOriginal('video/webm', Buffer.concat([ebml, Buffer.from([0x42, 0x82, 0x84]), Buffer.from('webm')]))).toBe(true);
  expect(canStreamAssetOriginal('video/webm', Buffer.concat([ebml, Buffer.from([0x42, 0x82, 0x88]), Buffer.from('matroska')]))).toBe(false);
});

test('ZIP の通常・空・spanned signature を保持する', () => {
  for (const suffix of [
    [3, 4],
    [5, 6],
    [7, 8],
  ])
    expect(canStreamAssetOriginal('application/zip', Buffer.from([0x50, 0x4b, ...suffix]))).toBe(true);
  expect(canStreamAssetOriginal('application/zip', Buffer.from([0x50, 0x4b]))).toBe(false);
});
