// native-host/raw-payload.mts のユニットテスト＝取得ペイロードの原本保全層（#292）の
// 詰め込み・検証・取り出し。素の Node で動く（Electron 不要）。
//
// ここで守っているのは「取得は不可逆」という原則の実装側の約束＝受け取った本文が
// 一字一句そのまま戻ること、上限を超えても保存が失敗しないこと、壊れた原本を
// 原本として返さないこと。

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { OMITTED_OVERSIZE, RAW_PAYLOAD_MAX_BYTES, normalizeRawPayloads, packRawPayloads, unpackRawPayload } from '../native-host/raw-payload.mts';

const FIXED_NOW = '2026-07-28T00:00:00.000Z';
const fixedNow = () => FIXED_NOW;

// 実際の取得に近い形＝整形済み JSON をそのまま本文として渡す
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

  // sha256 は圧縮前バイト列に対する値＝どう圧縮したかではなく本文そのものを指す
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

// #292: 上限は「捨てる判断」ではなく暴走した応答の歯止め＝超過しても保存は続き、
// 取得があった事実と同一性（sourceKind / sha256 / サイズ）は残る。
describe('レコード単位の上限', () => {
  const huge = 'あ'.repeat(200); // UTF-8 で 600 バイト
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

// 封筒・書き出し ZIP から戻ってきた原本を受け取る側。1件の壊れが投稿ごと道連れに
// ならないこと（throw しない）が要点。
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

  // 中身が化けたものを「原本」として返すくらいなら何も返さない
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
