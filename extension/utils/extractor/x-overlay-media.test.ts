import { JSDOM } from 'jsdom';
import { expect, test } from 'vitest';
import x from './x.ts';

test.each(['quoteTweet', 'link'])('引用元の画像・動画を投稿自身の枚数に含めない: %s', (kind) => {
  const dom = new JSDOM(`<article><div data-testid="Tweet-User-Avatar"></div>
    <div id="own" data-testid="tweetPhoto"><div data-testid="videoPlayer"><video></video></div></div>
    <div ${kind === 'link' ? 'role="link"' : 'data-testid="quoteTweet"'}>
      <div data-testid="tweetPhoto"><img></div><div data-testid="videoPlayer"><video></video></div>
    </div></article>`);
  const post = dom.window.document.querySelector('article')!;
  expect(x.overlay!.mediaIn(post).map((el) => el.id)).toEqual(['own']);
  post.querySelector('#own')!.remove();
  expect(x.overlay!.mediaIn(post)).toEqual([]);
  dom.window.close();
});

test('投稿自身の複数画像は個別保存の対象として残す', () => {
  const dom = new JSDOM('<article><div data-testid="tweetPhoto"></div><div data-testid="tweetPhoto"></div></article>');
  expect(x.overlay!.mediaIn(dom.window.document.querySelector('article')!)).toHaveLength(2);
  dom.window.close();
});
