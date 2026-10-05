import path from 'node:path';
import { expect, test } from 'vitest';
import { ArchiveImportRequest, ArchiveImportReply } from './archive-import-contract';

const id = '11111111-1111-4111-8111-111111111111';
test('worker の要求は job ID と絶対 path に限定する', () => {
  const base = { id, phase: 'prepare', zipPath: path.resolve('fixture.zip'), stage: path.resolve('stage'), executable: path.resolve('publisher') };
  expect(ArchiveImportRequest.safeParse(base).success).toBe(true);
  for (const zipPath of ['relative.zip', `bad\0path`, 'x'.repeat(32769)]) expect(ArchiveImportRequest.safeParse({ ...base, zipPath }).success).toBe(false);
  expect(ArchiveImportRequest.safeParse({ ...base, id: 'other' }).success).toBe(false);
});
test('worker の結果は件数と短い診断だけを許可する', () => {
  expect(ArchiveImportReply.safeParse({ id, phase: 'done', ok: true, imported: 200000, skipped: 0 }).success).toBe(true);
  expect(ArchiveImportReply.safeParse({ id, phase: 'done', ok: true, imported: 200001 }).success).toBe(false);
  expect(ArchiveImportReply.safeParse({ id, phase: 'error', ok: false, error: 'x'.repeat(257) }).success).toBe(false);
  const value = ArchiveImportReply.parse({ id, phase: 'done', ok: true, records: Array(1000).fill({ text: 'large' }) });
  expect('records' in value).toBe(false);
});
