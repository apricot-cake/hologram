import { afterEach, expect, test, vi } from 'vitest';
import { apiFixture } from '../../../tests/helpers/test-api-fixtures.ts';
import { boundedDiagnostic } from '../diagnostic-admission.ts';
import { fetchPostMetadata } from './index.ts';

afterEach(() => vi.unstubAllGlobals());

function mockProfile(profileResponse: () => Response | Promise<Response>) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('/ajax/user/')) return profileResponse();
    return Response.json(apiFixture('/illust/', { error: false, body: { userId: 'private-user-id', userName: 'private-name' } }));
  });
}

async function capture() {
  const entries: unknown[] = [];
  const record = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', { logDiagnostic: (entry: unknown) => entries.push(boundedDiagnostic(entry)) });
  return { record, entries };
}

test('正常なプロフィールの診断は固定の取得先と HTTP status だけを記録する', async () => {
  mockProfile(() => Response.json({ error: false, body: { imageBig: 'https://i.pximg.net/private-avatar.jpg', comment: 'private-bio', social: [] } }));
  const { record, entries } = await capture();
  expect(record.avatar).toBe('https://i.pximg.net/private-avatar.jpg');
  expect(entries).toEqual([{ stage: 'metadata', phase: 'ok', platform: 'pixiv', category: 'pixiv-profile', operation: 'ajax-user-full', code: 200 }]);
  expect(JSON.stringify(entries)).not.toMatch(/private|https:|credentials|12345/);
});

test('契約違反は値を含まない固定の Zod path を記録する', async () => {
  mockProfile(() => Response.json({ error: false, body: { imageBig: { secret: 'private-value' }, social: { 'private-account': { url: 123 } } } }));
  const { record, entries } = await capture();
  expect(record.acquisitionIssues).toContainEqual({ scope: 'profile', reason: 'invalidResponse' });
  expect(entries).toEqual([
    { stage: 'metadata', phase: 'fail', platform: 'pixiv', category: 'pixiv-profile', operation: 'ajax-user-full', code: 200, reason: 'contract', error: 'imageBig' },
    { stage: 'metadata', phase: 'fail', platform: 'pixiv', category: 'pixiv-profile', operation: 'ajax-user-full', code: 200, reason: 'contract', error: 'social' },
  ]);
  expect(JSON.stringify(entries)).not.toMatch(/private|https:|credentials|12345/);
});

test.each([
  ['http', () => new Response('private-http-error', { status: 403 }), 403],
  ['unavailable', () => Response.json({ error: true, message: 'private-message' }), 200],
  ['json', () => new Response('private-malformed-json', { status: 200 }), 200],
  [
    'transport',
    () => {
      throw new Error('private-fetch-error');
    },
    null,
  ],
])('%s の失敗は category と既知の status を記録する', async (reason, response, status) => {
  mockProfile(response);
  const { entries } = await capture();
  expect(entries).toEqual([{ stage: 'metadata', phase: 'fail', platform: 'pixiv', category: 'pixiv-profile', operation: 'ajax-user-full', code: status, reason }]);
  expect(JSON.stringify(entries)).not.toMatch(/private|https:|credentials|12345/);
});

test('診断 callback の失敗で正常なプロフィール取得を失敗にしない', async () => {
  mockProfile(() => Response.json({ error: false, body: { imageBig: 'https://i.pximg.net/avatar.jpg' } }));
  const result = await fetchPostMetadata('https://www.pixiv.net/artworks/12345', {
    logDiagnostic: () => {
      throw new Error('logger failed');
    },
  });
  expect(result.avatar).toBe('https://i.pximg.net/avatar.jpg');
  expect(result.acquisitionIssues).toEqual([]);
});
