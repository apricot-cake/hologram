import { app, BrowserWindow, utilityProcess, type UtilityProcess } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { imageSize } from 'image-size';
import { configDir } from './native-host';
import { createJobPool } from './lib-job-pool';
import { IMAGE_PROCESSING_LIMITS as limits, ImageProcessingRequestSchema, type ImageProcessingResult } from './image-processing-contract';

export interface ImageOptions {
  kind: 'thumbnail' | 'preview' | 'copy';
  width?: number;
  rotation?: 0 | 90 | 180 | 270;
  flipped?: boolean;
}
export interface PreparedImage {
  path: string;
  mime: string;
  width: number;
  height: number;
  frames: number;
  avif: boolean;
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const pool = createJobPool({ concurrency: 1 });
const cache = new Map<string, PreparedImage>();
const rejected = new Map<string, number>();
const cacheFiles = new Map<string, number>();
const pending = new Map<string, Promise<PreparedImage | null>>();
let cacheDirectory: Promise<string> | undefined;
let ownedCacheDirectory: string | undefined;
let queuedInputBytes = 0;
let sharpProcess: Promise<UtilityProcess> | undefined;
let sharpWorker: UtilityProcess | undefined;
let sharpSupervisor: ChildProcessWithoutNullStreams | undefined;
let sharpIdleTimer: NodeJS.Timeout | undefined;
const CACHE_BYTES = 512 * 1024 * 1024;
const CACHE_FILES = 128;

async function getCacheDirectory(): Promise<string> {
  cacheDirectory ??= (async () => {
    const root = path.join(configDir(), 'prepared-images-v1');
    await fs.mkdir(root, { recursive: true });
    // プロセスごとに分け、別のアプリが使用中のファイルを上書きしない。
    ownedCacheDirectory = await fs.mkdtemp(path.join(root, 'session-'));
    return ownedCacheDirectory;
  })();
  return cacheDirectory;
}

process.once('exit', () => {
  sharpSupervisor?.stdin.destroy();
  // このプロセスが作った一時キャッシュだけを回収する。
  if (ownedCacheDirectory) {
    try {
      rmSync(ownedCacheDirectory, { recursive: true, force: true });
    } catch {
      /* 次回の画像処理には再利用しない。 */
    }
  }
});

function nativeExecutable(): string {
  const name = process.platform === 'win32' ? 'avif-validator.exe' : 'avif-validator';
  return app.isPackaged ? path.join(process.resourcesPath, 'avif', name) : path.join(app.getAppPath(), 'vendor', 'avif', name);
}

async function readInput(filePath: string): Promise<Buffer | null> {
  const file = await fs.open(filePath, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limits.inputBytes) return null;
    const bytes = Buffer.allocUnsafe(limits.inputBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, size);
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    return size > 0 && size <= limits.inputBytes ? bytes.subarray(0, size) : null;
  } finally {
    await file.close();
  }
}

const dimension = z.number().int().positive().max(16_384);
const NativeResultSchema = z.object({
  version: z.literal(1),
  decoder: z.literal('libavif/dav1d'),
  width: dimension,
  height: dimension,
  browserWidth: dimension.optional(),
  browserHeight: dimension.optional(),
  frames: z.number().int().positive().max(limits.frames),
  animated: z.boolean(),
  depth: z.union([z.literal(8), z.literal(10), z.literal(12)]),
  alpha: z.boolean(),
  allocatorBudget: z.literal(true),
  liveBytesAfterDecode: z.literal(0),
});

async function validateAvif(inputPath: string): Promise<z.infer<typeof NativeResultSchema> | null> {
  return new Promise((resolve) => {
    const child = spawn(nativeExecutable(), [inputPath, String(limits.pixels), '16384', String(limits.frames), String(limits.totalPixels)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    const finish = (value: z.infer<typeof NativeResultSchema> | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), limits.timeoutSeconds * 1_000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) finish(null);
      else chunks.push(chunk);
    });
    // stderr も drain し、出力待ちで停止させない。
    child.stderr.on('data', () => {});
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0) return finish(null);
      try {
        const result = NativeResultSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        finish(result.success && result.data.width * result.data.height <= limits.pixels ? result.data : null);
      } catch {
        finish(null);
      }
    });
  });
}

async function superviseProcess(pid: number): Promise<ChildProcessWithoutNullStreams> {
  if (process.platform !== 'win32') throw new Error('Image process supervision unavailable');
  const supervisor = spawn(nativeExecutable(), ['--supervise', String(pid), String(1024 * 1024 * 1024)], { windowsHide: true, stdio: 'pipe' });
  supervisor.stdin.on('error', () => {});
  supervisor.stderr.on('data', () => {});
  await new Promise<void>((resolve, reject) => {
    let output = '';
    let ready = false;
    const timer = setTimeout(() => {
      supervisor.kill();
      reject(new Error('Image supervisor unavailable'));
    }, 5_000);
    supervisor.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (!ready && output === 'READY\n') {
        ready = true;
        clearTimeout(timer);
        resolve();
      } else if (output.length > 64) {
        clearTimeout(timer);
        supervisor.kill();
        reject(new Error('Invalid supervisor response'));
      }
    });
    supervisor.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    supervisor.once('close', () => {
      clearTimeout(timer);
      if (!ready) reject(new Error('Image supervisor exited'));
    });
  });
  return supervisor;
}

async function getSharpProcess(): Promise<UtilityProcess> {
  if (sharpIdleTimer) clearTimeout(sharpIdleTimer);
  sharpProcess ??= new Promise<UtilityProcess>((resolve, reject) => {
    const worker = utilityProcess.fork(path.join(directory, 'image-processing-worker.js'), [], { serviceName: 'Hologram image processing', stdio: 'ignore' });
    sharpWorker = worker;
    const timer = setTimeout(() => {
      worker.kill();
      reject(new Error('Image worker unavailable'));
    }, 5_000);
    worker.once('spawn', async () => {
      clearTimeout(timer);
      try {
        const supervisor = await superviseProcess(worker.pid as number);
        sharpSupervisor = supervisor;
        worker.once('exit', () => supervisor.stdin.destroy());
        supervisor.once('close', () => {
          worker.kill();
          if (sharpSupervisor === supervisor) sharpSupervisor = undefined;
        });
        resolve(worker);
      } catch (error) {
        worker.kill();
        reject(error);
      }
    });
    worker.once('exit', () => {
      clearTimeout(timer);
      if (sharpWorker === worker) {
        sharpProcess = undefined;
        sharpWorker = undefined;
      }
      reject(new Error('Image worker exited'));
    });
  });
  return sharpProcess;
}

async function runSharp(inputPath: string, outputPath: string, options: ImageOptions): Promise<PreparedImage | null> {
  const id = randomUUID();
  const request = ImageProcessingRequestSchema.safeParse({ id, inputPath, outputPath, ...options });
  if (!request.success) return null;
  const worker = await getSharpProcess();
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: PreparedImage | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.removeListener('message', message);
      worker.removeListener('exit', exit);
      if (!value) {
        worker.kill();
        if (sharpWorker === worker) sharpProcess = undefined;
      } else
        sharpIdleTimer = setTimeout(() => {
          worker.kill();
          if (sharpWorker === worker) sharpProcess = undefined;
        }, 30_000);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), limits.timeoutSeconds * 1_000);
    const exit = () => finish(null);
    const message = (result: ImageProcessingResult) => {
      if (
        !result ||
        result.id !== id ||
        !result.ok ||
        result.outputPath !== outputPath ||
        !['webp', 'png'].includes(result.format) ||
        !Number.isSafeInteger(result.width) ||
        !Number.isSafeInteger(result.height) ||
        result.width < 1 ||
        result.height < 1 ||
        result.width * result.height > limits.pixels ||
        !Number.isSafeInteger(result.frames) ||
        result.frames < 1 ||
        result.frames > limits.frames ||
        result.bytes < 1 ||
        result.bytes > limits.outputBytes
      )
        return finish(null);
      finish({ path: outputPath, mime: `image/${result.format}`, width: result.width, height: result.height, frames: result.frames, avif: false });
    };
    worker.once('exit', exit);
    worker.on('message', message);
    worker.postMessage(request.data);
  });
}

async function browserFrame(inputPath: string, outputPath: string, metadata: { width: number; height: number; browserWidth?: number; browserHeight?: number }, options: ImageOptions): Promise<boolean> {
  // Chromium を必要とする形式だけを、専用 session の背面 renderer で処理する。
  const win = new BrowserWindow({ show: false, focusable: false, webPreferences: { partition: `image-processing-${randomUUID()}`, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  let supervisor: ChildProcessWithoutNullStreams | undefined;
  const timer = setTimeout(() => {
    if (!win.isDestroyed()) win.destroy();
  }, limits.timeoutSeconds * 1_000);
  try {
    const bootstrap = path.join(await getCacheDirectory(), 'decoder.html');
    await fs.writeFile(bootstrap, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src file:; connect-src file:"><body>', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await win.loadURL(pathToFileURL(bootstrap).href);
    supervisor = await superviseProcess(win.webContents.getOSProcessId());
    supervisor.once('close', () => {
      if (!win.isDestroyed()) win.destroy();
    });
    const data = await win.webContents.executeJavaScript(
      `(async () => {
      const source = ${JSON.stringify(pathToFileURL(inputPath).href)};
      let image, decoder;
      const avif = ${path.extname(inputPath) === '.avif'};
      if (avif) {
        const response = await fetch(source);
        decoder = new ImageDecoder({data:response.body, type:'image/avif'});
        image = (await decoder.decode({frameIndex:0})).image;
      } else {
        image = new Image(); image.src = source; await image.decode();
      }
      try {
      const sourceWidth = avif ? image.displayWidth : image.naturalWidth;
      const sourceHeight = avif ? image.displayHeight : image.naturalHeight;
      const standardSize = sourceWidth === ${metadata.width} && sourceHeight === ${metadata.height};
      const browserSize = sourceWidth === ${metadata.browserWidth ?? metadata.width} && sourceHeight === ${metadata.browserHeight ?? metadata.height};
      if ((!standardSize && !browserSize) || sourceWidth * sourceHeight > ${limits.pixels}) return null;
      const rotation = ${options.rotation ?? 0};
      const swapped = rotation === 90 || rotation === 270;
      const width = swapped ? sourceHeight : sourceWidth;
      const height = swapped ? sourceWidth : sourceHeight;
      const targetEdge = ${options.kind === 'thumbnail' ? 'Math.min(width, height)' : 'width'};
      const factor = Math.min(1, ${options.width ?? 16_384} / targetEdge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * factor));
      canvas.height = Math.max(1, Math.round(height * factor));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.translate(canvas.width / 2, canvas.height / 2);
      context.scale(${options.flipped ? -1 : 1} * factor, factor);
      context.rotate(rotation * Math.PI / 180);
      context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);
      return canvas.toDataURL('image/png');
      } finally { if (avif) { image.close(); decoder.close(); } }
    })()`,
      false,
    );
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > Math.ceil((limits.outputBytes * 4) / 3) + 100) return false;
    const bytes = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
    if (!bytes.length || bytes.length > limits.outputBytes) return false;
    await fs.writeFile(outputPath, bytes, { flag: 'wx' });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
    supervisor?.stdin.destroy();
  }
}

async function remember(key: string, result: PreparedImage): Promise<void> {
  const stat = await fs.stat(result.path);
  cache.set(key, result);
  cacheFiles.set(result.path, stat.size);
  let bytes = [...cacheFiles.values()].reduce((sum, n) => sum + n, 0);
  while (cache.size > CACHE_FILES || bytes > CACHE_BYTES) {
    const oldest = cache.entries().next().value;
    if (!oldest) break;
    cache.delete(oldest[0]);
    const file = oldest[1].path;
    bytes -= cacheFiles.get(file) ?? 0;
    cacheFiles.delete(file);
    await fs.unlink(file).catch(() => {});
  }
}

async function prepare(bytes: Buffer, options: ImageOptions): Promise<PreparedImage | null> {
  if (!bytes.length || bytes.length > limits.inputBytes) return null;
  if (!ImageProcessingRequestSchema.safeParse({ id: 'validate', inputPath: 'input', outputPath: 'output', ...options }).success) return null;
  const digest = createHash('sha256').update(bytes).digest('hex');
  const key = `${digest}:${options.kind}:${options.width ?? ''}:${options.rotation ?? 0}:${options.flipped ? 1 : 0}`;
  const rejectedUntil = rejected.get(key);
  if (rejectedUntil && rejectedUntil > Date.now()) return null;
  rejected.delete(key);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  const root = await getCacheDirectory();
  const avif = bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis', 'mif1', 'msf1'].includes(bytes.subarray(8, 12).toString('ascii'));
  const bmp = bytes[0] === 0x42 && bytes[1] === 0x4d;
  const inputPath = path.join(root, `${randomUUID()}.${avif ? 'avif' : bmp ? 'bmp' : 'input'}`);
  const outputPath = path.join(root, `${randomUUID()}.${options.kind === 'copy' ? 'png' : 'webp'}`);
  await fs.writeFile(inputPath, bytes, { flag: 'wx' });
  let retainedInput = false;
  let completed = false;
  try {
    let result: PreparedImage | null;
    if (avif) {
      const metadata = await validateAvif(inputPath);
      if (!metadata) return null;
      if (options.kind === 'preview') {
        // 色とアニメーションを保つ。ユーザー編集は表示側で適用する。
        result = { path: inputPath, mime: 'image/avif', width: metadata.browserWidth ?? metadata.width, height: metadata.browserHeight ?? metadata.height, frames: metadata.frames, avif: true };
        retainedInput = true;
      } else {
        const pngPath = path.join(root, `${randomUUID()}.png`);
        try {
          if (!(await browserFrame(inputPath, pngPath, metadata, options))) return null;
          // Chromium が作った PNG も隔離 worker で共通の出力契約へ揃える。
          result = await runSharp(pngPath, outputPath, { kind: options.kind, ...(options.width ? { width: options.width } : {}) });
        } finally {
          await fs.unlink(pngPath).catch(() => {});
        }
      }
    } else if (bmp) {
      const dimensions = imageSize(bytes);
      if (dimensions.type !== 'bmp' || !dimensions.width || !dimensions.height || dimensions.width * dimensions.height > limits.pixels) return null;
      const pngPath = path.join(root, `${randomUUID()}.png`);
      try {
        if (!(await browserFrame(inputPath, pngPath, dimensions, options))) return null;
        result = await runSharp(pngPath, outputPath, { kind: options.kind, ...(options.width ? { width: options.width } : {}) });
      } finally {
        await fs.unlink(pngPath).catch(() => {});
      }
    } else result = await runSharp(inputPath, outputPath, options);
    if (!result) return null;
    await remember(key, result);
    completed = true;
    return result;
  } finally {
    if (!completed) {
      rejected.set(key, Date.now() + 60_000);
      if (rejected.size > CACHE_FILES) rejected.delete(rejected.keys().next().value as string);
    }
    if (!retainedInput || !completed) await fs.unlink(inputPath).catch(() => {});
    if (!cacheFiles.has(outputPath)) await fs.unlink(outputPath).catch(() => {});
  }
}

export async function getPreparedImage(filePath: string, options: ImageOptions): Promise<PreparedImage | null> {
  const key = `${filePath}:${JSON.stringify(options)}`;
  const current = pending.get(key);
  if (current) return current;
  if (pool.stats().queued >= 64) return null;
  const promise = pool
    .run(async () => {
      const bytes = await readInput(filePath);
      return bytes ? prepare(bytes, options) : null;
    })
    .catch(() => null);
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    pending.delete(key);
  }
}

export async function prepareImageBytes(bytes: Buffer, options: ImageOptions): Promise<PreparedImage | null> {
  if (bytes.length > limits.inputBytes || pool.stats().queued >= 64 || queuedInputBytes + bytes.length > limits.outputBytes) return null;
  const snapshot = Buffer.from(bytes);
  queuedInputBytes += snapshot.length;
  try {
    return await pool.run(() => prepare(snapshot, options)).catch(() => null);
  } finally {
    queuedInputBytes -= snapshot.length;
  }
}
