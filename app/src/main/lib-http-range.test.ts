import { describe, expect, test } from 'vitest';
import { parseAssetByteRange } from './lib-http-range';

describe('parseAssetByteRange', () => {
  test('Range が無ければ全体応答を選ぶ', () => {
    expect(parseAssetByteRange(null, 100)).toBeNull();
  });

  test('単一の bounded/open-ended/suffix range を解決する', () => {
    expect(parseAssetByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseAssetByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseAssetByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseAssetByteRange('bytes=-200', 100)).toEqual({ start: 0, end: 99 });
    expect(parseAssetByteRange('bytes=90-200', 100)).toEqual({ start: 90, end: 99 });
  });

  test('範囲外・逆順・複数 range・空ファイルを拒む', () => {
    for (const value of ['bytes=100-', 'bytes=20-10', 'bytes=0-1,4-5', 'bytes=-0', 'items=0-1']) {
      expect(parseAssetByteRange(value, 100)).toBe('unsatisfiable');
    }
    expect(parseAssetByteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });
});
