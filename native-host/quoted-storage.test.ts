import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
const download = vi.hoisted(() => vi.fn());
vi.mock('./media-download.mts', () => ({ MAX_MEDIA: 200, createByteBudget: () => ({}), downloadOneMedia: download }));
import { downloadQuotedPost } from './quoted-storage.mts';

test('引用画像を共有して再利用し、取得失敗時も本文を残す', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quote-download-'));
  try {
    download.mockImplementation(async (entry, target, stem) => {
      fs.writeFileSync(path.join(target, `${stem}-media-0.jpg`), 'image');
      return { url: entry.url, file: `${stem}-media-0.jpg`, type: 'image' };
    });
    const input = { url: 'https://x.com/a/status/123', text: '引用', media: [{ url: 'https://pbs.twimg.com/media/a.jpg' }] };
    const first = await downloadQuotedPost(input, dir, {} as any);
    const second = await downloadQuotedPost(input, dir, {} as any);
    expect(first?.media[0].file).toMatch(/^quoted-media\/quote-.*\.jpg$/);
    expect(second?.media[0].file).toBe(first?.media[0].file);
    expect(download).toHaveBeenCalledTimes(1);
    download.mockRejectedValue(new Error('offline'));
    const failed = await downloadQuotedPost({ ...input, media: [{ url: 'https://pbs.twimg.com/media/b.jpg' }] }, dir, {} as any);
    expect(failed?.text).toBe('引用');
    expect(failed?.media[0].file).toBe('');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
