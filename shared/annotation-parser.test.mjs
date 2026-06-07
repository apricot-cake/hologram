// node shared/annotation-parser.test.mjs で実行
import { parseAnnotation } from './annotation-parser.js';
import assert from 'node:assert/strict';

const cases = [
  {
    name: 'X / Bluesky 新形式 (Phase 1 で実機保存したもの)',
    input:
`Platform: X (Twitter)
Display Name: たっぷり鈍器🫀⚒
Author: @ihana_k
Hashtags: #こはるすけっち
Text: #こはるすけっち`,
    expect: {
      platform: 'x',
      platformLabel: 'X (Twitter)',
      displayName: 'たっぷり鈍器🫀⚒',
      author: 'ihana_k',
      image: null,
      hashtags: ['こはるすけっち'],
      alt: null,
      text: '#こはるすけっち',
      title: null
    }
  },
  {
    name: 'pixiv 新形式 (Phase 1 で実機保存したもの)',
    input:
`Platform: Pixiv
Display Name: 赤倉＠画集発売中
Author: @882569
Hashtags: #オリジナル #仕事絵 #創作 #女の子 #ChupaChups #チュッパチャプス #オリジナル5000users入り
Title: チュッパチャプス ストロベリー`,
    expect: {
      platform: 'pixiv',
      platformLabel: 'Pixiv',
      displayName: '赤倉＠画集発売中',
      author: '882569',
      image: null,
      hashtags: ['オリジナル', '仕事絵', '創作', '女の子', 'ChupaChups', 'チュッパチャプス', 'オリジナル5000users入り'],
      alt: null,
      text: null,
      title: 'チュッパチャプス ストロベリー'
    }
  },
  {
    name: 'Image / Alt 含む X',
    input:
`Platform: X (Twitter)
Display Name: 表示名
Author: @user
Image: 2/3
Hashtags: #foo #bar
Alt: 画像の説明
Text: 投稿本文`,
    expect: {
      platform: 'x',
      image: '2/3',
      alt: '画像の説明',
      text: '投稿本文',
      hashtags: ['foo', 'bar']
    }
  },
  {
    name: 'Bluesky',
    input:
`Platform: Bluesky
Display Name: Tkugane
Author: @tkugane353.bsky.social
Text: Skeb thank you`,
    expect: {
      platform: 'bluesky',
      author: 'tkugane353.bsky.social',
      text: 'Skeb thank you'
    }
  },
  {
    name: '旧形式 (Phase 1 以前のライブラリ — Window Plugin 同期時に遭遇する想定)',
    input:
`@user - 投稿本文先頭

Platform: X (Twitter)
Display Name: 表示名
Author: @user
UID: 1234567890
Post ID: 2040000000000000000
Image: 1/3
Published: 2026-04-04T12:00:00.000Z
Hashtags: #foo
Text: 投稿本文
Description: pixiv のキャプション`,
    expect: {
      platform: 'x',
      author: 'user',
      legacy: {
        uid: '1234567890',
        postId: '2040000000000000000',
        publishedAt: '2026-04-04T12:00:00.000Z',
        description: 'pixiv のキャプション'
      }
    }
  },
  {
    name: 'Platform 行が無い annotation は null',
    input: 'just some random text\nwith no Platform line',
    expect: null
  },
  {
    name: '空文字列は null',
    input: '',
    expect: null
  },
  {
    name: 'undefined は null',
    input: undefined,
    expect: null
  }
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = parseAnnotation(c.input);
  try {
    if (c.expect === null) {
      assert.equal(got, null);
    } else {
      // expect の各キーだけ部分一致で確認
      for (const [k, v] of Object.entries(c.expect)) {
        assert.deepEqual(got[k], v, `field "${k}"`);
      }
    }
    console.log(`  PASS  ${c.name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${c.name}`);
    console.log(`        ${e.message}`);
    console.log(`        got: ${JSON.stringify(got, null, 2)}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
