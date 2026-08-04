// Unit tests for app/src/main/lib-model-manager.ts (#832, parent #98): the
// opt-in gate, on-disk status, download orchestration and deletion built on
// lib-model-fetch.ts. Every case uses small fake registry entries (real
// SHA-256 of a few fixed bytes) and an explicit `root` tmp dir — never the
// real registry's 23MB onnx file and never the real ~/.hologram/models.
//
// lib-model-manager.ts pulls in lib-ml-runtime.ts for aiFeaturesEnabled() /
// modelsRoot(), which imports Electron's utilityProcess, electron-log, and
// (via lib-config.ts) native-host.ts — which itself reads `app.isPackaged`
// and requires sibling .cts files by a computed absolute path at import time.
// All three are swapped out the same way electron-log/preload.test.ts and
// lib-config-libraries.test.ts already do for the same reason: nothing here
// starts the inference child or needs the real native-host layer, only
// configDir() so aiFeaturesEnabled()/modelsRoot() can be pointed at a sandbox.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// lib-config.ts computes `CONFIG_PATH = path.join(configDir(), 'config.json')`
// ONCE at module load (top-level const, not re-evaluated per call), and this
// file's `await import(...)` below runs that load exactly once for the whole
// suite. So configDir() must return a STABLE directory for the run — this
// mock cannot rotate `dir` per test the way the fully re-imported module in
// lib-config-libraries.test.ts's freshModule() can. Tests instead rewrite
// config.json's CONTENT at that fixed path (lib-config.ts's read cache keys
// on size/mtime/ino, so an overwrite is still seen fresh next read).
const env = vi.hoisted(() => {
  const fsSync = require('node:fs');
  const osSync = require('node:os');
  const pathSync = require('node:path');
  return { dir: fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'hologram-model-config-')) };
});

vi.mock('electron', () => ({
  utilityProcess: {
    fork: () => {
      throw new Error('must not fork the inference child from the model manager');
    },
  },
}));
vi.mock('electron-log/main', () => ({ default: { info() {}, warn() {}, error() {} } }));
vi.mock('../app/src/main/native-host.ts', () => ({
  configDir: () => env.dir,
  defaultLibraryDir: () => path.join(env.dir, 'default-library'),
  resolveSaveFolder: () => ({ folder: path.join(env.dir, 'default-library'), recoveredFromPointer: false }),
}));

const { downloadModel, deleteModel, getModelStatus, listModelStatuses } = await import('../app/src/main/lib-model-manager');
type ModelRegistryEntry = import('../app/src/main/lib-model-registry').ModelRegistryEntry;

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const FILE_A = Buffer.from('registry file A content, a bit longer than one word');
const FILE_B = Buffer.from('registry file B content, different bytes than A');

function makeEntry(id: string, rev: string): ModelRegistryEntry {
  return {
    id,
    rev,
    files: [
      { path: 'a.txt', sha256: sha256(FILE_A), bytes: FILE_A.length },
      { path: 'sub/b.txt', sha256: sha256(FILE_B), bytes: FILE_B.length },
    ],
    licenseNote: 'Test License 1.0',
  };
}

let root: string;
let served: Record<string, Buffer>;
let fetchCalls: string[];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-model-root-'));
  fs.rmSync(path.join(env.dir, 'config.json'), { force: true }); // back to "no config yet" = ai off by default
  fetchCalls = [];
  served = {};
  vi.stubGlobal('fetch', async (url: unknown) => {
    fetchCalls.push(String(url));
    const key = String(url).split('/resolve/')[1];
    const buf = served[key as string];
    if (!buf) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(buf), { status: 200, headers: { 'content-length': String(buf.length) } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(env.dir, { recursive: true, force: true });
});

function setAiEnabled(enabled: boolean) {
  fs.writeFileSync(path.join(env.dir, 'config.json'), JSON.stringify({ ai: { enabled } }));
}

function serveEntry(entry: ModelRegistryEntry, files: Buffer[]) {
  entry.files.forEach((f, i) => {
    served[`${entry.rev}/${f.path}`] = files[i];
  });
}

describe('オプトインしていない状態では取得が始まらない', () => {
  test('config.json が無い（既定オフ）と拒否し、fetch は一度も呼ばれない', async () => {
    const entry = makeEntry('acme/one', 'rev1');
    await expect(downloadModel(entry.id, { registry: [entry], root })).rejects.toThrow(/not enabled/);
    expect(fetchCalls).toEqual([]);
  });

  test('ai.enabled=false でも同様', async () => {
    setAiEnabled(false);
    const entry = makeEntry('acme/one', 'rev1');
    await expect(downloadModel(entry.id, { registry: [entry], root })).rejects.toThrow(/not enabled/);
    expect(fetchCalls).toEqual([]);
  });

  test('ai.enabled=true なら取得できる', async () => {
    setAiEnabled(true);
    const entry = makeEntry('acme/one', 'rev1');
    serveEntry(entry, [FILE_A, FILE_B]);
    const status = await downloadModel(entry.id, { registry: [entry], root });
    expect(status.state).toBe('complete');
  });
});

describe('getModelStatus / listModelStatuses', () => {
  test('未取得は absent、完了後は complete、bytesDone/bytesTotal が一致する', async () => {
    const entry = makeEntry('acme/two', 'rev1');
    expect(getModelStatus(entry.id, { registry: [entry], root }).state).toBe('absent');

    serveEntry(entry, [FILE_A, FILE_B]);
    await downloadModel(entry.id, { registry: [entry], root, skipGate: true });

    const status = getModelStatus(entry.id, { registry: [entry], root });
    expect(status.state).toBe('complete');
    expect(status.bytesTotal).toBe(FILE_A.length + FILE_B.length);
    expect(status.bytesDone).toBe(status.bytesTotal);
  });

  test('一部のファイルだけ揃っていれば partial', () => {
    const entry = makeEntry('acme/three', 'rev1');
    const dir = path.join(root, 'acme', 'three@rev1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), FILE_A);
    // sub/b.txt intentionally absent
    expect(getModelStatus(entry.id, { registry: [entry], root }).state).toBe('partial');
  });

  test('listModelStatuses はレジストリの全件を返す', () => {
    const a = makeEntry('acme/four', 'rev1');
    const b = makeEntry('acme/five', 'rev1');
    const statuses = listModelStatuses({ registry: [a, b], root });
    expect(statuses.map((s) => s.id)).toEqual([a.id, b.id]);
  });

  test('存在しない id は throw', () => {
    expect(() => getModelStatus('nope/nope', { registry: [], root })).toThrow(/unknown model/);
  });
});

describe('取得を中断して再開すると続きから進み、完了後の SHA-256 がレジストリと一致する', () => {
  test('片方のファイルだけ済ませてから残りを取得する2段階呼び出しでも complete になる', async () => {
    setAiEnabled(true);
    const entry = makeEntry('acme/six', 'rev1');
    serveEntry(entry, [FILE_A, FILE_B]);

    // First round: only file A is servable (simulates a run interrupted before file B started).
    const partial = { ...entry, files: [entry.files[0]] };
    const dir = path.join(root, 'acme', 'six@rev1');
    fs.mkdirSync(dir, { recursive: true });
    await downloadModel(entry.id, { registry: [partial], root, skipGate: true });
    expect(fs.existsSync(path.join(dir, 'a.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'sub', 'b.txt'))).toBe(false);

    // Resume with the full entry: file A is already correct (skipped, no re-fetch), file B fetched.
    fetchCalls = [];
    const status = await downloadModel(entry.id, { registry: [entry], root, skipGate: true });
    expect(status.state).toBe('complete');
    expect(fetchCalls.some((u) => u.endsWith('a.txt'))).toBe(false);
    expect(fetchCalls.some((u) => u.endsWith('b.txt'))).toBe(true);
  });
});

describe('意図的に壊したファイルは検証で弾かれ、再取得できる', () => {
  test('宛先ファイルが壊れていても downloadModel の再呼び出しで直る', async () => {
    const entry = makeEntry('acme/seven', 'rev1');
    const dir = path.join(root, 'acme', 'seven@rev1');
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a.txt'), Buffer.from('CORRUPTED, not the real content'));
    fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), FILE_B);

    serveEntry(entry, [FILE_A, FILE_B]);
    const status = await downloadModel(entry.id, { registry: [entry], root, skipGate: true });
    expect(status.state).toBe('complete');
    expect(fs.readFileSync(path.join(dir, 'a.txt'))).toEqual(FILE_A);
  });
});

describe('推論経路がネットワークへ出ない', () => {
  test('モデルが無いディレクトリでは何も取得せず absent のまま（黙って取りに行かない）', () => {
    const entry = makeEntry('acme/eight', 'rev1');
    expect(getModelStatus(entry.id, { registry: [entry], root }).state).toBe('absent');
    expect(fetchCalls).toEqual([]); // getModelStatus never touches the network at all
  });
});

describe('「削除」の後に ~/.hologram/models にファイルが残らない', () => {
  test('モデルのディレクトリごと消え、空になった org ディレクトリも残らない', async () => {
    const entry = makeEntry('acme/nine', 'rev1');
    serveEntry(entry, [FILE_A, FILE_B]);
    await downloadModel(entry.id, { registry: [entry], root, skipGate: true });
    expect(fs.existsSync(path.join(root, 'acme', 'nine@rev1'))).toBe(true);

    await deleteModel(entry.id, { registry: [entry], root });
    expect(fs.existsSync(path.join(root, 'acme', 'nine@rev1'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'acme'))).toBe(false);
  });

  test('同じ org に他のモデルが残っていれば org ディレクトリごとは消さない', async () => {
    const one = makeEntry('acme/ten-a', 'rev1');
    const two = makeEntry('acme/ten-b', 'rev1');
    serveEntry(one, [FILE_A, FILE_B]);
    serveEntry(two, [FILE_A, FILE_B]);
    await downloadModel(one.id, { registry: [one, two], root, skipGate: true });
    await downloadModel(two.id, { registry: [one, two], root, skipGate: true });

    await deleteModel(one.id, { registry: [one, two], root });
    expect(fs.existsSync(path.join(root, 'acme', 'ten-a@rev1'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'acme', 'ten-b@rev1'))).toBe(true);
  });

  test('未取得のモデルを削除してもエラーにならない', async () => {
    const entry = makeEntry('acme/eleven', 'rev1');
    await expect(deleteModel(entry.id, { registry: [entry], root })).resolves.toBeUndefined();
  });
});

describe('レジストリの rev を上げても自動では新しいモデルが入らない（知らせるだけ）', () => {
  test('旧 rev のディレクトリが残っていても、現在の rev は absent のまま。installedRev で知らせる', async () => {
    const oldEntry = makeEntry('acme/twelve', 'old-rev');
    serveEntry(oldEntry, [FILE_A, FILE_B]);
    await downloadModel(oldEntry.id, { registry: [oldEntry], root, skipGate: true });

    const newEntry = makeEntry('acme/twelve', 'new-rev');
    const status = getModelStatus(newEntry.id, { registry: [newEntry], root });
    expect(status.state).toBe('absent');
    expect(status.installedRev).toBe('old-rev');

    // The old rev's files are untouched — nothing auto-migrated or deleted them.
    expect(fs.existsSync(path.join(root, 'acme', 'twelve@old-rev', 'a.txt'))).toBe(true);
  });
});

describe('進捗コールバック', () => {
  test('ファイル名つきの途中イベントと、file:null の最終イベントを受け取る', async () => {
    const entry = makeEntry('acme/thirteen', 'rev1');
    serveEntry(entry, [FILE_A, FILE_B]);
    const events: Array<{ file: string | null; bytesDone: number }> = [];
    await downloadModel(entry.id, { registry: [entry], root, skipGate: true, onProgress: (p) => events.push({ file: p.file, bytesDone: p.bytesDone }) });

    expect(events.some((e) => e.file === 'a.txt')).toBe(true);
    expect(events.some((e) => e.file === 'sub/b.txt')).toBe(true);
    const last = events[events.length - 1];
    expect(last.file).toBeNull();
    expect(last.bytesDone).toBe(FILE_A.length + FILE_B.length);
  });
});

describe('同時呼び出し', () => {
  test('同じ id への並行呼び出しは1回分の取得を共有する', async () => {
    const entry = makeEntry('acme/fourteen', 'rev1');
    serveEntry(entry, [FILE_A, FILE_B]);
    const [a, b] = await Promise.all([downloadModel(entry.id, { registry: [entry], root, skipGate: true }), downloadModel(entry.id, { registry: [entry], root, skipGate: true })]);
    expect(a).toEqual(b);
    expect(fetchCalls.filter((u) => u.endsWith('a.txt'))).toHaveLength(1);
    expect(fetchCalls.filter((u) => u.endsWith('b.txt'))).toHaveLength(1);
  });
});
