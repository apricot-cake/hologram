// Unit tests for app/src/main/lib-model-fetch.ts (#832, parent #98) — the one
// download-verify-commit primitive the model manager calls per file.
//
// fetch is stubbed (vi.stubGlobal), same convention as
// media-download-link-card.test.ts. No real network, no real 23MB onnx file:
// every case here uses a few bytes of fixture content and its real SHA-256.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ModelFileVerificationError, fetchModelFile, fileMatchesHash } from '../app/src/main/lib-model-fetch';

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const CONTENT = Buffer.from('the quick brown fox jumps over the lazy dog, a few times over so it is not tiny');
const CONTENT_SHA256 = sha256(CONTENT);
const URL = 'https://huggingface.co/fake/model/resolve/deadbeef/weights.bin';

let dir: string;
let dest: string;
let fetchCalls: Array<{ url: string; headers: Record<string, string> }>;

function headerMap(init?: RequestInit): Record<string, string> {
  const h: Record<string, string> = {};
  if (init?.headers) for (const [k, v] of new Headers(init.headers as HeadersInit)) h[k.toLowerCase()] = v;
  return h;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-model-fetch-'));
  dest = path.join(dir, 'sub', 'weights.bin');
  fetchCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('fileMatchesHash', () => {
  test('存在しないファイルは false', async () => {
    expect(await fileMatchesHash(dest, CONTENT_SHA256)).toBe(false);
  });

  test('中身が一致すれば true、しなければ false', async () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, CONTENT);
    expect(await fileMatchesHash(dest, CONTENT_SHA256)).toBe(true);
    expect(await fileMatchesHash(dest, 'f'.repeat(64))).toBe(false);
  });
});

describe('fetchModelFile: 新規取得', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), headers: headerMap(init) });
      return new Response(CONTENT, { status: 200, headers: { 'content-length': String(CONTENT.length) } });
    });
  });

  test('宛先へ書かれ、.part は残らない', async () => {
    await fetchModelFile(URL, dest, CONTENT_SHA256);
    expect(fs.readFileSync(dest)).toEqual(CONTENT);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].headers.range).toBeUndefined();
  });

  test('中間ディレクトリが無くても作られる', async () => {
    expect(fs.existsSync(path.dirname(dest))).toBe(false);
    await fetchModelFile(URL, dest, CONTENT_SHA256);
    expect(fs.existsSync(dest)).toBe(true);
  });

  test('進捗コールバックは増加していく bytesDone を報告する', async () => {
    const seen: number[] = [];
    await fetchModelFile(URL, dest, CONTENT_SHA256, (p) => seen.push(p.bytesDone));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(CONTENT.length);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
  });
});

describe('fetchModelFile: 既に正しいファイルがある', () => {
  test('ネットワークへ出ない（受け入れ条件: 既取得はそのまま使う）', async () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, CONTENT);
    vi.stubGlobal('fetch', async () => {
      throw new Error('must not be called');
    });
    await expect(fetchModelFile(URL, dest, CONTENT_SHA256)).resolves.toBeUndefined();
  });
});

describe('fetchModelFile: 中断からの再開', () => {
  test('.part の続きから Range で取りにいき、結合結果が正しい', async () => {
    const half = CONTENT.subarray(0, 20);
    const rest = CONTENT.subarray(20);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(`${dest}.part`, half);

    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), headers: headerMap(init) });
      return new Response(rest, { status: 206, headers: { 'content-range': `bytes 20-${CONTENT.length - 1}/${CONTENT.length}`, 'content-length': String(rest.length) } });
    });

    await fetchModelFile(URL, dest, CONTENT_SHA256);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].headers.range).toBe(`bytes=${half.length}-`);
    expect(fs.readFileSync(dest)).toEqual(CONTENT);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  test('サーバーが Range を無視して 200 を返したら最初からやり直す', async () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(`${dest}.part`, Buffer.from('garbage-not-a-real-prefix'));

    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), headers: headerMap(init) });
      return new Response(CONTENT, { status: 200, headers: { 'content-length': String(CONTENT.length) } });
    });

    await fetchModelFile(URL, dest, CONTENT_SHA256);
    expect(fs.readFileSync(dest)).toEqual(CONTENT);
  });
});

describe('fetchModelFile: 壊れたファイルは検証で弾かれ、再取得できる', () => {
  test('ハッシュが合わないと ModelFileVerificationError で失敗し、.part も宛先も残らない', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('WRONG BYTES ENTIRELY'), { status: 200 }));

    await expect(fetchModelFile(URL, dest, CONTENT_SHA256)).rejects.toThrow(ModelFileVerificationError);
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(`${dest}.part`)).toBe(false);
  });

  test('直後に正しい内容を返すサーバーへ再取得すると成功する', async () => {
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('WRONG BYTES ENTIRELY'), { status: 200 }));
    await expect(fetchModelFile(URL, dest, CONTENT_SHA256)).rejects.toThrow(ModelFileVerificationError);

    vi.stubGlobal('fetch', async () => new Response(CONTENT, { status: 200, headers: { 'content-length': String(CONTENT.length) } }));
    await fetchModelFile(URL, dest, CONTENT_SHA256);
    expect(fs.readFileSync(dest)).toEqual(CONTENT);
  });

  test('既に置かれていた（後から壊れた）宛先ファイルも、次の呼び出しで検出され上書きされる', async () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from('this used to be right but bit-rotted'));

    vi.stubGlobal('fetch', async () => new Response(CONTENT, { status: 200, headers: { 'content-length': String(CONTENT.length) } }));
    await fetchModelFile(URL, dest, CONTENT_SHA256);
    expect(fs.readFileSync(dest)).toEqual(CONTENT);
  });
});

describe('fetchModelFile: HTTP エラー', () => {
  test('404 はエラーとして伝わり、何も書かれない', async () => {
    vi.stubGlobal('fetch', async () => new Response('not found', { status: 404 }));
    await expect(fetchModelFile(URL, dest, CONTENT_SHA256)).rejects.toThrow(/404/);
    expect(fs.existsSync(dest)).toBe(false);
  });
});
