import { describe, expect, test } from 'vitest';
import { acquisitionComplete } from './acquisition-result.ts';
import { emptyRecord } from './extractor/record.ts';

describe('取得完了の判定', () => {
  test('正常な空欄は失敗ではない', () => {
    expect(acquisitionComplete(emptyRecord('https://example.com', 'web'), [])).toBe(true);
  });
  test.each(['post', 'profile', 'media'] as const)('%s の取得失敗を成功にしない', (scope) => {
    const record = emptyRecord('https://example.com', 'x');
    record.text = '保存できた本文';
    record.acquisitionIssues.push({ scope, reason: 'fetchFailed' });
    expect(acquisitionComplete(record, [])).toBe(false);
  });
  test.each(['protected', 'ageRestricted'])('明示された制限 %s は DOM で取得できた場合のみ完了', (reason) => {
    const record = emptyRecord('https://example.com', 'x');
    record.metaError = reason;
    expect(acquisitionComplete(record, [])).toBe(false);
    expect(acquisitionComplete(record, ['text', 'displayName'])).toBe(true);
  });
  test('未知の失敗は DOM の値があっても完了にしない', () => {
    const record = emptyRecord('https://example.com', 'x');
    record.metaError = 'unavailable';
    expect(acquisitionComplete(record, ['text', 'displayName'])).toBe(false);
  });
});
