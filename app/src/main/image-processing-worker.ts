import { createWriteStream } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { IMAGE_PROCESSING_LIMITS as limits, ImageProcessingRequestSchema, type ImageProcessingErrorCode, type ImageProcessingRequest, type ImageProcessingResult } from './image-processing-contract';

sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 16 });

class ProcessingError extends Error {
  constructor(readonly code: ImageProcessingErrorCode) {
    super(code);
  }
}

async function readBoundedInput(inputPath: string): Promise<Buffer> {
  const file = await open(inputPath, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > limits.inputBytes) {
      throw new ProcessingError('input-limit');
    }
    // 同じハンドルから読み、読み出し中にサイズが増えた場合も上限を超えない。
    const bytes = Buffer.allocUnsafe(limits.inputBytes + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await file.read(bytes, count, bytes.length - count, count);
      if (!result.bytesRead) break;
      count += result.bytesRead;
    }
    if (count > limits.inputBytes) throw new ProcessingError('input-limit');
    return bytes.subarray(0, count);
  } finally {
    await file.close();
  }
}

function supportedSignature(input: Buffer): boolean {
  const prefix = input
    .subarray(0, 4_096)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart();
  // 形式の候補だけを判定し、XML の解釈は librsvg に任せる。
  const svg = /^(?:<svg(?:\s|>)|<\?xml\s|<!DOCTYPE\s+svg\s|<!--)/.test(prefix) && /<svg(?:\s|>)/.test(prefix);
  return (
    svg ||
    (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) ||
    input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    ['GIF87a', 'GIF89a'].includes(input.subarray(0, 6).toString('ascii')) ||
    (input.subarray(0, 4).toString('ascii') === 'RIFF' && input.subarray(8, 12).toString('ascii') === 'WEBP') ||
    input.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) ||
    input.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))
  );
}

export function validateImageMetadata(metadata: Pick<Metadata, 'format' | 'width' | 'height' | 'pageHeight' | 'pages'>): {
  width: number;
  height: number;
  frames: number;
} {
  if (!['jpeg', 'png', 'webp', 'gif', 'tiff', 'svg'].includes(metadata.format ?? '')) {
    throw new ProcessingError('unsupported-format');
  }
  const width = metadata.width ?? 0;
  const height = metadata.pageHeight ?? metadata.height ?? 0;
  const frames = metadata.pages ?? 1;
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > limits.frames) {
    throw new ProcessingError('frame-limit');
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > limits.pixels || width * height * frames > limits.totalPixels) {
    throw new ProcessingError('pixel-limit');
  }
  // 連結するアニメーションのページ寸法を揃えられない形式は静止画像だけ扱う。
  if (frames > 1 && metadata.format !== 'gif' && metadata.format !== 'webp') {
    throw new ProcessingError('unsupported-format');
  }
  return { width, height, frames };
}

function source(input: Buffer, page: number): Sharp {
  return sharp(input, {
    failOn: 'warning',
    unlimited: false,
    limitInputPixels: limits.pixels,
    pages: 1,
    page,
    autoOrient: true,
  }).timeout({ seconds: limits.timeoutSeconds });
}

function transform(image: Sharp, request: ImageProcessingRequest, metadata: Metadata): Sharp {
  // 表示の左右反転は回転後の座標で行う。sharp の flip は回転前に実行される。
  if (request.flipped) {
    if (request.rotation === 90 || request.rotation === 270) image.flip();
    else image.flop();
  }
  if (request.rotation) image.rotate(request.rotation);
  if (request.kind === 'thumbnail') {
    const size = Math.min(request.width ?? 16_383, 16_383);
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.pageHeight ?? metadata.height ?? 0;
    const shortEdge = Math.min(sourceWidth, sourceHeight);
    const longEdge = Math.max(sourceWidth, sourceHeight);
    if (Math.ceil(longEdge * Math.min(1, size / shortEdge)) > 16_383) {
      // 極端な縦横比では短辺基準より codec の長辺上限を優先する。
      image.resize({ width: 16_383, height: 16_383, fit: 'inside', withoutEnlargement: true });
    } else {
      image.resize({ width: size, height: size, fit: 'outside', withoutEnlargement: true });
    }
  } else if (request.kind === 'preview') {
    image.resize({ width: Math.min(request.width ?? 16_383, 16_383), height: 16_383, fit: 'inside', withoutEnlargement: true });
  } else if (request.width) {
    image.resize({ width: request.width, height: request.width, fit: 'inside', withoutEnlargement: true });
  }
  return image.toColourspace('srgb').ensureAlpha();
}

async function writeBoundedOutput(image: Sharp, outputPath: string): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limits.outputBytes ? new ProcessingError('output-limit') : null, chunk);
    },
  });
  const output = createWriteStream(outputPath, { flags: 'wx' });
  let created = false;
  output.on('open', () => {
    created = true;
  });
  try {
    await pipeline(image, limiter, output);
    return bytes;
  } catch (error) {
    // 既存のキャッシュは上書きせず、この処理で作った不完全な出力だけ削除する。
    if (created) await unlink(outputPath).catch(() => {});
    throw error;
  }
}

export async function processImageRequest(value: unknown): Promise<ImageProcessingResult> {
  const parsed = ImageProcessingRequestSchema.safeParse(value);
  if (!parsed.success) return { id: '', ok: false, code: 'invalid-request' };
  const request = parsed.data;
  try {
    const input = await readBoundedInput(request.inputPath);
    if (!supportedSignature(input)) throw new ProcessingError('unsupported-format');
    const metadata = await source(input, 0).metadata();
    const dimensions = validateImageMetadata(metadata);
    const frames = request.kind === 'copy' ? 1 : dimensions.frames;
    const delay = frames > 1 ? (metadata.delay ?? []) : [];
    if (frames > 1 && (delay.length !== frames || delay.some((ms) => !Number.isInteger(ms) || ms < 0 || ms > 0xffffff))) {
      throw new ProcessingError('processing-failed');
    }
    const loop = metadata.loop ?? 0;
    if (!Number.isInteger(loop) || loop < 0 || loop > 65_535) {
      throw new ProcessingError('processing-failed');
    }
    let image: Sharp;
    let width = 0;
    let height = 0;
    if (frames > 1) {
      const pages: Buffer[] = [];
      let rawBytes = 0;
      let encodedBytes = 0;
      for (let page = 0; page < frames; page++) {
        const result = await transform(source(input, page), request, metadata).png().toBuffer({ resolveWithObject: true });
        width = result.info.width;
        height = result.info.height;
        rawBytes += width * height * 4;
        encodedBytes += result.data.length;
        if (rawBytes > limits.rawOutputBytes || encodedBytes > limits.outputBytes) {
          throw new ProcessingError('output-limit');
        }
        pages.push(result.data);
      }
      const overlay = await sharp(pages, {
        join: { animated: true },
        limitInputPixels: limits.totalPixels,
        unlimited: false,
      })
        .timeout({ seconds: limits.timeoutSeconds })
        .png()
        .toBuffer();
      if (overlay.length > limits.outputBytes) throw new ProcessingError('output-limit');
      // 元のアニメーションを土台に使い、変換済みの全画素で置き換える。
      // delay オプションを再指定せず、WebP の 24bit duration をそのまま保つ。
      image = sharp(input, {
        animated: true,
        failOn: 'warning',
        unlimited: false,
        limitInputPixels: limits.totalPixels,
      })
        .resize({ width, height, fit: 'fill' })
        .toColourspace('srgb')
        .ensureAlpha()
        .composite([{ input: overlay, blend: 'source', top: 0, left: 0 }])
        .timeout({ seconds: limits.timeoutSeconds });
    } else {
      // 静止画像も寸法を実際の変換結果から返す。出力の復号は親プロセスで行わない。
      const result = await transform(source(input, 0), request, metadata).raw().toBuffer({ resolveWithObject: true });
      width = result.info.width;
      height = result.info.height;
      if (result.data.length > limits.rawOutputBytes) throw new ProcessingError('output-limit');
      image = sharp(result.data, { raw: { width, height, channels: 4 } }).timeout({
        seconds: limits.timeoutSeconds,
      });
    }
    const format = request.kind === 'copy' ? 'png' : 'webp';
    if (format === 'png') image.png();
    else image.webp({ lossless: true, effort: 1, exact: true });
    const bytes = await writeBoundedOutput(image, request.outputPath);
    return { id: request.id, ok: true, outputPath: request.outputPath, format, width, height, frames, bytes, delay, loop };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      code: error instanceof ProcessingError ? error.code : 'processing-failed',
    };
  }
}

type ParentPort = {
  on(event: 'message', callback: (event: { data: unknown }) => void): void;
  postMessage(value: ImageProcessingResult): void;
};

// Electron utilityProcess と Node fork の両方で同じ処理本体を使う。
const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;
if (parentPort || process.send) {
  let busy = false;
  const send = (value: ImageProcessingResult) => {
    if (parentPort) parentPort.postMessage(value);
    else process.send?.(value);
  };
  const receive = async (value: unknown) => {
    if (busy) {
      const parsed = ImageProcessingRequestSchema.safeParse(value);
      send({ id: parsed.success ? parsed.data.id : '', ok: false, code: 'busy' });
      return;
    }
    busy = true;
    try {
      send(await processImageRequest(value));
    } finally {
      busy = false;
    }
  };
  if (parentPort) parentPort.on('message', (event) => void receive(event.data));
  else process.on('message', (value) => void receive(value));
}
