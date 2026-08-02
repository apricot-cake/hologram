// Unit tests for the logic in undo.ts (#235). Verifies the semantics of the diff-based
// undo stack against stub deps that hold the "current value being applied to". The side
// effects (IPC writes, re-rendering) belong to undo-builder — here we only check how the
// diff gets applied.
//
// The main focus is the round trip: execute -> undo returns to the original state, and
// "doesn't drag in other items or edits made afterward" (the difference from what #235
// rejected: writing back a whole snapshot, or a naive inverse operation).

import { describe, expect, test } from 'vitest';
import { makeUndo, type DirectedChange, type UndoChange, type UndoKind } from '../app/src/renderer/src/services/undo';

// A minimal "library" stub holding a value set per target. The applier just applies
// remove -> add to the current value (the same rule as the real undo-builder).
function setup(initial: Record<string, string[]> = {}) {
  const state: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(initial)) state[k] = v.slice();
  const calls: Array<{ kind: UndoKind; changes: DirectedChange[] }> = [];

  const applierFor = (kind: UndoKind) => (changes: DirectedChange[]) => {
    calls.push({ kind, changes: changes.map((c) => ({ ...c })) });
    for (const c of changes) {
      const cur = state[c.target] || [];
      const kept = cur.filter((v) => !c.remove.includes(v));
      state[c.target] = [...kept, ...c.add.filter((v) => !kept.includes(v))];
    }
  };

  const undo = makeUndo({
    appliers: {
      'post-tags': applierFor('post-tags'),
      'poster-tags': applierFor('poster-tags'),
      'folder-items': applierFor('folder-items'),
      'poster-folder-items': applierFor('poster-folder-items'),
      // 'poster-alias' (#23 St1) is snapshot-based, not a value diff (see
      // undo.ts's UndoChange comment) — the generic diff stub above is still a
      // fine stand-in here since this file only exercises the STACK semantics
      // (push/undo/redo/cap/direction), not any one kind's real apply logic.
      'poster-alias': applierFor('poster-alias'),
    },
  });
  return { undo, state, calls };
}

// Runs the bulk operation "add applyTags to the targets" and returns, as the diff, only what was actually added.
function bulkAdd(state: Record<string, string[]>, targets: string[], tags: string[]): UndoChange[] {
  const changes: UndoChange[] = [];
  for (const target of targets) {
    const prev = state[target] || [];
    const added = tags.filter((t) => !prev.includes(t));
    if (!added.length) continue;
    state[target] = [...prev, ...added];
    changes.push({ kind: 'post-tags', target, added, removed: [] });
  }
  return changes;
}

describe('空スタックは no-op（null 返却＝トーストしない契約）', () => {
  test('undo は null', async () => {
    expect(await setup().undo.undo()).toBeNull();
  });

  test('redo は null', async () => {
    expect(await setup().undo.redo()).toBeNull();
  });

  test('applier は呼ばれない', async () => {
    const { undo, calls } = setup();
    await undo.undo();
    expect(calls).toHaveLength(0);
  });
});

describe('push の正規化（no-op は記録しない）', () => {
  test('空配列・null は積まれない', async () => {
    const { undo } = setup();
    expect(undo.push([])).toBeNull();
    expect(undo.push(null)).toBeNull();
    expect(await undo.undo()).toBeNull();
  });

  test('added/removed がともに空の変更は落ちる', () => {
    const { undo } = setup();
    expect(undo.push([{ kind: 'post-tags', target: 'c1', added: [], removed: [] }])).toBeNull();
  });

  test('added と removed に同じ値がある場合は両方から落ちる（逆適用が定義できないため）', () => {
    const { undo } = setup();
    expect(undo.push([{ kind: 'post-tags', target: 'c1', added: ['同'], removed: ['同'] }])).toBeNull();
  });

  test('重複は畳まれる', async () => {
    const { undo, calls } = setup({ c1: [] });
    undo.push([{ kind: 'post-tags', target: 'c1', added: ['a', 'a', 'b'], removed: [] }]);
    await undo.undo();

    expect(calls[0].changes[0].remove).toEqual(['a', 'b']);
  });
});

describe('往復: 実行 → 取り消しで元の状態に戻る', () => {
  test('タグ追加の往復', async () => {
    const { undo, state } = setup({ c1: ['旧'] });
    undo.push(bulkAdd(state, ['c1'], ['新']));
    expect(state.c1).toEqual(['旧', '新']);

    await undo.undo();

    expect(state.c1).toEqual(['旧']);
  });

  test('タグ削除の往復（戻した値は末尾へ＝位置は差分に含めない）', async () => {
    const { undo, state } = setup({ c1: ['a', 'b', 'c'] });
    state.c1 = ['a', 'c'];
    undo.push([{ kind: 'post-tags', target: 'c1', added: [], removed: ['b'] }]);

    await undo.undo();

    expect(state.c1).toEqual(['a', 'c', 'b']);
  });

  test('取り消しのあと redo で操作後の状態へ戻る', async () => {
    const { undo, state } = setup({ c1: ['旧'] });
    undo.push(bulkAdd(state, ['c1'], ['新']));
    await undo.undo();

    await undo.redo();

    expect(state.c1).toEqual(['旧', '新']);
  });

  test('redo 後にもう一度 undo できる', async () => {
    const { undo, state } = setup({ c1: [] });
    undo.push(bulkAdd(state, ['c1'], ['t']));
    await undo.undo();
    await undo.redo();

    expect(await undo.undo()).not.toBeNull();
    expect(state.c1).toEqual([]);
  });

  test('フォルダ所属の往復', async () => {
    const { undo, state } = setup({ f1: ['c1'] });
    state.f1 = ['c1', 'c2', 'c3'];
    undo.push([{ kind: 'folder-items', target: 'f1', added: ['c2', 'c3'], removed: [] }]);

    await undo.undo();

    expect(state.f1).toEqual(['c1']);
  });
});

describe('実データを壊さない: 記録した差分の外へ手を出さない', () => {
  // The case broken by #235's rejected option 2 (a naive inverse operation: strip the tag from all targets).
  test('一括タグ付けで元から持っていた項目は、取り消しでもタグを失わない', async () => {
    const { undo, state } = setup({ c1: [], c2: ['猫'] });

    undo.push(bulkAdd(state, ['c1', 'c2'], ['猫']));
    expect(state).toEqual({ c1: ['猫'], c2: ['猫'] });

    await undo.undo();

    expect(state).toEqual({ c1: [], c2: ['猫'] });
  });

  // The case broken by #235's rejected option 1 (writing back the whole pre-operation snapshot).
  test('取り消すまでの間に入った別の編集は巻き込まれない', async () => {
    const { undo, state } = setup({ c1: ['旧'] });
    undo.push(bulkAdd(state, ['c1'], ['A']));
    state.c1 = [...state.c1, '後から足したタグ']; // an edit from a separate path (not on the stack)

    await undo.undo();

    expect(state.c1).toEqual(['旧', '後から足したタグ']);
  });

  test('同じ対象の2手を順に取り消しても、各手の分だけが戻る', async () => {
    const { undo, state } = setup({ c1: [] });
    undo.push(bulkAdd(state, ['c1'], ['A']));
    undo.push(bulkAdd(state, ['c1'], ['B']));

    await undo.undo();
    expect(state.c1).toEqual(['A']);

    await undo.undo();
    expect(state.c1).toEqual([]);
  });
});

describe('種別ごとのルーティングと束ね方', () => {
  test('種別の違う変更は、それぞれの applier へ振り分けられる', async () => {
    const { undo, calls } = setup({ c1: ['a'], 'x:alice': ['b'], f1: ['c1'] });
    undo.push([
      { kind: 'post-tags', target: 'c1', added: ['a2'], removed: [] },
      { kind: 'poster-tags', target: 'x:alice', added: ['b2'], removed: [] },
      { kind: 'folder-items', target: 'f1', added: ['c9'], removed: [] },
    ]);

    await undo.undo();

    expect(calls.map((c) => c.kind)).toEqual(['post-tags', 'poster-tags', 'folder-items']);
  });

  test('同じ種別の複数対象は1回の applier 呼び出しに束ねる（永続化は1回で済む）', async () => {
    const { undo, state, calls } = setup({ c1: [], c2: [] });
    undo.push(bulkAdd(state, ['c1', 'c2'], ['猫']));

    await undo.undo();

    expect(calls).toHaveLength(1);
    expect(calls[0].changes).toHaveLength(2);
  });

  test('image は post-tags の変更に付いて回る（update-tags はファイル名で引くため）', async () => {
    const { undo, calls } = setup({ c1: [] });
    undo.push([{ kind: 'post-tags', target: 'c1', image: 'c1.jpg', added: ['t'], removed: [] }]);

    await undo.undo();

    expect(calls[0].changes[0].image).toBe('c1.jpg');
  });
});

describe('トーストの「元に戻す」＝スタック最新のときだけ効く', () => {
  test('直後なら効く', async () => {
    const { undo, state } = setup({ c1: [] });
    const entry = undo.push(bulkAdd(state, ['c1'], ['t']));

    expect(await undo.undoIfTop(entry?.id ?? -1)).not.toBeNull();
    expect(state.c1).toEqual([]);
  });

  test('後から別の編集が入ったら no-op（他人の編集を戻さない）', async () => {
    const { undo, state } = setup({ c1: [], c2: [] });
    const first = undo.push(bulkAdd(state, ['c1'], ['t']));
    undo.push(bulkAdd(state, ['c2'], ['u']));

    expect(await undo.undoIfTop(first?.id ?? -1)).toBeNull();
    expect(state).toEqual({ c1: ['t'], c2: ['u'] });
  });

  test('同じ id で二度押しても二重には戻らない', async () => {
    const { undo, state } = setup({ c1: ['旧'] });
    const entry = undo.push(bulkAdd(state, ['c1'], ['新']));
    await undo.undoIfTop(entry?.id ?? -1);

    expect(await undo.undoIfTop(entry?.id ?? -1)).toBeNull();
    expect(state.c1).toEqual(['旧']);
  });

  test('peek は次に Ctrl+Z が取る手を指す', () => {
    const { undo, state } = setup({ c1: [] });
    undo.push(bulkAdd(state, ['c1'], ['a']));
    const second = undo.push(bulkAdd(state, ['c1'], ['b']));

    expect(undo.peek()?.id).toBe(second?.id);
  });
});

test('新規編集で redo スタックを破棄（線形履歴）', async () => {
  const { undo, state } = setup({ c1: [], c2: [] });
  undo.push(bulkAdd(state, ['c1'], ['t']));
  await undo.undo(); // state where the redo stack has 1 entry

  undo.push(bulkAdd(state, ['c2'], ['u']));

  expect(await undo.redo()).toBeNull();
});

test('上限50: 51件 push すると最古が落ちる', async () => {
  const { undo, state } = setup();
  for (let i = 0; i < 51; i++) undo.push(bulkAdd(state, [`c${i}`], ['t']));

  let n = 0;
  while (await undo.undo()) n++;

  expect(n).toBe(50);
});
