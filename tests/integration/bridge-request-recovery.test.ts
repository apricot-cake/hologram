import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { expect, test, vi } from 'vitest';
import { buildEnvelope, writeInboxEvent } from '../../native-host/inbox.mts';
import { normalizePostRecord } from '../../native-host/post-record.mts';
import { openDatabase } from '../../app/src/main/lib-db';
import { drainInbox } from '../../app/src/main/lib-db-inbox';
import { compactInbox, COMPACT_THRESHOLD } from '../../app/src/main/lib-db-inbox-compact';

const id = '1789600000000-cafe';
const nonce = 'a'.repeat(32);
const request = { type: 'saveMedia', captureId: id, requestNonce: nonce, mediaUrl: 'https://example.com/recovery.png', metadata: { url: 'https://x.com/u/status/2078680803660431845' } };
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// 本物の別プロセスを停止する。製品側にテスト用の停止点は追加しない。
// barrier はファイルの確定後に書くので、停止の時刻を sleep で推測しない。
const preload = `
const fs = require('node:fs');
const path = require('node:path');
global.fetch = async () => {
  fs.appendFileSync(process.env.RECOVERY_FETCH_LOG, 'fetch\\n');
  if (process.env.RECOVERY_FAIL_FETCH) throw new Error('Injected download failure');
  return new Response(Buffer.from('${png.toString('base64')}', 'base64'), { status: 200, headers: { 'content-type': 'image/png' } });
};
function barrier(stage) {
  if (process.env.RECOVERY_STOP !== stage) return;
  fs.writeFileSync(process.env.RECOVERY_BARRIER, stage, { flush: true });
  if (process.env.RECOVERY_RELEASE) {
    while (!fs.existsSync(process.env.RECOVERY_RELEASE)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
const mkdir = fs.mkdirSync;
fs.mkdirSync = (dir, options) => {
  const result = mkdir(dir, options);
  if (path.basename(String(dir)) === 'request-locks') barrier('library');
  if (path.basename(String(dir)) === 'item') barrier('allocate');
  return result;
};
const write = fs.writeFileSync;
fs.writeFileSync = (file, data, options) => {
  const result = write(file, data, options);
  if (path.basename(String(file)) === '.hologram-request-owner.json') barrier('owner');
  return result;
};
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (path.basename(String(to)) === 'output.json' && JSON.parse(fs.readFileSync(from, 'utf8')).phase === process.env.RECOVERY_FAIL_JOURNAL) throw new Error('Injected journal failure');
  const result = rename(from, to);
  if (String(to).includes('.interrupted-')) barrier('takeover');
  if (path.basename(String(to)) === 'output.json' && JSON.parse(fs.readFileSync(to, 'utf8')).phase === 'publishing') barrier('prepared');
  if (String(to).includes(path.sep + 'items' + path.sep)) barrier('item');
  if (String(to).endsWith('.png')) barrier('download');
  if (path.basename(String(to)) === 'result.json' && JSON.parse(fs.readFileSync(to, 'utf8')).state === 'completed') barrier('ack');
  return result;
};
const renameAsync = fs.promises.rename;
fs.promises.rename = async (from, to) => {
  const publishing = String(to).includes(path.sep + '.hologram-inbox' + path.sep + 'new' + path.sep);
  if (publishing) barrier('publish');
  if (publishing && process.env.RECOVERY_FAIL_PUBLISH) throw new Error('Injected publication failure');
  const result = await renameAsync(from, to);
  if (publishing) barrier('commit');
  return result;
};
const remove = fs.rmSync;
fs.rmSync = (target, options) => {
  if (process.env.RECOVERY_FAIL_DELETE && path.basename(String(target)) === 'item') throw Object.assign(new Error('Injected sharing violation'), { code: 'EPERM' });
  return remove(target, options);
};
`;

function fixture() {
  const config = fs.mkdtempSync(path.join(process.env.HOLOGRAM_CONFIG_DIR!, 'request-recovery-'));
  const folder = path.join(config, 'library');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ saveFolder: folder }));
  const hook = path.join(config, 'preload.cjs');
  fs.writeFileSync(hook, preload);
  return { config, folder, hook, barrier: path.join(config, 'barrier'), fetchLog: path.join(config, 'fetch.log') };
}

function startHost(f: ReturnType<typeof fixture>, req = request, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--require', f.hook, path.resolve('native-host/bridge.mts')], { env: { ...process.env, HOLOGRAM_CONFIG_DIR: f.config, RECOVERY_FETCH_LOG: f.fetchLog, RECOVERY_BARRIER: f.barrier, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = Buffer.alloc(0);
  let stderr = '';
  child.stdout.on('data', (bytes) => {
    output = Buffer.concat([output, bytes]);
  });
  child.stderr.on('data', (bytes) => {
    stderr += bytes;
  });
  const closed = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', () => resolve());
  });
  const body = Buffer.from(JSON.stringify(req));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  child.stdin.end(Buffer.concat([header, body]));
  return {
    child,
    closed,
    response: async () => {
      await closed;
      if (output.length < 4) throw new Error(stderr || 'Missing native response');
      return JSON.parse(output.subarray(4, 4 + output.readUInt32LE(0)).toString());
    },
  };
}

async function stopHost(f: ReturnType<typeof fixture>, stage: string, req = request) {
  const host = startHost(f, req, { RECOVERY_STOP: stage });
  try {
    await vi.waitFor(() => expect(fs.existsSync(f.barrier)).toBe(true), { timeout: 5000, interval: 10 });
    expect(fs.readFileSync(f.barrier, 'utf8')).toBe(stage);
    host.child.kill('SIGKILL');
    await host.closed;
  } finally {
    if (host.child.exitCode === null && host.child.signalCode === null) {
      host.child.kill('SIGKILL');
      await host.closed;
    }
  }
}

function receiptDir(f: ReturnType<typeof fixture>) {
  return path.join(f.folder, '.hologram-inbox', 'requests', id);
}

function items(f: ReturnType<typeof fixture>) {
  const dir = path.join(f.folder, 'items');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

test('処理中の先頭200件を残したまま、次のホストが期限切れの受領記録まで巡回する', async () => {
  const f = fixture();
  const root = path.dirname(receiptDir(f));
  for (let n = 0; n < 200; n++) {
    const dir = path.join(root, `1789600000000-${n.toString(16).padStart(4, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'processing', ownerPid: process.pid, startedAt: Date.now(), generation: 'active' }));
  }
  const expired = path.join(root, '1789600000001-dead');
  fs.mkdirSync(expired);
  const result = path.join(expired, 'result.json');
  fs.writeFileSync(result, JSON.stringify({ state: 'failed', error: 'old', completedAt: 1 }));
  const old = new Date(Date.now() - 31 * 24 * 60 * 60_000);
  fs.utimesSync(result, old, old);
  expect((await startHost(f).response()).ok).toBe(true);
  expect(fs.existsSync(expired)).toBe(true);
  const next = { ...request, captureId: '1789600000002-beef', metadata: { url: 'https://example.com/gc-next' } };
  expect((await startHost(f, next).response()).ok).toBe(true);
  expect(fs.existsSync(expired)).toBe(false);
  expect(fs.existsSync(path.join(root, '1789600000000-0000'))).toBe(true);
});

test('ロック取得中に設定を切り替えても、要求の保存先と受領記録は元のライブラリに固定する', async () => {
  const f = fixture();
  const other = path.join(f.config, 'other-library');
  fs.mkdirSync(other);
  const release = path.join(f.config, 'release');
  const host = startHost(f, request, { RECOVERY_STOP: 'library', RECOVERY_RELEASE: release });
  try {
    await vi.waitFor(() => expect(fs.existsSync(f.barrier)).toBe(true), { timeout: 5000, interval: 10 });
    fs.writeFileSync(path.join(f.config, 'config.json'), JSON.stringify({ saveFolder: other }));
    fs.writeFileSync(release, 'resume');
    expect(await host.response()).toMatchObject({ ok: true, saveFolder: f.folder });
    expect(items(f)).toEqual([id]);
    expect(JSON.parse(fs.readFileSync(path.join(receiptDir(f), 'result.json'), 'utf8')).state).toBe('completed');
    expect(fs.readdirSync(other)).toEqual([]);
    const query: any = { type: 'query', urls: [request.metadata.url] };
    expect((await startHost(f, query).response()).results[request.metadata.url]).toBeNull();
  } finally {
    if (host.child.exitCode === null && host.child.signalCode === null) {
      host.child.kill('SIGKILL');
      await host.closed;
    }
  }
});

test.each(['trash', 'purge'])('公開後に%sへ移動した項目は、再取得せず元の応答を復元する', async (state) => {
  const f = fixture();
  await stopHost(f, 'commit');
  const expected = JSON.parse(fs.readFileSync(path.join(receiptDir(f), 'output.json'), 'utf8')).ack;
  const original = path.join(f.folder, 'items', id);
  const trash = path.join(f.folder, '.trash', id);
  fs.mkdirSync(path.dirname(trash));
  fs.renameSync(original, trash);
  if (state === 'purge') fs.rmSync(trash, { recursive: true });
  const before = fs.readFileSync(f.fetchLog, 'utf8');
  expect(await startHost(f).response()).toMatchObject(expected);
  expect(await startHost(f).response()).toMatchObject(expected);
  expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe(before);
  expect(items(f)).toEqual([]);
  expect(fs.existsSync(trash)).toBe(state === 'trash');
});

test('世代交代でreceiptのパスが空いても、三つの回収ホストは一つだけが保存する', async () => {
  const f = fixture();
  await stopHost(f, 'download');
  fs.rmSync(f.barrier);
  const release = path.join(f.config, 'release');
  const winner = startHost(f, request, { RECOVERY_STOP: 'takeover', RECOVERY_RELEASE: release });
  try {
    await vi.waitFor(() => expect(fs.existsSync(f.barrier)).toBe(true), { timeout: 5000, interval: 10 });
    expect(fs.existsSync(receiptDir(f))).toBe(false);
    const contenders = await Promise.all([startHost(f).response(), startHost(f).response()]);
    for (const response of contenders) expect(response).toMatchObject({ ok: false, code: 'request-in-progress' });
    expect(fs.existsSync(receiptDir(f))).toBe(false);
    expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe('fetch\n');
    // 別要求は別の接続・ロックなので、停止中の回収に巻き込まれない。
    const other = { ...request, captureId: '1789600000001-beef', metadata: { url: 'https://x.com/u/status/2078680803660431847' } };
    expect(await startHost(f, other).response()).toMatchObject({ ok: true, captureId: other.captureId });
    fs.writeFileSync(release, 'resume');
    expect(await winner.response()).toMatchObject({ ok: true, captureId: id });
    const fetched = fs.readFileSync(f.fetchLog, 'utf8');
    expect(fetched).toBe('fetch\nfetch\nfetch\n');
    expect(await startHost(f).response()).toMatchObject({ ok: true, captureId: id });
    expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe(fetched);
    expect(items(f).sort()).toEqual([id, other.captureId]);
    expect(fs.readdirSync(path.join(f.folder, '.hologram-inbox', 'new')).sort()).toEqual([`${id}.json`, `${other.captureId}.json`]);
  } finally {
    if (winner.child.exitCode === null && winner.child.signalCode === null) {
      winner.child.kill('SIGKILL');
      await winner.closed;
    }
  }
});

test('終了した所有者のPIDが生存プロセスに再利用されても、固定ロックから回収可能と判断する', async () => {
  const f = fixture();
  await stopHost(f, 'download');
  const resultFile = path.join(receiptDir(f), 'result.json');
  const receipt = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
  expect(receipt.lockVersion).toBe(2);
  receipt.ownerPid = process.pid;
  fs.writeFileSync(resultFile, JSON.stringify(receipt));
  const query: any = { type: 'query', urls: [], requestIds: [id] };
  expect(await startHost(f, query).response()).toMatchObject({ ok: true, requests: { [id]: { state: 'retryable' } } });
  expect(await startHost(f).response()).toMatchObject({ ok: true, captureId: id });
  expect(items(f)).toEqual([id]);
});

test('媒体を取得中の実ホストが固定ロックを持つ間は、照会も再送も所有権を保持する', async () => {
  const f = fixture();
  const release = path.join(f.config, 'release');
  const owner = startHost(f, request, { RECOVERY_STOP: 'download', RECOVERY_RELEASE: release });
  try {
    await vi.waitFor(() => expect(fs.existsSync(f.barrier)).toBe(true), { timeout: 5000, interval: 10 });
    const query: any = { type: 'query', urls: [], requestIds: [id] };
    expect(await startHost(f, query).response()).toMatchObject({ ok: true, requests: { [id]: { state: 'processing' } } });
    expect(await startHost(f).response()).toMatchObject({ ok: false, code: 'request-in-progress' });
    expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe('fetch\n');
    fs.writeFileSync(release, 'resume');
    expect(await owner.response()).toMatchObject({ ok: true, captureId: id });
    expect(await startHost(f, query).response()).toMatchObject({ ok: true, requests: { [id]: { state: 'completed' } } });
    expect(items(f)).toEqual([id]);
  } finally {
    if (owner.child.exitCode === null && owner.child.signalCode === null) {
      owner.child.kill('SIGKILL');
      await owner.closed;
    }
  }
});

test.each(['allocate', 'owner'])('%s直後の終了でも、記録前のstageを回収して項目を一つだけ公開する', async (stage) => {
  const f = fixture();
  await stopHost(f, stage);
  expect(items(f)).toEqual([]);
  expect(fs.existsSync(path.join(receiptDir(f), 'output.json'))).toBe(false);
  expect((await startHost(f).response()).ok).toBe(true);
  expect(items(f)).toEqual([id]);
  expect(fs.readdirSync(path.dirname(receiptDir(f)))).toEqual([id]);
});

test('媒体取得後に強制終了しても、実際に割り当てたsuffix項目だけを回収する', async () => {
  const f = fixture();
  const original = path.join(f.folder, 'items', id);
  fs.mkdirSync(original, { recursive: true });
  fs.writeFileSync(path.join(original, 'existing.png'), '既存の媒体');
  await stopHost(f, 'download');
  const journal = JSON.parse(fs.readFileSync(path.join(receiptDir(f), 'output.json'), 'utf8'));
  expect(journal.itemId).toBe(`${id}-1`);
  expect(journal.phase).toBe('downloading');
  expect((await startHost(f).response()).ok).toBe(true);
  expect(fs.readdirSync(path.join(f.folder, 'items')).sort()).toEqual([id, `${id}-1`]);
  expect(fs.readFileSync(path.join(original, 'existing.png'), 'utf8')).toBe('既存の媒体');
  expect(fs.readdirSync(path.join(f.folder, '.hologram-inbox', 'new'))).toEqual([`${id}-1.json`]);
});

test('投稿の複数媒体を取得中に終了しても、旧世代を回収して一つの項目へ保存する', async () => {
  const f = fixture();
  const req: any = {
    type: 'savePost',
    captureId: id,
    requestNonce: nonce,
    metaOk: true,
    metadata: {
      url: 'https://x.com/u/status/2078680803660431846',
      text: '二枚の媒体',
      media: [
        { url: 'https://example.com/one.png', type: 'image' },
        { url: 'https://example.com/two.png', type: 'image' },
      ],
    },
  };
  await stopHost(f, 'download', req);
  const fetched = fs.readFileSync(f.fetchLog, 'utf8');
  expect(await startHost(f, req).response()).toMatchObject({ ok: true, captureId: id, mediaCount: 2 });
  expect(fs.readdirSync(path.join(f.folder, 'items'))).toEqual([id]);
  expect(fs.readdirSync(path.join(f.folder, 'items', id)).sort()).toEqual([`${id}-media-0.png`, `${id}-media-1.png`]);
  expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe(`${fetched}fetch\nfetch\n`);
});

test('元要求IDの別の公開済み項目を、suffix要求の保存結果として採用しない', async () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.folder, 'items', id), { recursive: true });
  fs.writeFileSync(path.join(f.folder, 'items', id, 'old.png'), '元の媒体');
  await writeInboxEvent(f.folder, buildEnvelope(normalizePostRecord({ captureId: id, url: 'https://example.com/original', image: `items/${id}/old.png`, media: [{ url: 'https://example.com/old.png', file: `items/${id}/old.png` }] })));
  const original = path.join(f.folder, '.hologram-inbox', 'new', `${id}.json`);
  const before = fs.readFileSync(original);
  await stopHost(f, 'publish');
  expect(await startHost(f).response()).toMatchObject({ ok: true, captureId: `${id}-1`, file: `items/${id}-1/${id}-1.png` });
  expect(fs.readFileSync(original)).toEqual(before);
  expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe('fetch\n');
});

test.each(['prepared', 'item', 'publish', 'commit', 'ack'])('%sで終了した要求は再取得せず同じ媒体とイベントへ収束する', async (stage) => {
  const f = fixture();
  await stopHost(f, stage);
  const file = path.join(f.folder, 'items', id, `${id}.png`);
  const before = fs.readFileSync(fs.existsSync(file) ? file : path.join(receiptDir(f), 'item', `${id}.png`));
  const fetched = fs.readFileSync(f.fetchLog, 'utf8');
  const ack = await startHost(f).response();
  expect(ack).toMatchObject({ ok: true, captureId: id });
  expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe(fetched);
  expect(fs.readFileSync(file)).toEqual(before);
  expect(fs.readdirSync(path.join(f.folder, 'items'))).toEqual([id]);
  expect(fs.readdirSync(path.join(f.folder, '.hologram-inbox', 'new'))).toEqual([`${id}.json`]);
});

test('公開失敗の応答で媒体を削除せず、同じ公開を再試行できる', async () => {
  const f = fixture();
  const failed = await startHost(f, request, { RECOVERY_FAIL_PUBLISH: '1' }).response();
  expect(failed).toMatchObject({ ok: false, code: 'request-in-progress' });
  const fetched = fs.readFileSync(f.fetchLog, 'utf8');
  expect((await startHost(f).response()).ok).toBe(true);
  expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe(fetched);
  expect(fs.readdirSync(path.join(f.folder, 'items'))).toEqual([id]);
});

test.each(['downloading', 'publishing'])('%sの耐久記録に失敗したら媒体やイベントを残さない', async (phase) => {
  const f = fixture();
  expect(await startHost(f, request, { RECOVERY_FAIL_JOURNAL: phase }).response()).toMatchObject({ ok: false, code: 'save-failed' });
  expect(items(f)).toEqual([]);
  expect(fs.existsSync(path.join(f.folder, '.hologram-inbox', 'new', `${id}.json`))).toBe(false);
  expect(fs.existsSync(f.fetchLog)).toBe(phase === 'publishing');
});

test('通常の取得失敗でも削除不能なら終端失敗にせず、後で同じ要求を回収できる', async () => {
  const f = fixture();
  expect(await startHost(f, request, { RECOVERY_FAIL_FETCH: '1', RECOVERY_FAIL_DELETE: '1' }).response()).toMatchObject({ ok: false, code: 'request-in-progress' });
  expect(JSON.parse(fs.readFileSync(path.join(receiptDir(f), 'result.json'), 'utf8')).state).toBe('retryable');
  expect((await startHost(f).response()).ok).toBe(true);
  expect(items(f)).toEqual([id]);
});

test('異なるエンベロープが同じ公開先に存在したら上書きも媒体削除もしない', async () => {
  const f = fixture();
  await stopHost(f, 'publish');
  await writeInboxEvent(f.folder, buildEnvelope(normalizePostRecord({ captureId: id, text: '異なる内容' })));
  const file = path.join(f.folder, '.hologram-inbox', 'new', `${id}.json`);
  const before = fs.readFileSync(file);
  expect(await startHost(f).response()).toMatchObject({ ok: false, code: 'request-in-progress' });
  expect(fs.readFileSync(file)).toEqual(before);
  expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe('fetch\n');
  expect(fs.existsSync(path.join(f.folder, 'items', id, `${id}.png`))).toBe(true);
});

test('回収時の削除に失敗しても所有記録を失わず、suffixで再保存を始めない', async () => {
  const f = fixture();
  await stopHost(f, 'download');
  const before = fs.readFileSync(path.join(receiptDir(f), 'output.json'));
  expect(await startHost(f, request, { RECOVERY_FAIL_DELETE: '1' }).response()).toMatchObject({ ok: false, code: 'request-in-progress' });
  expect(fs.readFileSync(path.join(receiptDir(f), 'output.json'))).toEqual(before);
  expect(items(f)).toEqual([]);
  expect((await startHost(f).response()).ok).toBe(true);
  expect(fs.readdirSync(path.join(f.folder, 'items'))).toEqual([id]);
});

test('記録前の失敗と削除失敗が重なっても、次回の回復でstageを残さない', async () => {
  const f = fixture();
  expect(await startHost(f, request, { RECOVERY_FAIL_JOURNAL: 'downloading', RECOVERY_FAIL_DELETE: '1' }).response()).toMatchObject({ ok: false, code: 'request-in-progress' });
  expect(items(f)).toEqual([]);
  expect((await startHost(f).response()).ok).toBe(true);
  expect(items(f)).toEqual([id]);
  expect(fs.readdirSync(path.dirname(receiptDir(f)))).toEqual([id]);
});

test('別ホストの持続照会ポートにも、公開回復後の保存済み状態を通知する', async () => {
  const f = fixture();
  await stopHost(f, 'publish');
  const child = spawn(process.execPath, ['--require', f.hook, path.resolve('native-host/bridge.mts')], { env: { ...process.env, HOLOGRAM_CONFIG_DIR: f.config, RECOVERY_FETCH_LOG: f.fetchLog }, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise<void>((resolve) => child.on('close', () => resolve()));
  let pending: ((response: any) => void) | null = null;
  let buffer = Buffer.alloc(0);
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length < 4 || buffer.length < 4 + buffer.readUInt32LE(0)) return;
    const size = buffer.readUInt32LE(0);
    const response = JSON.parse(buffer.subarray(4, 4 + size).toString());
    buffer = buffer.subarray(4 + size);
    pending?.(response);
    pending = null;
  });
  const query = () =>
    new Promise<any>((resolve) => {
      pending = resolve;
      const body = Buffer.from(JSON.stringify({ type: 'query', id: 1, urls: [request.metadata.url] }));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      child.stdin.write(Buffer.concat([header, body]));
    });
  try {
    expect((await query()).results[request.metadata.url]).toBe(null);
    expect((await startHost(f).response()).ok).toBe(true);
    expect((await query()).results[request.metadata.url]).toMatchObject({ id });
  } finally {
    child.stdin.end();
    await closed;
  }
});

test.each(['nonce', 'generation', 'live'])('%sが異なる保存の媒体を回収しない', async (kind) => {
  const f = fixture();
  await stopHost(f, 'download');
  const marker = path.join(receiptDir(f), 'item', '.hologram-request-owner.json');
  if (kind === 'generation') {
    const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
    fs.writeFileSync(marker, JSON.stringify({ ...owner, generation: 'b'.repeat(32) }));
  }
  if (kind === 'live') {
    const result = path.join(receiptDir(f), 'result.json');
    const owner = JSON.parse(fs.readFileSync(result, 'utf8'));
    // 固定SQLiteロックを持たない旧ホストの受領情報はPIDによる確認を維持する。
    delete owner.lockVersion;
    fs.writeFileSync(result, JSON.stringify({ ...owner, ownerPid: process.pid }));
  }
  const before = fs.readFileSync(marker);
  const response = await startHost(f, kind === 'nonce' ? { ...request, requestNonce: 'b'.repeat(32) } : request).response();
  expect(response.ok).toBe(false);
  expect(fs.readFileSync(marker)).toEqual(before);
  expect(items(f)).toEqual([]);
  expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe('fetch\n');
});

test('メディアを持たない本文保存も公開中断後に元の応答を復元する', async () => {
  const f = fixture();
  const req: any = { type: 'savePost', captureId: id, requestNonce: nonce, metaOk: true, metadata: { url: 'https://x.com/u/status/2078680803660431845', text: '保存する本文' } };
  await stopHost(f, 'publish', req);
  expect(await startHost(f, req).response()).toMatchObject({ ok: true, captureId: id, file: id, mediaCount: 0 });
  expect(fs.existsSync(f.fetchLog)).toBe(false);
});

test.each([false, true])(
  '取込後にlooseを圧縮しても、公開中断からの回復でDBの投稿と媒体が増えない（完全削除:%s）',
  async (deleted) => {
    const f = fixture();
    await stopHost(f, 'commit');
    for (let n = 1; n < COMPACT_THRESHOLD; n++) {
      const record = normalizePostRecord({ captureId: `1789600000001-${n.toString(16).padStart(4, '0')}`, text: `圧縮の検証 ${n}` });
      await writeInboxEvent(f.folder, buildEnvelope(record));
    }
    const db = openDatabase(path.join(f.folder, 'hologram.db'));
    try {
      expect(drainInbox(f.folder, db.sqlite).skipped).toEqual([]);
      expect(compactInbox(f.folder, db.sqlite).compacted).toBe(true);
      expect(fs.existsSync(path.join(f.folder, '.hologram-inbox', 'new', `${id}.json`))).toBe(false);
      if (deleted) {
        db.sqlite.prepare('DELETE FROM posts WHERE captureId = ?').run(id);
        fs.rmSync(path.join(f.folder, 'items', id), { recursive: true });
      }
      const fetched = fs.readFileSync(f.fetchLog, 'utf8');
      expect((await startHost(f).response()).ok).toBe(true);
      expect(drainInbox(f.folder, db.sqlite).skipped).toEqual([]);
      expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: COMPACT_THRESHOLD - (deleted ? 1 : 0) });
      expect(fs.readFileSync(f.fetchLog, 'utf8')).toBe(fetched);
      expect(fs.readdirSync(path.join(f.folder, 'items'))).toEqual(deleted ? [] : [id]);
    } finally {
      db.sqlite.close();
    }
  },
  20000,
);
