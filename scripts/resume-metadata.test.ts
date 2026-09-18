import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
const { retryAt, apiSucceeded } = createRequire(import.meta.url)('./resume-metadata.cts');

describe('補完APIの成功判定と再開時刻', () => {
  test('URLから導いた日時やハンドルだけでは成功にしない', () => {
    expect(apiSucceeded({ date: '2026-01-01', screenName: 'a' })).toBeFalsy();
    expect(apiSucceeded({ metaError: 'ageRestricted', date: '2026-01-01' })).toBeFalsy();
    expect(apiSucceeded(null)).toBeFalsy();
    expect(apiSucceeded({ text: '', likes: 0 })).toBeTruthy();
    expect(apiSucceeded({ media: [{ url: 'https://example.com/a.jpg' }] })).toBeTruthy();
  });
  test('Retry-Afterの秒数とHTTP日付を尊重し、未指定なら冷却期間を延ばす', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAt('120', 1, now)).toBe(now + 120000);
    expect(retryAt('Thu, 01 Jan 2026 00:05:00 GMT', 1, now)).toBe(now + 300000);
    expect(retryAt(null, 1, now)).toBe(now + 60000);
    expect(retryAt(null, 3, now)).toBe(now + 240000);
    expect(retryAt(null, 10, now)).toBe(now + 3600000);
  });
});
