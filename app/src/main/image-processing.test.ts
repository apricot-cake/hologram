import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import { IMAGE_PROCESSING_LIMITS } from './image-processing-contract.ts';

const mocks = vi.hoisted(() => ({
  root: '',
  fork: vi.fn(),
  spawn: vi.fn(),
  window: vi.fn(),
}));
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => mocks.root }, utilityProcess: { fork: mocks.fork }, BrowserWindow: mocks.window }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./native-host.ts', () => ({ configDir: () => mocks.root }));

let processing: typeof import('./image-processing.ts');
let workers: Array<EventEmitter & { kill: Mock<() => void>; postMessage: ReturnType<typeof vi.fn> }>;
let nativeChildren: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: ReturnType<typeof vi.fn> }>;
let supervisors: Array<EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: EventEmitter & { destroy: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> }>;
let snapshots: Buffer[];
let windows: Array<{ loadURL: ReturnType<typeof vi.fn>; webContents: { getOSProcessId: () => number; executeJavaScript: ReturnType<typeof vi.fn> }; isDestroyed: () => boolean; destroy: ReturnType<typeof vi.fn> }>;
const browserPng = Buffer.from('safe-browser-frame-png');
let workerMode: 'success' | 'failure' | 'forged' | 'hang';
let nativeMode: 'success' | 'failure' | 'hang';
let supervisorMode: 'ready' | 'reject' | 'wait';
let supervisorStarted: () => void;
let nativeStarted: () => void | Promise<void>;
let workerStarted: () => void;
let nativeInput: string;
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
let exitListeners: ReturnType<typeof process.rawListeners>;

beforeEach(async () => {
  exitListeners = process.rawListeners('exit');
  vi.resetModules();
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  mocks.root = await fs.mkdtemp(path.join(os.tmpdir(), 'hologram-processing-parent-'));
  workers = [];
  nativeChildren = [];
  supervisors = [];
  snapshots = [];
  windows = [];
  workerMode = 'success';
  nativeMode = 'success';
  supervisorMode = 'ready';
  supervisorStarted = () => {};
  nativeStarted = () => {};
  workerStarted = () => {};
  nativeInput = '';
  mocks.window.mockImplementation(function () {
    let destroyed = false;
    const win = {
      loadURL: vi.fn(async () => undefined),
      webContents: { getOSProcessId: () => 54321, executeJavaScript: vi.fn(async () => `data:image/png;base64,${browserPng.toString('base64')}`) },
      isDestroyed: () => destroyed,
      destroy: vi.fn(() => {
        destroyed = true;
      }),
    };
    windows.push(win);
    return win;
  });
  mocks.fork.mockImplementation(() => {
    const worker = Object.assign(new EventEmitter(), { pid: 12345, kill: vi.fn(), postMessage: vi.fn() });
    worker.kill.mockImplementation(() => worker.emit('exit', 0));
    worker.postMessage.mockImplementation(async (request) => {
      snapshots.push(await fs.readFile(request.inputPath));
      workerStarted();
      if (workerMode === 'hang') return;
      if (workerMode === 'failure') return worker.emit('message', { id: request.id, ok: false, code: 'processing-failed' });
      const output = Buffer.from('safe-reencoded-image');
      await fs.writeFile(request.outputPath, output);
      worker.emit('message', { id: request.id, ok: true, outputPath: workerMode === 'forged' ? request.inputPath : request.outputPath, format: request.kind === 'copy' ? 'png' : 'webp', width: 10, height: 20, frames: request.kind === 'preview' ? 3 : 1, bytes: output.length, delay: [10, 20, 30], loop: 0 });
    });
    workers.push(worker);
    queueMicrotask(() => worker.emit('spawn'));
    return worker;
  });
  mocks.spawn.mockImplementation((_executable, args) => {
    if (args[0] === '--supervise') {
      const supervisor = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { destroy: vi.fn() }), kill: vi.fn() });
      supervisors.push(supervisor);
      queueMicrotask(() => {
        supervisorStarted();
        if (supervisorMode === 'ready') supervisor.stdout.emit('data', Buffer.from('READY\n'));
        else if (supervisorMode === 'reject') supervisor.emit('close', 1);
      });
      return supervisor;
    }
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
    nativeInput = args[0];
    nativeChildren.push(child);
    queueMicrotask(async () => {
      await nativeStarted();
      if (nativeMode === 'hang') return;
      if (nativeMode === 'failure') return child.emit('close', 1);
      child.stdout.emit('data', Buffer.from(JSON.stringify({ version: 1, decoder: 'libavif/dav1d', width: 10, height: 20, frames: 3, animated: true, depth: 10, alpha: true, allocatorBudget: true, liveBytesAfterDecode: 0 })));
      child.emit('close', 0);
    });
    return child;
  });
  processing = await import('./image-processing.ts');
});
afterEach(async () => {
  for (const worker of workers) worker.kill();
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', platformDescriptor);
  for (const listener of process.rawListeners('exit')) if (!exitListeners.includes(listener)) process.removeListener('exit', listener);
  await fs.rm(mocks.root, { recursive: true, force: true });
});

function avifBytes() {
  return Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypavif'), Buffer.from('immutable-validated-content')]);
}

function bmpBytes(width: number, height: number) {
  const bytes = Buffer.alloc(70);
  bytes.write('BM', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  return bytes;
}

test('BMP は専用 renderer の安全な bootstrap から読み、PNG 派生物を sharp 境界へ渡す', async () => {
  const result = await processing.prepareImageBytes(bmpBytes(2, 2), { kind: 'copy' });
  expect(result?.mime).toBe('image/png');
  expect(snapshots).toEqual([browserPng]);
  expect(mocks.window).toHaveBeenCalledWith(expect.objectContaining({ show: false, focusable: false, webPreferences: expect.objectContaining({ sandbox: true, partition: expect.stringMatching(/^image-processing-/) }) }));
  expect(windows[0].loadURL).toHaveBeenCalledOnce();
  expect(windows[0].loadURL).toHaveBeenCalledWith(expect.stringMatching(/\/decoder\.html$/));
  const script = windows[0].webContents.executeJavaScript.mock.calls[0][0] as string;
  expect(script).toContain('const avif = false');
  expect(script).toContain('image.src = source; await image.decode()');
  expect(supervisors).toHaveLength(2);
  expect(mocks.spawn).toHaveBeenCalledWith(expect.any(String), ['--supervise', '54321', String(1024 * 1024 * 1024)], expect.objectContaining({ windowsHide: true }));
  expect(windows[0].destroy).toHaveBeenCalledOnce();
});

test('過大な寸法を宣言する BMP は Chromium と sharp を起動する前に拒否する', async () => {
  expect(await processing.prepareImageBytes(bmpBytes(10000, 5000), { kind: 'preview' })).toBeNull();
  expect(mocks.window).not.toHaveBeenCalled();
  expect(mocks.fork).not.toHaveBeenCalled();
  expect(supervisors).toHaveLength(0);
});

test('AVIF copy は全フレーム検査済み snapshot の第一フレームを取得し PNG を sharp へ渡す', async () => {
  const original = path.join(mocks.root, 'original.avif');
  await fs.writeFile(original, avifBytes());
  const result = await processing.getPreparedImage(original, { kind: 'copy' });
  expect(result?.mime).toBe('image/png');
  expect(nativeChildren).toHaveLength(1);
  expect(windows[0].loadURL).toHaveBeenCalledWith(expect.stringMatching(/\/decoder\.html$/));
  expect(windows[0].loadURL).not.toHaveBeenCalledWith(pathToFileURL(original).href);
  expect(windows[0].loadURL).not.toHaveBeenCalledWith(pathToFileURL(nativeInput).href);
  const script = windows[0].webContents.executeJavaScript.mock.calls[0][0] as string;
  expect(script).toContain(JSON.stringify(pathToFileURL(nativeInput).href));
  expect(script).toContain('new ImageDecoder');
  expect(script).toContain('decoder.decode({frameIndex:0})');
  expect(script).toContain('image.close(); decoder.close()');
  expect(snapshots).toEqual([browserPng]);
  expect(supervisors).toHaveLength(2);
});

test('browserFrame の監督が拒否されたら原本復号スクリプトを実行しない', async () => {
  supervisorMode = 'reject';
  expect(await processing.prepareImageBytes(bmpBytes(2, 2), { kind: 'copy' })).toBeNull();
  expect(windows[0].webContents.executeJavaScript).not.toHaveBeenCalled();
  expect(mocks.fork).not.toHaveBeenCalled();
  expect(windows[0].destroy).toHaveBeenCalledOnce();
});

test('呼び出し後に入力 Buffer が変わっても worker は固定した snapshot を読む', async () => {
  const input = Buffer.from('original-input');
  const resultPromise = processing.prepareImageBytes(input, { kind: 'copy' });
  input.fill(0);
  const result = await resultPromise;
  expect(result?.mime).toBe('image/png');
  expect(snapshots).toEqual([Buffer.from('original-input')]);
  expect(await fs.readFile(result!.path)).toEqual(Buffer.from('safe-reencoded-image'));
});

test('同じ path の同時要求は一度だけ処理し、同じ内容の要求はキャッシュを再利用する', async () => {
  const file = path.join(mocks.root, 'input.gif');
  await fs.writeFile(file, 'same-input');
  const [first, duplicate] = await Promise.all([processing.getPreparedImage(file, { kind: 'preview' }), processing.getPreparedImage(file, { kind: 'preview' })]);
  const cached = await processing.getPreparedImage(file, { kind: 'preview' });
  expect(first).not.toBeNull();
  expect(duplicate).toEqual(first);
  expect(cached).toEqual(first);
  expect(first?.frames).toBe(3);
  expect(mocks.fork).toHaveBeenCalledOnce();
});

test('原本の mtime が変わらない置換でも内容が変わればキャッシュを使い回さない', async () => {
  const file = path.join(mocks.root, 'input.png');
  await fs.writeFile(file, 'first-content');
  const before = await fs.stat(file);
  const first = await processing.getPreparedImage(file, { kind: 'copy' });
  await fs.writeFile(file, 'other-content');
  await fs.utimes(file, before.atime, before.mtime);
  const second = await processing.getPreparedImage(file, { kind: 'copy' });
  expect(second?.path).not.toBe(first?.path);
  expect(snapshots).toEqual([Buffer.from('first-content'), Buffer.from('other-content')]);
  expect(snapshots).toHaveLength(2);
  expect(mocks.fork).toHaveBeenCalledOnce();
  expect(supervisors).toHaveLength(1);
  expect(nativeChildren).toHaveLength(0);
});

test('supervisor の拒否後は worker に画像処理を送らない', async () => {
  supervisorMode = 'reject';
  expect(await processing.prepareImageBytes(Buffer.from('untrusted-original'), { kind: 'preview' })).toBeNull();
  expect(workers[0].postMessage).not.toHaveBeenCalled();
  expect(workers[0].kill).toHaveBeenCalled();
});

test('supervisor が READY を返すまで worker に画像処理を送らない', async () => {
  supervisorMode = 'wait';
  let signal!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  supervisorStarted = signal;
  const resultPromise = processing.prepareImageBytes(Buffer.from('input'), { kind: 'preview' });
  await started;
  expect(workers[0].postMessage).not.toHaveBeenCalled();
  supervisors[0].stdout.emit('data', Buffer.from('REA'));
  expect(workers[0].postMessage).not.toHaveBeenCalled();
  supervisors[0].stdout.emit('data', Buffer.from('DY\n'));
  expect(await resultPromise).not.toBeNull();
  expect(workers[0].postMessage).toHaveBeenCalledOnce();
});

test.each(['failure', 'forged'] as const)('worker の %s 応答は原本へ戻さず一時ファイルを回収する', async (mode) => {
  workerMode = mode;
  expect(await processing.prepareImageBytes(Buffer.from('untrusted-original'), { kind: 'preview' })).toBeNull();
  const sessions = await fs.readdir(path.join(mocks.root, 'prepared-images-v1'));
  expect(await fs.readdir(path.join(mocks.root, 'prepared-images-v1', sessions[0]))).toEqual([]);
  expect(workers[0].kill).toHaveBeenCalledOnce();
});

test('AVIF preview は native 全フレーム検査に渡した同じ snapshot を返す', async () => {
  const file = path.join(mocks.root, 'original.avif');
  const bytes = avifBytes();
  await fs.writeFile(file, bytes);
  nativeStarted = () => fs.writeFile(file, 'replaced-original');
  const result = await processing.getPreparedImage(file, { kind: 'preview' });
  expect(result).toMatchObject({ path: nativeInput, mime: 'image/avif', frames: 3, avif: true });
  expect(result?.path).not.toBe(file);
  expect(await fs.readFile(result!.path)).toEqual(bytes);
  expect(mocks.fork).not.toHaveBeenCalled();
  expect(mocks.window).not.toHaveBeenCalled();
  expect(nativeChildren[0].kill).toHaveBeenCalledOnce();
});

test('native AVIF 検査の失敗後は Chromium に入力を渡さない', async () => {
  nativeMode = 'failure';
  expect(await processing.prepareImageBytes(avifBytes(), { kind: 'preview' })).toBeNull();
  expect(mocks.window).not.toHaveBeenCalled();
  expect(mocks.fork).not.toHaveBeenCalled();
  const sessions = await fs.readdir(path.join(mocks.root, 'prepared-images-v1'));
  expect(await fs.readdir(path.join(mocks.root, 'prepared-images-v1', sessions[0]))).toEqual([]);
});

test.each(['sharp', 'native'] as const)('%s process が停止したら期限で kill して失敗を返す', async (kind) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  workerMode = kind === 'sharp' ? 'hang' : 'success';
  nativeMode = kind === 'native' ? 'hang' : 'success';
  let signal!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  if (kind === 'sharp') workerStarted = signal;
  else nativeStarted = signal;
  const result = processing.prepareImageBytes(kind === 'native' ? avifBytes() : Buffer.from('input'), { kind: 'preview' });
  await started;
  await vi.advanceTimersByTimeAsync(IMAGE_PROCESSING_LIMITS.timeoutSeconds * 1000);
  expect(await result).toBeNull();
  expect((kind === 'sharp' ? workers[0] : nativeChildren[0]).kill).toHaveBeenCalledOnce();
  if (kind === 'sharp') {
    workerMode = 'success';
    expect(await processing.prepareImageBytes(Buffer.from('next-input'), { kind: 'preview' })).not.toBeNull();
    expect(mocks.fork).toHaveBeenCalledTimes(2);
    expect(supervisors).toHaveLength(2);
  }
});
