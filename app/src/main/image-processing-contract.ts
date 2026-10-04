import { z } from 'zod';

export const IMAGE_PROCESSING_LIMITS = Object.freeze({
  inputBytes: 25 * 1024 * 1024,
  pixels: 40_000_000,
  frames: 1_000,
  totalPixels: 400_000_000,
  rawOutputBytes: 256 * 1024 * 1024,
  outputBytes: 64 * 1024 * 1024,
  timeoutSeconds: 30,
});

export const ImageProcessingRequestSchema = z.strictObject({
  id: z.string().min(1).max(128),
  inputPath: z.string().min(1).max(32_768),
  outputPath: z.string().min(1).max(32_768),
  kind: z.enum(['thumbnail', 'preview', 'copy']),
  width: z.number().int().min(1).max(16_384).optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  flipped: z.boolean().optional(),
});

export type ImageProcessingRequest = z.infer<typeof ImageProcessingRequestSchema>;
export type ImageProcessingErrorCode = 'invalid-request' | 'unsupported-format' | 'input-limit' | 'pixel-limit' | 'frame-limit' | 'output-limit' | 'processing-failed' | 'busy';
export type ImageProcessingResult =
  | {
      id: string;
      ok: true;
      outputPath: string;
      format: 'webp' | 'png';
      width: number;
      height: number;
      frames: number;
      bytes: number;
      delay: number[];
      loop: number;
    }
  | { id: string; ok: false; code: ImageProcessingErrorCode };
