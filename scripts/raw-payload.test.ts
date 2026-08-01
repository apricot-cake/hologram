// Unit tests for native-host/raw-payload.mts = the packing, verification, and
// extraction of the raw-payload preservation layer (#292) for fetched payloads. Runs on
// plain Node (no Electron needed).
//
// What's guarded here is the implementation-side promise behind the principle "fetching
// is irreversible" = the body that was received comes back byte-for-byte identical,
// saving never fails just because it exceeds the cap, and a corrupted original is never
// returned as if it were the original.

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { OMITTED_OVERSIZE, RAW_PAYLOAD_MAX_BYTES, normalizeRawPayloads, packRawPayloads, unpackRawPayload } from '../native-host/raw-payload.mts';

const FIXED_NOW = '2026-07-28T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

// A shape close to a real fetch = hands over formatted JSON as-is as the body
const BODY = JSON.stringify({ text: '猫がすき', user: { name: 'アリス' }, unknown_future_field: 42 });

function toDbRow(p: { encoding: string; sha256: string; payloadBase64: string | null }) {
  return { encoding: p.encoding, sha256: p.sha256, payload: p.payloadBase64 ? Buffer.from(p.payloadBase64, 'base64') : null };
}

describe('packRawPayloads: 受け取った本文をそのまま畳む', () => {
  const [p] = packRawPayloads([{ sourceKind: 'api:x/tweet-result', contentType: 'application/json', body: BODY }], { now: fixedNow });

  test('gzip として記録される', () => {
    expect(p.encoding).toBe('gzip');
  });

  test('圧縮を解くと元の本文に一字一句戻る', () => {
    expect(gunzipSync(Buffer.from(p.payloadBase64 as string, 'base64')).toString('utf8')).toBe(BODY);
  });

  // sha256 is a value over the pre-compression byte sequence = it points at the body itself, not at how it was compressed
  test('sha256 は圧縮前バイト列の値', () => {
    expect(p.sha256).toBe(createHash('sha256').update(Buffer.from(BODY, 'utf8')).digest('hex'));
  });

  test('byteLength は圧縮前のバイト数（文字数ではない）', () => {
    expect(p.byteLength).toBe(Buffer.byteLength(BODY, 'utf8'));
  });

  test('acquiredAt が無ければ now() で埋まる', () => {
    expect(p.acquiredAt).toBe(FIXED_NOW);
  });

  test('渡された acquiredAt は保つ（取得時刻は取得側が知っている）', () => {
    const [q] = packRawPayloads([{ sourceKind: 'api:x/tweet-result', acquiredAt: '2020-01-01T00:00:00.000Z', body: BODY }]);
    expect(q.acquiredAt).toBe('2020-01-01T00:00:00.000Z');
  });

  test('取得の順番を保つ（あとで読む人が経過を追える）', () => {
    const packed = packRawPayloads([
      { sourceKind: 'api:bluesky/resolveHandle', body: '{"did":"did:plc:a"}' },
      { sourceKind: 'api:bluesky/getPostThread', body: BODY },
      { sourceKind: 'api:bluesky/getProfile', body: '{}' },
    ]);
    expect(packed.map((x) => x.sourceKind)).toEqual(['api:bluesky/resolveHandle', 'api:bluesky/getPostThread', 'api:bluesky/getProfile']);
  });

  test('sourceKind の無い項目・配列でない入力は落とす', () => {
    expect(packRawPayloads([{ body: 'x' }, null, 'nope', { sourceKind: 'api:x/tweet-result' }])).toEqual([]);
    expect(packRawPayloads(undefined)).toEqual([]);
  });
});

// #292: the cap is not a "decide to discard" mechanism but a brake on a runaway
// response = even over the cap, saving continues, and the fact that the fetch happened
// and its identity (sourceKind / sha256 / size) are preserved.
describe('レコード単位の上限', () => {
  const huge = 'あ'.repeat(200); // 600 bytes in UTF-8
  const packed = packRawPayloads(
    [
      { sourceKind: 'api:x/tweet-result', body: huge },
      { sourceKind: 'api:x/profile', body: huge },
    ],
    { maxBytes: 700, now: fixedNow },
  );

  test('予算に収まる分は畳まれる', () => {
    expect(packed[0].encoding).toBe('gzip');
  });

  test('あふれた分は保存失敗にせず omitted:oversize として残る', () => {
    expect(packed[1].encoding).toBe(OMITTED_OVERSIZE);
    expect(packed[1].payloadBase64).toBeNull();
  });

  test('本文を落としても取得の同一性は残る', () => {
    expect(packed[1].sha256).toBe(packed[0].sha256);
    expect(packed[1].byteLength).toBe(600);
  });

  test('既定の上限は実在の投稿応答（数十KB）よりはるかに大きい', () => {
    expect(RAW_PAYLOAD_MAX_BYTES).toBeGreaterThan(1_000_000);
  });
});

// The side that receives originals coming back from an envelope or an export ZIP. The
// key point is that one broken item doesn't take the whole post down with it (must not throw).
describe('normalizeRawPayloads: 戻ってきた原本の検証', () => {
  test('壊れた項目だけ落として残りは通す', () => {
    const got = normalizeRawPayloads([{ sourceKind: 'api:x/tweet-result', sha256: 'abc', encoding: 'gzip', payloadBase64: 'AAA=', byteLength: 3 }, { sourceKind: 'api:x/tweet-result' }, null, 7]);
    expect(got).toHaveLength(1);
    expect(got[0].sha256).toBe('abc');
  });

  test('本文を持たない encoding では payloadBase64 を捨てる（偽の原本を作らない）', () => {
    const [got] = normalizeRawPayloads([{ sourceKind: 'k', sha256: 'abc', encoding: OMITTED_OVERSIZE, payloadBase64: 'AAA=' }]);
    expect(got.payloadBase64).toBeNull();
  });

  test('配列でなければ空（旧レコードには raw が無い）', () => {
    expect(normalizeRawPayloads(undefined)).toEqual([]);
  });

  test('詰め込んだものを検証に通すと同じ形で戻る', () => {
    const packed = packRawPayloads([{ sourceKind: 'api:x/tweet-result', contentType: 'application/json', body: BODY }], { now: fixedNow });
    expect(normalizeRawPayloads(packed)).toEqual(packed);
  });
});

describe('unpackRawPayload: 読み出しは sha256 が合ったときだけ', () => {
  const [p] = packRawPayloads([{ sourceKind: 'api:x/tweet-result', body: BODY }], { now: fixedNow });

  test('保存した原本が本文として戻る', () => {
    expect(unpackRawPayload(toDbRow(p))).toBe(BODY);
  });

  // Rather than return corrupted content as if it were "the original", return nothing at all
  test('sha256 が合わなければ null', () => {
    expect(unpackRawPayload({ ...toDbRow(p), sha256: 'deadbeef' })).toBeNull();
  });

  test('gzip として解けなければ null', () => {
    expect(unpackRawPayload({ encoding: 'gzip', sha256: p.sha256, payload: Buffer.from('not gzip') })).toBeNull();
  });

  test('本文を持たない行は null', () => {
    expect(unpackRawPayload({ encoding: OMITTED_OVERSIZE, sha256: p.sha256, payload: null })).toBeNull();
  });
});
