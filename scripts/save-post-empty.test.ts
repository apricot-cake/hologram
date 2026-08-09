// 一括取込の保存（handleSavePost）は「何も取れなかった投稿」を断る（#492）。
//
// 背景。削除された投稿・凍結アカウント・鍵付きアカウント・年齢制限付きの投稿では、
// プラットフォームの API が投稿の情報を何も返さない。それでも以前はレコードを書いていて、
// URL から推測できるもの（platform / screenName / id から復号したタイムスタンプ）しか
// 持たない空の殻がライブラリに残った。さらに悪いことに noteSaved がバッジを点け、以後の
// 取込はその投稿を飛ばす＝やり直す機会が永久に失われた。保存を断って失うのはやり直し
// 1回分だけだが、成功として書けば投稿そのものを失う。
//
// ここで見るもの。空の保存は例外を投げ、エンベロープもジャーナルのエントリも残さない。
// テキストだけの投稿（#365）とメディアのある投稿は今までどおり保存される＝ゲートを締めすぎて
// いない。規則そのもの（recordHoldsContent）の網羅は post-record.test.ts にある。

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

  ({ handleSavePost } = await import('../native-host/bridge.mts'));
});

// 実際に踏んだ形（2026-07-26、x-bookmarks からの一括取込）。extractor は URL から
// screenName を、投稿 id からタイムスタンプを復元できる。だから API が何も返さなくても、
// この2つだけは埋まる。ここで守っているのは、これを「screenName があるから成功」と
// 読んではいけないという性質。
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

  // #505: この投稿の実際の理由は年齢制限であって削除ではない。capture.log に残るのはこの
  // 文だけなので、理由がそのまま乗っていることが後から診断する唯一の手掛かりになる。
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
