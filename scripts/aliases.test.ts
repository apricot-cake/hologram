// services/aliases.ts (#23 St1: 破壊しない・戻せる投稿者名の合流) の単体テスト。
// このモジュール自身の永続化の呼び出し (hologramIpc) は、ここでは捕まえて何もしない
// 経路しか通らない（Node には window が無い。scripts/vitest.setup.ts は window.hologram
// をスタブしないし、aliases.ts の readAliases/writeAliases はどちらもそれを飲み込む）。
// だから以下のアサーションはすべて、変更・読み出しの関数が保つメモリ上のグループの
// 状態に対するもの。

import { beforeEach, describe, expect, test } from 'vitest';
import * as aliases from '../app/src/renderer/src/services/aliases';

beforeEach(async () => {
  // 変更を行う関数はどれも、load()/merge()/unlink()/restore() からしか届かない
  // グループ配列の再代入で終わる。reset() の export は無いので、テストは空のスナップ
  // ショットを読み込み直して状態を消す（Node では readAliases() が何もせず [] を返す。
  // グループを一度も永続化していない保存フォルダと同じ）。
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
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });

    expect(aliases.resolve('bluesky:b')).toBe('x:a');
    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['bluesky:b', 'x:a']);
    expect(aliases.isPrimary('x:a')).toBe(true);
    expect(aliases.isPrimary('bluesky:b')).toBe(false);
  });

  test('primary 省略時は keyA が既定（呼び出し側が inspector で開いている側を渡す約束）', () => {
    aliases.merge('x:a', 'bluesky:b');

    expect(aliases.resolve('bluesky:b')).toBe('x:a');
  });

  test('既にグループを持つ側へもう1件加えると、そのグループへ吸収される', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });
    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' });

    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['bluesky:b', 'pixiv:c', 'x:a']);
    expect(aliases.resolve('pixiv:c')).toBe('x:a');
  });

  test('2つの既存グループ同士を束ねると全メンバーが1つに合流する', () => {
    aliases.merge('x:a', 'x:a2', { primary: 'x:a' });
    aliases.merge('bluesky:b', 'bluesky:b2', { primary: 'bluesky:b' });

    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });

    expect(aliases.membersOf('x:a2').slice().sort()).toEqual(['bluesky:b', 'bluesky:b2', 'x:a', 'x:a2']);
  });

  test('同じキー・既に同じグループ・空文字は何もしない', () => {
    expect(aliases.merge('x:a', 'x:a')).toBe(false);
    expect(aliases.merge('', 'x:a')).toBe(false);

    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });
    expect(aliases.merge('x:a', 'bluesky:b')).toBe(false); // すでに同じグループ
  });

  test('primary が members に無ければ無視してフォールバックを使う', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'pixiv:not-a-member' });

    expect(aliases.resolve('x:a')).toBe('x:a'); // 代わりに keyA を使う（gA/gB はどちらも未グルーピングだった）
  });
});

describe('unlink', () => {
  test('3人以上のグループから1人抜けても、残りは束ねられたまま', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });
    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' });

    expect(aliases.unlink('bluesky:b')).toBe(true);

    expect(aliases.resolve('bluesky:b')).toBe('bluesky:b'); // 未グルーピングへ戻る
    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['pixiv:c', 'x:a']);
  });

  test('2人グループから1人抜けると、残った1人も丸ごとほどける（グループは2人未満で存在しない）', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });

    aliases.unlink('bluesky:b');

    expect(aliases.groupOf('x:a')).toBeNull();
    expect(aliases.resolve('x:a')).toBe('x:a');
  });

  test('primary を抜くと、残りの先頭メンバーへ自動で昇格する', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });
    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' });

    aliases.unlink('x:a'); // primary 自身を抜く

    const survivorPrimary = aliases.resolve('bluesky:b');
    expect(['bluesky:b', 'pixiv:c']).toContain(survivorPrimary);
    expect(aliases.resolve('pixiv:c')).toBe(survivorPrimary);
  });

  test('グループに属さないキーは false', () => {
    expect(aliases.unlink('x:never-grouped')).toBe(false);
  });
});

describe('setPrimary', () => {
  test('グループ内の別メンバーを primary にできる', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });

    expect(aliases.setPrimary('bluesky:b')).toBe(true);

    expect(aliases.resolve('x:a')).toBe('bluesky:b');
    expect(aliases.membersOf('x:a')[0]).toBe('bluesky:b'); // primary が先頭（membersOf と resolve の一致）
  });

  test('既に primary なら false（無変更）', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });
    expect(aliases.setPrimary('x:a')).toBe(false);
  });

  test('グループに属さないキーは false', () => {
    expect(aliases.setPrimary('x:never-grouped')).toBe(false);
  });
});

describe('snapshotFor / restore（undo/redo の下地）', () => {
  test('往復すると元の状態に戻る', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });
    const keys = aliases.membersOf('x:a');
    const before = aliases.snapshotFor(keys);

    aliases.merge('x:a', 'pixiv:c', { primary: 'x:a' }); // 後から入る、同じグループに触る別件の変更

    aliases.restore([...keys, 'pixiv:c'], before);

    expect(aliases.resolve('bluesky:b')).toBe('x:a');
    expect(aliases.resolve('pixiv:c')).toBe('pixiv:c'); // 外へ落ちる＝before に入っていなかった
    expect(aliases.membersOf('x:a').slice().sort()).toEqual(['bluesky:b', 'x:a']);
  });

  test('影響を受けないキーの他グループは触らない', () => {
    aliases.merge('x:a', 'bluesky:b', { primary: 'x:a' });
    aliases.merge('x:p', 'bluesky:q', { primary: 'x:p' });

    aliases.restore(['x:a', 'bluesky:b'], []); // 最初のグループだけをほどく

    expect(aliases.groupOf('x:a')).toBeNull();
    expect(aliases.resolve('bluesky:q')).toBe('x:p'); // 触られていない
  });
});
