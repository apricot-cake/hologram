import { z } from 'zod';
import path from 'node:path';
const id = z.string().uuid();
const file = z
  .string()
  .min(1)
  .max(32768)
  .refine((value) => !value.includes('\0') && path.isAbsolute(value));
export const ArchiveImportRequest = z.discriminatedUnion('phase', [z.object({ id, phase: z.literal('prepare'), zipPath: file, stage: file, executable: file }), z.object({ id, phase: z.literal('apply'), destination: file }), z.object({ id, phase: z.literal('cleanup'), stage: file, destination: file })]);
export const ArchiveImportReply = z.object({ id, phase: z.enum(['prepared', 'done', 'progress', 'error']), ok: z.boolean(), imported: z.number().int().min(0).max(200000).optional(), skipped: z.number().int().min(0).max(200000).optional(), notComplete: z.boolean().optional(), error: z.string().max(256).optional() });
export const ARCHIVE_IMPORT_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const ARCHIVE_IMPORT_IDLE_MS = 120000;
