// すべての E2E ケースが出発点にするフィクスチャライブラリ: ディスク上の
// メディアファイルと、アプリが開くデータベース内の投稿の行。
//
// 構造上決定的にしてある。視覚的なベースラインはピクセル単位で比較される
// ため: 固定のキャプチャ id、固定の絶対タイムスタンプ（そこから「N日前」は
// 導出できない — アプリは日付を絶対表記で描画するので、時計を偽装する必要が
// 無い）、固定の画像サイズと色。ここでは現在日時もマシンも本物のライブラリも
// 一切読まない。
//
// レコードは、実際のどの生成者も使うのと同じ writePost を通る
// （scripts/lib-seed-library.cts）ので、フィクスチャがアプリが実際に保存する
// 形からずれることはあり得ない。

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
  /** 投稿日とキャプチャ日。どちらも絶対値の ISO 文字列。 */
  date: string;
  capturedAt: string;
  /** メディアのピクセルサイズ — グリッド内のカードのアスペクト比でもある。 */
  width: number;
  height: number;
  color: [number, number, number];
}

// 4件の投稿が、各フローの主張を運動させられる最小の集合: 2つのプラット
// フォーム（インスペクタのプラットフォーム行）、タグ付きの投稿とタグ無しの
// 投稿（タグ欄の空/入り済みの形）、そして検索できれいに分かれるテキスト
// （「青」はちょうど1件にマッチする）。
export const FIXTURE_POSTS: FixturePost[] = [
  { captureId: 'e2e-0001', platform: 'x', text: '青い空と海の写真です。', displayName: '海野そら', screenName: 'sora_umi', tags: ['風景', '青'], likes: 1200, reposts: 340, replies: 21, date: '2026-03-01T10:00:00.000Z', capturedAt: '2026-03-02T00:00:00.000Z', width: 400, height: 300, color: [137, 207, 240] },
  { captureId: 'e2e-0002', platform: 'x', text: '夕暮れの街並み。', displayName: '街田あかね', screenName: 'akane_machi', tags: ['風景'], likes: 860, reposts: 120, replies: 8, date: '2026-03-03T10:00:00.000Z', capturedAt: '2026-03-04T00:00:00.000Z', width: 300, height: 400, color: [255, 191, 134] },
  { captureId: 'e2e-0003', platform: 'bluesky', text: '猫が机の上で寝ている。', displayName: '猫沢みけ', screenName: 'mike_nekozawa', tags: [], likes: 5400, reposts: 900, replies: 64, date: '2026-03-05T10:00:00.000Z', capturedAt: '2026-03-06T00:00:00.000Z', width: 400, height: 400, color: [168, 228, 160] },
  { captureId: 'e2e-0004', platform: 'misskey', text: '手描きのラフスケッチ。', displayName: '筆本らふ', screenName: 'rough_fudemoto', tags: ['ラフ'], likes: 42, reposts: 3, replies: 1, date: '2026-03-07T10:00:00.000Z', capturedAt: '2026-03-08T00:00:00.000Z', width: 600, height: 240, color: [177, 156, 217] },
];

/** 準備済みのサンドボックスへ、`posts` のメディアファイルとデータベースの行を書く。 */
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

/** 空だが有効なライブラリ（投稿ゼロ）を用意する — 初回起動時の空の状態。 */
export function seedEmptyLibrary(configDir: string, _saveFolder: string): void {
  seedLibrary(configDir, []);
}
