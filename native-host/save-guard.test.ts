import { describe, expect, test } from 'vitest';
import { alreadySaved } from './save-guard.mts';
import type { SavedEntry } from './protocol.mts';

const complete: SavedEntry = { id: 'old', post: true, media: ['a', 'b'], individualMedia: [] };

describe('保存済みの判定', () => {
  test('保存済みの投稿とテキスト投稿は追加しない', () => {
    expect(alreadySaved(complete, 'post', ['a', 'b'])).toBe(true);
    expect(alreadySaved({ id: 'text', post: true, media: [] }, 'post', [])).toBe(true);
  });
  test('古い保存で画像URLがなくても全体保存済みなら追加しない', () => {
    expect(alreadySaved({ id: 'old', post: true, media: [null] }, 'post', ['a'])).toBe(true);
  });
  test('未保存・不足画像・新しく増えた画像は保存できる', () => {
    expect(alreadySaved(undefined, 'post', ['a'])).toBe(false);
    expect(alreadySaved({ ...complete, post: false }, 'post', ['a', 'b'])).toBe(false);
    expect(alreadySaved(complete, 'post', ['a', 'b', 'c'])).toBe(false);
    expect(alreadySaved({ id: 'old', post: true, media: [null] }, 'post', ['a', 'b'])).toBe(false);
  });
  test('全体保存と個別保存は区別し、同じ個別画像だけを抑止する', () => {
    expect(alreadySaved(complete, 'media', ['a'])).toBe(false);
    const individual = { ...complete, post: false, individualMedia: ['a'] };
    expect(alreadySaved(individual, 'media', ['a'])).toBe(true);
    expect(alreadySaved(individual, 'media', ['b'])).toBe(false);
    expect(alreadySaved(individual, 'post', ['a'])).toBe(false);
  });
});
