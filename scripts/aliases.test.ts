// Unit tests for services/aliases.ts (#23 St1: non-destructive, reversible
// poster name-merging). The module's own persistence calls (hologramIpc) are
// exercised only for their catch-and-no-op path here (no window under Node —
// scripts/vitest.setup.ts doesn't stub window.hologram, and aliases.ts's
// readAliases/writeAliases both swallow that), so every assertion below is
// against the in-memory group state the mutators/reads maintain.

import { beforeEach, describe, expect, test } from 'vitest';
import * as aliases from '../app/src/renderer/src/services/aliases';

beforeEach(async () => {
  // Each mutator ends in a group-array reassignment reachable only through
  // load()/merge()/unlink()/restore() — there is no reset() export, so tests
  // clear state by loading an empty snapshot fresh (readAliases() no-ops to []
  // under Node, same as a save folder that has never persisted any group).
  aliases.restore([...aliases.allGroups().flatMap((g) => g.members)], []);
});

describe('resolve / membersOf / groupOf（未グルーピング＝恒等）', () => {
  test('グループが無いキーは自分自身へ解決する', () => {
    expect(aliases.resolve('x:solo')).toBe('x:solo');
    expect(aliases.membersOf('x:solo')).toEqual(['x:solo']);
    expect(aliases.groupOf('x:solo')).toBeNull();
    expect(aliases.isPrimary('x:solo')).toBe(true);
  });
});

describe('merge', () => {
  test('未グルーピングの2キーを束ねると、primary が resolve の答えになる', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });

    expect(aliases.resolve('misskey:b')).toBe('x:a');
    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['misskey:b', 'x:a']);
    expect(aliases.isPrimary('x:a')).toBe(true);
    expect(aliases.isPrimary('misskey:b')).toBe(false);
  });

  test('primary 省略時は keyA が既定（呼び出し側が inspector で開いている側を渡す約束）', () => {
    aliases.merge('x:a', 'misskey:b');

    expect(aliases.resolve('misskey:b')).toBe('x:a');
  });

  test('既にグループを持つ側へもう1件加えると、そのグループへ吸収される', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });
    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' });

    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['misskey:b', 'pixiv:c', 'x:a']);
    expect(aliases.resolve('pixiv:c')).toBe('x:a');
  });

  test('2つの既存グループ同士を束ねると全メンバーが1つに合流する', () => {
    aliases.merge('x:a', 'x:a2', { primary: 'x:a' });
    aliases.merge('misskey:b', 'misskey:b2', { primary: 'misskey:b' });

    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });

    expect(aliases.membersOf('x:a2').slice().sort()).toEqual(['misskey:b', 'misskey:b2', 'x:a', 'x:a2']);
  });

  test('同じキー・既に同じグループ・空文字は何もしない', () => {
    expect(aliases.merge('x:a', 'x:a')).toBe(false);
    expect(aliases.merge('', 'x:a')).toBe(false);

    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });
    expect(aliases.merge('x:a', 'misskey:b')).toBe(false); // already the same group
  });

  test('primary が members に無ければ無視してフォールバックを使う', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'pixiv:not-a-member' });

    expect(aliases.resolve('x:a')).toBe('x:a'); // falls back to keyA (gA/gB were both ungrouped)
  });
});

describe('unlink', () => {
  test('3人以上のグループから1人抜けても、残りは束ねられたまま', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });
    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' });

    expect(aliases.unlink('misskey:b')).toBe(true);

    expect(aliases.resolve('misskey:b')).toBe('misskey:b'); // back to ungrouped
    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['pixiv:c', 'x:a']);
  });

  test('2人グループから1人抜けると、残った1人も丸ごとほどける（グループは2人未満で存在しない）', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });

    aliases.unlink('misskey:b');

    expect(aliases.groupOf('x:a')).toBeNull();
    expect(aliases.resolve('x:a')).toBe('x:a');
  });

  test('primary を抜くと、残りの先頭メンバーへ自動で昇格する', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });
    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' });

    aliases.unlink('x:a'); // remove the primary itself

    const survivorPrimary = aliases.resolve('misskey:b');
    expect(['misskey:b', 'pixiv:c']).toContain(survivorPrimary);
    expect(aliases.resolve('pixiv:c')).toBe(survivorPrimary);
  });

  test('グループに属さないキーは false', () => {
    expect(aliases.unlink('x:never-grouped')).toBe(false);
  });
});

describe('setPrimary', () => {
  test('グループ内の別メンバーを primary にできる', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });

    expect(aliases.setPrimary('misskey:b')).toBe(true);

    expect(aliases.resolve('x:a')).toBe('misskey:b');
    expect(aliases.membersOf('x:a')[0]).toBe('misskey:b'); // primary-first (membersOf/resolve agreement)
  });

  test('既に primary なら false（無変更）', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });
    expect(aliases.setPrimary('x:a')).toBe(false);
  });

  test('グループに属さないキーは false', () => {
    expect(aliases.setPrimary('x:never-grouped')).toBe(false);
  });
});

describe('snapshotFor / restore（undo/redo の下地）', () => {
  test('往復すると元の状態に戻る', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });
    const keys = aliases.membersOf('x:a');
    const before = aliases.snapshotFor(keys);

    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' }); // some later, unrelated-ish change touching the same group

    aliases.restore([...keys, 'pixiv:c'], before);

    expect(aliases.resolve('misskey:b')).toBe('x:a');
    expect(aliases.resolve('pixiv:c')).toBe('pixiv:c'); // dropped back out — before didn't include it
    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['misskey:b', 'x:a']);
  });

  test('影響を受けないキーの他グループは触らない', () => {
    aliases.merge('x:a', 'misskey:b', { primary: 'x:a' });
    aliases.merge('x:p', 'misskey:q', { primary: 'x:p' });

    aliases.restore(['x:a', 'misskey:b'], []); // dissolve just the first group

    expect(aliases.groupOf('x:a')).toBeNull();
    expect(aliases.resolve('misskey:q')).toBe('x:p'); // untouched
  });
});
