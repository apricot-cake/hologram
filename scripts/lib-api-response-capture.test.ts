import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const { CAPTURE_MARKER, MAX_RESPONSE_BYTES, MAX_SESSION_BYTES, MAX_RESPONSES, RETENTION_MS, MAX_SESSIONS, captureRoot, createCaptureSession, readSession, replayCapture, pruneSessions } = require('./lib-api-response-capture.cts');

const apiUrl = 'https://cdn.syndication.twimg.com/tweet-result?id=123';
const postUrl = 'https://x.com/example/status/123';
const record = { platform: 'x', text: '', avatar: null, media: [], acquisitionIssues: [] };
let temporaryRoot: string;
let env: { LOCALAPPDATA: string };

beforeEach(() => {
  temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-api-capture-test-'));
  env = { LOCALAPPDATA: temporaryRoot };
});

afterEach(() => {
  // mkdtemp でこのテストが所有したディレクトリだけを片付ける。
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

function session() {
  return createCaptureSession({ urls: [postUrl], seconds: 60 }, env);
}

describe('開発用 API 応答の保存', () => {
  test('null・空配列・欠落フィールドを生の本文のまま保持し、ヘッダーを保存しない', () => {
    const capture = session();
    const body = '{ "text": null, "photos": [], "user": {"name":null} }\n';
    capture.addResponse({ url: apiUrl, status: 200, body, outcome: 'response', headers: { authorization: 'secret', cookie: 'private' } });
    capture.addResponse({ url: apiUrl, status: null, body: null, outcome: 'transport' });
    capture.finish();
    const saved = readSession(capture.id, env);
    expect(saved.responses[0].body).toBe(body);
    expect(JSON.parse(saved.responses[0].body)).toEqual({ text: null, photos: [], user: { name: null } });
    expect(saved.responses[0]).not.toHaveProperty('headers');
    expect(saved.responses[1].body).toBeNull();
    expect(fs.readFileSync(path.join(captureRoot(env), capture.id, 'capture.json'), 'utf8')).not.toMatch(/secret|private|authorization|cookie/);
  });

  test('応答件数と単一応答の上限で採取を止め、完了後も再読込できる', () => {
    const capture = session();
    expect(capture.addResponse({ url: apiUrl, status: 200, body: 'あ'.repeat(Math.floor(MAX_RESPONSE_BYTES / 3) + 1), outcome: 'response' })).toBe(false);
    expect(capture.capture.responses).toHaveLength(0);
    for (let i = 0; i < MAX_RESPONSES; i++) expect(capture.addResponse({ url: apiUrl, status: 200, body: '{}', outcome: 'response' })).toBe(true);
    expect(capture.addResponse({ url: apiUrl, status: 200, body: '{}', outcome: 'response' })).toBe(false);
    capture.finish();
    expect(readSession(capture.id, env).responses).toHaveLength(MAX_RESPONSES);
    expect(readSession(capture.id, env).limited).toBe(true);
  });

  test('JSON エスケープで膨らむ本文でもセッションファイルの上限を守る', () => {
    const capture = session();
    const body = '\u0000'.repeat(Math.floor(MAX_RESPONSE_BYTES / 2));
    for (let i = 0; i < 10; i++) capture.addResponse({ url: apiUrl, status: 200, body, outcome: 'response' });
    capture.finish();
    expect(capture.capture.limited).toBe(true);
    expect(fs.statSync(path.join(captureRoot(env), capture.id, 'capture.json')).size).toBeLessThanOrEqual(MAX_SESSION_BYTES);
    expect(() => readSession(capture.id, env)).not.toThrow();
  });

  test('期限切れのセッションには新しい応答を書き込まない', () => {
    const capture = createCaptureSession({ urls: [postUrl], seconds: -1 }, env);
    expect(capture.addResponse({ url: apiUrl, status: 200, body: '{}', outcome: 'response' })).toBe(false);
    expect(capture.capture.limited).toBe(true);
  });

  test('保存先はリポジトリ外に限定し、UUID 以外による再読込を拒否する', () => {
    expect(captureRoot(env)).toBe(path.join(temporaryRoot, 'Hologram', 'verification', 'api-responses'));
    expect(() => captureRoot({ LOCALAPPDATA: path.resolve(__dirname, '..') })).toThrow(/リポジトリ内/);
    expect(() => captureRoot({ LOCALAPPDATA: 'relative' })).toThrow();
    for (const id of ['../outside', '..\\outside', path.join(temporaryRoot, 'outside'), '123']) expect(() => readSession(id, env)).toThrow(/UUID/);
  });

  test('セッションの junction から外部ファイルを読まない', () => {
    const root = captureRoot(env);
    fs.mkdirSync(root, { recursive: true });
    const outside = path.join(temporaryRoot, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'capture.json'), '{}');
    const id = crypto.randomUUID();
    fs.symlinkSync(outside, path.join(root, id), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => readSession(id, env)).toThrow(/リンク|保存先が不正/);
    expect(fs.readFileSync(path.join(outside, 'capture.json'), 'utf8')).toBe('{}');
  });
});

describe('ネットワークを使わない再生', () => {
  test('同じ URL の複数応答を順番に再生して fetch を復元する', async () => {
    const capture = session();
    capture.addResponse({ url: apiUrl, status: 200, body: '{"text":null,"photos":[]}', outcome: 'response' });
    capture.addResponse({ url: apiUrl, status: 200, body: '{"text":"next"}', outcome: 'response' });
    capture.addPost(postUrl, record);
    const original = globalThis.fetch;
    let networkCalls = 0;
    const network = async () => {
      networkCalls++;
      throw new Error('network forbidden');
    };
    globalThis.fetch = network;
    try {
      const replay = await replayCapture(capture.capture, async () => {
        expect(await (await fetch(apiUrl)).json()).toEqual({ text: null, photos: [] });
        expect(await (await fetch(apiUrl)).json()).toEqual({ text: 'next' });
        return record;
      });
      expect(replay.posts[0].changed).toBe(false);
      expect(replay.unmatchedRequests).toBe(0);
      expect(networkCalls).toBe(0);
      expect(globalThis.fetch).toBe(network);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('壊れた JSON 本文の解析エラーを再現し、例外時も fetch を復元する', async () => {
    const capture = session();
    capture.addResponse({ url: apiUrl, status: 200, body: '{bad', outcome: 'response' });
    capture.addPost(postUrl, record);
    const original = globalThis.fetch;
    await expect(replayCapture(capture.capture, async () => (await fetch(apiUrl)).json())).rejects.toBeInstanceOf(SyntaxError);
    expect(globalThis.fetch).toBe(original);
  });

  test('未採取の要求は不足件数へ記録し、実際のネットワークへフォールバックしない', async () => {
    const capture = session();
    capture.addPost(postUrl, record);
    const original = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls++;
      throw new Error('network forbidden');
    };
    try {
      const replay = await replayCapture(capture.capture, async () => {
        await expect(fetch(apiUrl)).rejects.toThrow(/収集にない/);
        return record;
      });
      expect(replay.unmatchedRequests).toBe(1);
      expect(networkCalls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('採取物だけの保持期限管理', () => {
  test('古い所有セッションだけを削除し、無関係のディレクトリと junction を残す', () => {
    const root = captureRoot(env);
    fs.mkdirSync(root, { recursive: true });
    const now = Date.now();
    function addOwned(age: number, format = CAPTURE_MARKER) {
      const directory = path.join(root, crypto.randomUUID());
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ format, createdAt: new Date(now - age).toISOString() }));
      return directory;
    }
    const expired = addOwned(RETENTION_MS + 1);
    const current = addOwned(0);
    const unrelated = addOwned(RETENTION_MS + 1, 'other-tool');
    const outside = path.join(temporaryRoot, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'preserve');
    fs.writeFileSync(path.join(outside, 'summary.json'), JSON.stringify({ format: CAPTURE_MARKER, createdAt: new Date(0).toISOString() }));
    const linked = path.join(root, crypto.randomUUID());
    fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    pruneSessions(root, now);
    expect(fs.existsSync(expired)).toBe(false);
    for (const directory of [current, unrelated, linked]) expect(fs.existsSync(directory)).toBe(true);
    expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe('preserve');
  });

  test('新規採取の直前に保持件数を整理する', () => {
    const root = captureRoot(env);
    fs.mkdirSync(root, { recursive: true });
    for (let i = 0; i < MAX_SESSIONS + 3; i++) {
      const directory = path.join(root, crypto.randomUUID());
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify({ format: CAPTURE_MARKER, createdAt: new Date(Date.now() - i * 1000).toISOString() }));
    }
    session();
    expect(fs.readdirSync(root)).toHaveLength(MAX_SESSIONS);
  });
});
