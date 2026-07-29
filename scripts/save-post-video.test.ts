// 動画投稿を保存したとき、カードに顔が出て詳細で再生できる形のレコードになること（#496）。
//
// 経緯: 一括取込の保存は以前、ダウンロードした動画を image＝静止画の欄に入れ、media[] を
// 空のまま書いていた。読む側は image を静止画として扱うので <img> に mp4 が渡って詳細が
// 真っ白になり、ポスター画像はディスクにあるのに指す欄が無く孤児として計上されていた。
// 書く側は #377 で直っているが、保存経路の出力とそれを読む側を突き合わせた検査が無かった
// ＝「ファイルは在るのにレコードから辿れない」が孤児メディア警告としてしか表に出なかった。
//
// 見るもの: 本物の handleSavePost が書いたエンベロープを、本物の renderer 側ヘルパ
// （artworkFile＝カードの顔／buildGalleryItems＝詳細の項目）へそのまま渡して確かめる。
// どちらか片方だけのテストでは、この2つの取り決めがずれたことに気付けない。

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as R from '../app/src/renderer/src/services/records';

// 受理されるだけの最小の中身＝JPEG の SOI と、ISO base media の ftyp ボックス。
// content-type とバイトの両方が揃わないと media-download が落とす。
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(12)]);

const VIDEO_URL = 'https://video.twimg.com/amplify_video/1/vid/avc1/1080x1080/AAA.mp4';
const POSTER_URL = 'https://pbs.twimg.com/amplify_video_thumb/1/img/AAA.jpg';
const CAPTURE_ID = '1717500000000-0a01';

let saveFolder: string;
let record: any;

beforeAll(async () => {
  const configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  saveFolder = path.join(configDir, 'saves');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder }));

  const { handleSavePost } = await import('../native-host/bridge.cts');
  vi.stubGlobal('fetch', async (url: string) => (url === VIDEO_URL ? new Response(mp4, { status: 200, headers: { 'content-type': 'video/mp4' } }) : new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })));
  try {
    // 拡張が X の一括取込で渡す形（#362）: 動画は type:'video' と poster を伴って告知される。
    await handleSavePost({
      captureId: CAPTURE_ID,
      metadata: {
        url: 'https://x.com/u/status/1',
        platform: 'x',
        screenName: 'u',
        text: '動画つきの投稿',
        mediaType: 'video',
        media: [{ url: VIDEO_URL, type: 'video', poster: POSTER_URL, width: 1080, height: 1080 }],
        capturedVia: 'x-bookmarks',
      },
      metaOk: true,
    });
  } finally {
    vi.unstubAllGlobals();
  }
  record = JSON.parse(fs.readFileSync(path.join(saveFolder, '.hologram-inbox', 'new', `${CAPTURE_ID}.json`), 'utf8')).record;
});

describe('保存されたレコードの形', () => {
  test('動画本体もポスターもディスクにある', () => {
    expect(fs.existsSync(path.join(saveFolder, `${CAPTURE_ID}-media-0.mp4`))).toBe(true);
    expect(fs.existsSync(path.join(saveFolder, `${CAPTURE_ID}-poster.jpg`))).toBe(true);
  });

  // 静止画の欄に動画名を入れない＝ここが破れると読む側が全部つられる
  test('image は空（動画ファイルを静止画の欄に入れない）', () => {
    expect(record.image).toBeNull();
  });

  test('media[0] が本体・種別・ポスターを持つ', () => {
    expect(record.media).toHaveLength(1);
    expect(record.media[0]).toMatchObject({ file: `${CAPTURE_ID}-media-0.mp4`, type: 'video', posterFile: `${CAPTURE_ID}-poster.jpg`, url: VIDEO_URL });
  });
});

describe('そのレコードを読む側', () => {
  test('カードの顔はポスター（受け入れ条件: カードにポスターが出る）', () => {
    expect(R.artworkFile(record)).toBe(`${CAPTURE_ID}-poster.jpg`);
    expect(R.densityImage(record, 'card')).toBe(`${CAPTURE_ID}-poster.jpg`);
  });

  test('詳細は動画1件＝<video> で開く（受け入れ条件: 詳細で再生できる）', () => {
    const { buildGalleryItems } = R.makeGallery({ fileSrc: (f: string) => `stub://${f}` });
    const items = buildGalleryItems(record);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ src: `stub://${CAPTURE_ID}-media-0.mp4`, video: true });
  });

  // ポスターは media[0] から参照されている＝孤児として計上されない
  test('ディスクのポスターがレコードから辿れる', () => {
    expect(record.media.map((m: any) => m.posterFile)).toContain(`${CAPTURE_ID}-poster.jpg`);
  });
});
