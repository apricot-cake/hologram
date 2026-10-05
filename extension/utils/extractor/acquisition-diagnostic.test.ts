import { expect, test, vi } from 'vitest';
import { z } from 'zod';
import { acquisitionFailureReason, createAcquisitionDiagnostic, diagnosticFailureReason } from './acquisition-diagnostic.ts';

test('検証エラーの値・メッセージ・動的キーを診断に含めない', () => {
  const schema = z.object({
    social: z.record(z.string(), z.object({ url: z.string().refine(() => false, 'private-message https://private.example/token') })),
    mediaDetails: z.array(z.object({ media_url_https: z.string() })),
  });
  const result = schema.safeParse({ social: { 'private-account': { url: 'https://private.example/secret' } }, mediaDetails: [{ media_url_https: { token: 'private-token' } }] });
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected validation failure');
  const log = vi.fn();
  createAcquisitionDiagnostic({ platform: 'pixiv' }, log)('ajax-user-full', 200, 'contract', result.error);
  expect(log).toHaveBeenCalledWith({ stage: 'metadata', phase: 'fail', platform: 'pixiv', category: 'pixiv-profile', operation: 'ajax-user-full', code: 200, reason: 'contract', error: 'social.*.url,mediaDetails.*.media_url_https' });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|https:|token/);
});

test('一回の診断に含める検証項目は最初の12件までに制限する', () => {
  const fields = ['text', 'id_str', 'name', 'screen_name', 'created_at', 'lang', 'possibly_sensitive', 'favorite_count', 'conversation_count', 'description', 'followers_count', 'friends_count', 'profile_image_url_https'];
  const schema = z.object(Object.fromEntries(fields.map((field) => [field, z.string()])));
  const result = schema.safeParse(Object.fromEntries(fields.map((field) => [field, 123])));
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected validation failure');
  const log = vi.fn();
  createAcquisitionDiagnostic({ platform: 'x' }, log)('x-post', 200, 'contract', result.error);
  const entry = log.mock.calls[0]?.[0];
  expect(entry.error.split(',')).toEqual(fields.slice(0, 12));
  expect(entry.error).not.toContain('profile_image_url_https');
});

test('同じ検証項目の反復と配列添字を重複した診断にしない', () => {
  const result = z.object({ mediaDetails: z.array(z.object({ media_url_https: z.string() })) }).safeParse({ mediaDetails: [{ media_url_https: 1 }, { media_url_https: 2 }] });
  if (result.success) throw new Error('Expected validation failure');
  const log = vi.fn();
  createAcquisitionDiagnostic({ platform: 'x' }, log)('x-media', 200, 'contract', result.error);
  expect(log.mock.calls[0]?.[0].error).toBe('mediaDetails.*.media_url_https');
});

test('応答全体の不一致は値を含まない root の位置として記録する', () => {
  const result = z.object({ text: z.string() }).safeParse('private-response');
  if (result.success) throw new Error('Expected validation failure');
  const log = vi.fn();
  createAcquisitionDiagnostic({ platform: 'x' }, log)('x-post', 200, 'contract', result.error);
  expect(log.mock.calls[0]?.[0].error).toBe('(root)');
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-response');
});

test.each([new SyntaxError('private-json-response'), new Error('private-transport https://private.example')])('JSON・通信エラーのメッセージを転送しない', (error) => {
  const log = vi.fn();
  createAcquisitionDiagnostic({ platform: 'bluesky' }, log)('bsky-post', null, diagnosticFailureReason(error), error);
  expect(log.mock.calls[0]?.[0].error).toBeUndefined();
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|https:/);
});

test('診断 callback の例外を取得処理へ返さない', () => {
  const log = vi.fn(() => {
    throw new Error('logger unavailable');
  });
  expect(() => createAcquisitionDiagnostic({ platform: 'x' }, log)('x-post', 200)).not.toThrow();
  expect(log).toHaveBeenCalledOnce();
});

test('診断 callback がない場合も同じ取得処理を使える', () => {
  expect(() => createAcquisitionDiagnostic({ platform: 'pixiv' })('ajax-user-full', 200)).not.toThrow();
});

test('取得失敗と診断の分類を対応させる', () => {
  const result = z.string().safeParse(123);
  if (result.success) throw new Error('Expected validation failure');
  expect(acquisitionFailureReason(result.error)).toBe('invalidResponse');
  expect(diagnosticFailureReason(result.error)).toBe('contract');
  expect(acquisitionFailureReason(new SyntaxError())).toBe('invalidResponse');
  expect(diagnosticFailureReason(new SyntaxError())).toBe('json');
  expect(acquisitionFailureReason(new Error())).toBe('fetchFailed');
  expect(diagnosticFailureReason(new Error())).toBe('transport');
});
