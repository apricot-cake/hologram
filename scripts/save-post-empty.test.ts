// Bulk-intake save (handleSavePost) refuses "a post that yielded nothing" (#492).
//
// Background: for a deleted, suspended, protected, or age-restricted post, the
// platform's API returns no post information at all. Even so, a record used to be
// written, leaving an empty shell in the library holding only what can be inferred from
// the URL (platform / screenName / the timestamp decoded from the id), and worse,
// noteSaved lit up the badge = every intake after that skipped the post = the chance to
// retry it was lost forever. Refusing to save only costs one retry; writing it as a
// success loses the post itself.
//
// What's checked: an empty save throws and leaves neither an envelope nor a journal
// entry. Text-only posts (#365) and posts with media still get saved as before = the
// gate isn't closed too tight. Full coverage of the rule itself (recordHoldsContent) is
// in post-record.test.ts.

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

let handleSavePost: any;
let configDir: string;
let saveFolder: string;

const inboxNew = () => path.join(saveFolder, '.hologram-inbox', 'new');
const envelopeExists = (base: string) => fs.existsSync(path.join(inboxNew(), `${base}.json`));
const journal = () => {
  try {
    return fs.readFileSync(path.join(configDir, 'bridge-journal.jsonl'), 'utf8');
  } catch {
    return '';
  }
};

beforeAll(async () => {
  configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  ({ handleSavePost } = await import('../native-host/bridge.cts'));
});

// The actual shape hit in practice (2026-07-26, bulk intake from x-bookmarks): the
// extractor can recover screenName from the URL and the timestamp from the post id, so
// even when the API returns nothing, only these two get filled in. The property being
// guarded is that this must NOT be read as "it succeeded because screenName is present".
const emptyMeta = {
  url: 'https://x.com/super_moje/status/2069378728497746227',
  platform: 'x',
  screenName: 'super_moje',
  date: '2026-06-23T11:15:10.728Z',
  text: null,
  displayName: null,
  mediaType: null,
  media: [],
};

describe('何も取れなかった投稿', () => {
  test('保存を断る（理由つき）', async () => {
    await expect(handleSavePost({ captureId: '1717500000000-e001', metadata: emptyMeta, metaOk: false, metaReason: 'unavailable' })).rejects.toThrow(/^Post unavailable.*unavailable/);
  });

  test('エンベロープを残さない＝ライブラリに殻レコードを作らない', () => {
    expect(envelopeExists('1717500000000-e001')).toBe(false);
  });

  test('バッジのジャーナルにも載らない＝次の取込がもう一度出会える', () => {
    expect(journal()).not.toContain('2069378728497746227');
  });

  test('metaOk を送らない古い拡張からでも同じ判定（レコードの中身だけで決める）', async () => {
    await expect(handleSavePost({ captureId: '1717500000000-e002', metadata: emptyMeta })).rejects.toThrow(/^Post unavailable/);
    expect(envelopeExists('1717500000000-e002')).toBe(false);
  });

  // #505: this post's actual reason is age restriction (not deletion). What ends up in
  // capture.log is this sentence, so having the reason carried through verbatim is the
  // only clue for diagnosing it later.
  test('理由は断り文にそのまま乗る（capture.log から読めるのはこれだけ）', async () => {
    await expect(handleSavePost({ captureId: '1717500000000-e003', metadata: emptyMeta, metaOk: false, metaReason: 'ageRestricted' })).rejects.toThrow(/^Post unavailable.*ageRestricted/);
    expect(envelopeExists('1717500000000-e003')).toBe(false);
  });
});

describe('中身のある投稿は通す', () => {
  test('テキストのみの投稿は保存される（#365・表示は準備中なので deferred）', async () => {
    const res = await handleSavePost({
      captureId: '1717500000000-e010',
      metadata: { url: 'https://x.com/u/status/10', platform: 'x', screenName: 'u', text: '本文だけの投稿', media: [] },
      metaOk: true,
    });

    expect(res).toMatchObject({ ok: true, mediaCount: 0, deferred: true });
    expect(envelopeExists('1717500000000-e010')).toBe(true);
  });

  test('メディアのある投稿は保存される', async () => {
    vi.stubGlobal('fetch', async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
    try {
      const res = await handleSavePost({
        captureId: '1717500000000-e011',
        metadata: { url: 'https://x.com/u/status/11', platform: 'x', screenName: 'u', text: null, mediaType: 'image', media: [{ url: 'https://pbs.twimg.com/media/AAA.png' }] },
        metaOk: true,
      });

      expect(res).toMatchObject({ ok: true, mediaCount: 1, deferred: false });
      expect(envelopeExists('1717500000000-e011')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
