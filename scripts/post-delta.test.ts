// Unit tests for app/src/main/lib-post-delta.ts.
// A pure function that matches what was already delivered to the renderer (lastSent)
// against this run's DB read, and extracts only the additions/updates/removals.

import { describe, expect, test } from 'vitest';
import { computeDelta } from '../app/src/main/lib-post-delta';

type P = { captureId: string; updatedAt: string };
const post = (captureId: string, updatedAt: string): P => ({ captureId, updatedAt });
const stampsOf = (posts: P[]) => new Map<string, unknown>(posts.map((p) => [p.captureId, p.updatedAt]));

describe('computeDelta', () => {
  test('ベースラインが空なら全件が added', () => {
    const now = [post('a', '1'), post('b', '1')];
    const d = computeDelta(new Map(), now, stampsOf(now));
    expect(d.added.map((p) => p.captureId)).toEqual(['a', 'b']);
    expect(d.removed).toEqual([]);
  });

  test('何も動いていなければ added も removed も空', () => {
    const now = [post('a', '1'), post('b', '1')];
    const d = computeDelta(stampsOf(now), now, stampsOf(now));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  test('updatedAt が動いた投稿だけ added に出る', () => {
    const before = [post('a', '1'), post('b', '1')];
    const now = [post('a', '2'), post('b', '1')];
    const d = computeDelta(stampsOf(before), now, stampsOf(now));
    expect(d.added.map((p) => p.captureId)).toEqual(['a']);
    expect(d.removed).toEqual([]);
  });

  test('消えた投稿は removed に id で出る', () => {
    const before = [post('a', '1'), post('b', '1')];
    const now = [post('a', '1')];
    const d = computeDelta(stampsOf(before), now, stampsOf(now));
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual(['b']);
  });

  test('追加と削除が同時に起きても両方拾う', () => {
    const before = [post('a', '1'), post('b', '1')];
    const now = [post('a', '1'), post('c', '1')];
    const d = computeDelta(stampsOf(before), now, stampsOf(now));
    expect(d.added.map((p) => p.captureId)).toEqual(['c']);
    expect(d.removed).toEqual(['b']);
  });
});
