// When a video post is saved, the record must end up in a shape where the card shows a
// face and the detail view can play it (#496).
//
// Background: bulk-intake save used to put the downloaded video into the image = stills
// field, and wrote media[] empty. The read side treats image as a still, so an mp4 got
// handed to <img> and the detail view went blank, and the poster image existed on disk
// but had no field pointing to it, so it was counted as an orphan.
// The write side was fixed in #377, but there was no check cross-referencing what the
// save path outputs with what the read side expects = "the file exists but can't be
// reached from the record" surfaced only as an orphan-media warning.
//
// What's checked: the envelope written by the real handleSavePost is passed as-is into
// the real renderer-side helpers (artworkFile = the card's face / buildGalleryItems =
// the detail view's items) and verified. Testing only one side or the other would never
// catch these two contracts drifting apart.

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as R from '../app/src/renderer/src/services/records';

// The minimum content needed just to be accepted = a JPEG's SOI, and an ISO base media
// ftyp box. media-download rejects it unless both the content-type and the bytes line up.
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
    // The shape the extension hands over for X's bulk intake (#362): a video is announced with type:'video' and a poster.
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

  // Never put a video's name in the stills field = if this breaks, everything downstream on the read side breaks with it
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

  // The poster is referenced from media[0] = it is not counted as an orphan
  test('ディスクのポスターがレコードから辿れる', () => {
    expect(record.media.map((m: any) => m.posterFile)).toContain(`${CAPTURE_ID}-poster.jpg`);
  });
});
