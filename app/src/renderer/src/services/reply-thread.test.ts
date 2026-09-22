import { postView } from '../../../../../tests/helpers/test-post-view.ts';
import { beforeEach, describe, expect, test } from 'vitest';
import { stampPost, makeGroupRecords } from './records.ts';
import { sync } from './posts-data.ts';
import { galleryPosition, imageEntrySelection, replyPostsOf, replyThreadOf } from './reply-thread.ts';

const post = (id: string, replyToId?: string, userId = 'author') => stampPost(postView({ captureId: id, url: `https://x.com/demo/status/${id}`, userId, replyToId, media: [{ file: `${id}-1.png` }, { file: `${id}-2.png` }], tags: [], hashtags: [] }));
const group = makeGroupRecords({ manualGroups: () => [], ungrouped: () => new Set() });

describe('保存済みの自己返信', () => {
  beforeEach(() => sync([]));
  test('一覧の並びを変えず、ビューアだけ親から返信へ並べる', () => {
    const root = post('100');
    const reply = post('101', '100');
    const last = post('102', '101');
    const unrelated = post('200');
    const records = [last, unrelated, reply, root];
    sync(records);
    expect(group(records).map((g) => g.rep.captureId)).toEqual(['102', '200', '101', '100']);
    expect(replyPostsOf(reply).map((g) => g.rep.captureId)).toEqual(['100', '101', '102']);
    expect(imageEntrySelection(group([reply])[0])).toEqual({ recs: ['100', '101', '102'], idx: 2 });
  });
  test('別の投稿者、別のサービス、未保存の親をつながない', () => {
    const root = post('100');
    const other = post('101', '100', 'other');
    const missing = post('102', '999');
    const foreign = stampPost({ ...post('103', '100'), url: 'https://bsky.app/profile/author/post/103' });
    sync([root, other, missing, foreign]);
    for (const p of [root, other, missing, foreign]) expect(replyThreadOf(p)).toBeUndefined();
  });
  test('削除後は返信のキャッシュも更新する', () => {
    const root = post('100');
    const reply = post('101', '100');
    sync([root, reply]);
    expect(replyPostsOf(root)).toHaveLength(2);
    sync([reply]);
    expect(replyPostsOf(reply)).toEqual([]);
  });
  test('投稿ごとの画像数と現在位置を数える', () => {
    const records = [post('100'), post('101')];
    const items = ['100', '100', '101', '101', '101'].map((postId) => ({ postId }));
    expect(galleryPosition(items, 2, (id) => records.find((p) => p.captureId === id))).toEqual({ post: 2, posts: 2, image: 1, images: 3 });
    expect(galleryPosition(items, 1, (id) => records.find((p) => p.captureId === id))).toEqual({ post: 1, posts: 2, image: 2, images: 2 });
  });

  test('ローカル画像のまとまりは1投稿の画像列として数える', () => {
    const items = [{ postId: 'a' }, { postId: 'b' }, { postId: 'c' }];
    expect(galleryPosition(items, 1, () => undefined, { singlePost: true })).toEqual({ post: 1, posts: 1, image: 2, images: 3 });
  });
});
