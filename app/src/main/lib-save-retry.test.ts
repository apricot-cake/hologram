import { expect, test } from 'vitest';
import { normalizePostRecord } from '../../../native-host/post-record.mts';
import { mergeSaveRetry } from './lib-save-retry.ts';

test('再試行の画像順を使い、保存済みの画像と編集状態を重複させず保持する', () => {
  const previous = normalizePostRecord({ captureId: 'old', saveIncomplete: true, media: [{ url: 'https://example.com/2.jpg', file: 'old/2.jpg', rotation: 90 }] });
  const incoming = normalizePostRecord({
    captureId: 'new',
    media: [
      { url: 'https://example.com/1.jpg', file: 'new/1.jpg' },
      { url: 'https://example.com/2.jpg', file: 'new/2.jpg' },
    ],
  });
  const merged = mergeSaveRetry(previous, incoming);
  expect(merged.captureId).toBe('old');
  expect(merged.media.map((item) => item.file)).toEqual(['new/1.jpg', 'old/2.jpg']);
  expect(merged.media[1].rotation).toBe(90);
  expect(merged.saveIncomplete).toBe(false);
});

test('再試行で取得できなくなった画像も消さない', () => {
  const previous = normalizePostRecord({ captureId: 'old', saveIncomplete: true, media: [{ url: 'https://example.com/1.jpg', file: 'old/1.jpg' }] });
  const incoming = normalizePostRecord({ captureId: 'new', saveIncomplete: true });
  expect(mergeSaveRetry(previous, incoming).media).toEqual(previous.media);
});
