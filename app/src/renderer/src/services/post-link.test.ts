import { expect, test } from 'vitest';
import { findLinkedPost } from './post-link.ts';

test('個別保存と一括保存の投稿を区別する', () => {
  const url = 'https://x.com/a/status/123';
  const first = { url, saveScope: 'media', media: [{ url: 'https://pbs.twimg.com/media/1.jpg' }] };
  const second = { url, saveScope: 'media', media: [{ url: 'https://pbs.twimg.com/media/2.jpg' }] };
  const whole = { url, saveScope: 'post', media: [...first.media, ...second.media] };
  const posts = [first, second, whole];
  expect(findLinkedPost(posts, { url: 'https://twitter.com/b/status/123' })).toBe(whole);
  expect(findLinkedPost(posts, { url, mediaUrl: first.media[0].url })).toBe(first);
  expect(findLinkedPost(posts, { url, mediaUrl: second.media[0].url })).toBe(second);
  expect(findLinkedPost([whole], { url, mediaUrl: first.media[0].url })).toBeUndefined();
  expect(findLinkedPost([first], { url })).toBeUndefined();
});
