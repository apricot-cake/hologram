// The fixture library every E2E case starts from: media files on disk plus post
// rows in the database the app will open.
//
// Deterministic by construction, because the visual baselines are compared pixel
// for pixel: fixed capture ids, fixed absolute timestamps (no "N days ago" can be
// derived from them — the app formats dates absolutely, so no clock faking is
// needed), fixed image sizes and colors. Nothing here reads the current date, the
// machine, or the real library.
//
// Records go through the same writePost every real producer uses
// (scripts/lib-seed-library.cts), so a fixture cannot drift away from the shape
// the app actually stores.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');
const { seedLibrary } = require(path.join(repoRoot, 'scripts', 'lib-seed-library.cts'));
const { makePng } = require(path.join(repoRoot, 'scripts', 'lib-sandbox-real-seed.cts'));

export interface FixturePost {
  captureId: string;
  platform: string;
  text: string;
  displayName: string;
  screenName: string;
  tags: string[];
  likes: number;
  reposts: number;
  replies: number;
  /** Post date and capture date, both absolute ISO strings. */
  date: string;
  capturedAt: string;
  /** Media pixel size — also the card's aspect ratio in the grid. */
  width: number;
  height: number;
  color: [number, number, number];
}

// Four posts is the smallest set that still exercises what the flows assert:
// two platforms (the inspector's platform row), a post with tags and one
// without (the tag field's empty vs filled form), and text that separates
// cleanly under search ('青' matches exactly one).
export const FIXTURE_POSTS: FixturePost[] = [
  { captureId: 'e2e-0001', platform: 'x', text: '青い空と海の写真です。', displayName: '海野そら', screenName: 'sora_umi', tags: ['風景', '青'], likes: 1200, reposts: 340, replies: 21, date: '2026-03-01T10:00:00.000Z', capturedAt: '2026-03-02T00:00:00.000Z', width: 400, height: 300, color: [137, 207, 240] },
  { captureId: 'e2e-0002', platform: 'x', text: '夕暮れの街並み。', displayName: '街田あかね', screenName: 'akane_machi', tags: ['風景'], likes: 860, reposts: 120, replies: 8, date: '2026-03-03T10:00:00.000Z', capturedAt: '2026-03-04T00:00:00.000Z', width: 300, height: 400, color: [255, 191, 134] },
  { captureId: 'e2e-0003', platform: 'bluesky', text: '猫が机の上で寝ている。', displayName: '猫沢みけ', screenName: 'mike_nekozawa', tags: [], likes: 5400, reposts: 900, replies: 64, date: '2026-03-05T10:00:00.000Z', capturedAt: '2026-03-06T00:00:00.000Z', width: 400, height: 400, color: [168, 228, 160] },
  { captureId: 'e2e-0004', platform: 'misskey', text: '手描きのラフスケッチ。', displayName: '筆本らふ', screenName: 'rough_fudemoto', tags: ['ラフ'], likes: 42, reposts: 3, replies: 1, date: '2026-03-07T10:00:00.000Z', capturedAt: '2026-03-08T00:00:00.000Z', width: 600, height: 240, color: [177, 156, 217] },
];

/** Write the media files and the database rows for `posts` into a prepared sandbox. */
export function seedFixtureLibrary(configDir: string, saveFolder: string, posts: FixturePost[] = FIXTURE_POSTS): void {
  const records = posts.map((post) => {
    const image = `${post.captureId}.png`;
    fs.writeFileSync(path.join(saveFolder, image), makePng(post.width, post.height, post.color));
    return {
      captureId: post.captureId,
      image,
      url: `https://example.test/${post.screenName}/status/${post.captureId}`,
      platform: post.platform,
      text: post.text,
      displayName: post.displayName,
      screenName: post.screenName,
      likes: post.likes,
      reposts: post.reposts,
      replies: post.replies,
      date: post.date,
      capturedAt: post.capturedAt,
      updatedAt: post.capturedAt,
      tags: post.tags,
      hashtags: [],
      media: [{ file: image, url: `https://example.test/media/${image}`, width: post.width, height: post.height }],
    };
  });
  seedLibrary(configDir, records);
}

/** Prepare an empty-but-valid library (no posts) — the first-run empty state. */
export function seedEmptyLibrary(configDir: string, _saveFolder: string): void {
  seedLibrary(configDir, []);
}
