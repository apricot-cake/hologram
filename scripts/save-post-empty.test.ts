// 一括取込の保存（handleSavePost）が「何も取れなかった投稿」を断ること（#492）。
//
// 経緯: 削除・凍結・鍵付き・年齢制限の投稿は、プラットフォームの API が投稿情報を一切
// 返さない。それでもレコードを書いていたため、URL から分かること（platform / screenName /
// id から復号した日時）だけを持つ空の殻がライブラリに残り、しかも noteSaved がバッジを
// 点けた＝次回以降の取込がその投稿を飛ばす＝取り直す機会が永久に失われていた。
// 断れば失うのは1回の再試行だけで、成功として書けば投稿そのものを失う。
//
// 見るもの: 空の保存が throw し、エンベロープもジャーナルも残さないこと。テキストのみの
// 投稿（#365）とメディアのある投稿はこれまでどおり保存されること＝ゲートが締まりすぎて
// いないこと。規則そのもの（recordHoldsContent）の網羅は post-record.test.ts。

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

// 実際に踏んだ形（2026-07-26・x-bookmarks の一括取込）: 抽出器は URL から screenName を、
// 投稿 id から日時を復元できるので、API が何も返さなくてもこの2つだけは埋まる。
// 「screenName があるから成功」と読んではならない、が守るべき性質。
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
