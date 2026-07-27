// undo.ts のロジック単体テスト。線形履歴のスタック意味論（上限50・新規編集で redo 破棄・
// prev/new の方向写像・poster-tags ルーティング・適用有無の bool 返却）を、スタブ deps
// 注入で検証する。副作用（IPC 書き・再描画）は viewer 残置＝ここでは呼び出し記録のみ見る。

import { describe, expect, test } from 'vitest';
import { makeUndo } from '../app/src/renderer/src/services/undo';

// 適用呼び出しを記録するだけのスタブ
function setup() {
  const tagCalls: any[] = [];
  const posterCalls: any[] = [];
  const undo = makeUndo({
    applyTags: (records) => {
      tagCalls.push(records);
    },
    applyPosterTags: (records) => {
      posterCalls.push(records);
    },
  });
  return { undo, tagCalls, posterCalls };
}

const tagEdit = (captureId: string, prevTags: string[], newTags: string[]) => [{ captureId, image: `${captureId}.jpg`, prevTags, newTags }];

describe('空スタックは no-op（false 返却＝トーストしない契約）', () => {
  test('undo は false', async () => {
    expect(await setup().undo.undo()).toBe(false);
  });

  test('redo は false', async () => {
    expect(await setup().undo.redo()).toBe(false);
  });

  test('apply は呼ばれない', async () => {
    const { undo, tagCalls, posterCalls } = setup();
    await undo.undo();
    expect(tagCalls).toHaveLength(0);
    expect(posterCalls).toHaveLength(0);
  });
});

test('push ガード: 空/null records は積まれない', async () => {
  const { undo } = setup();
  undo.push('tags', []);
  undo.push('tags', null);

  expect(await undo.undo()).toBe(false);
});

describe('undo は prevTags・redo は newTags を適用（post 側の形状写像込み）', () => {
  test('undo: applyTags へ prevTags が {captureId,image,tags} で渡る', async () => {
    const { undo, tagCalls } = setup();
    undo.push('tags', tagEdit('c1', ['旧'], ['新']));

    expect(await undo.undo()).toBe(true);
    expect(tagCalls).toEqual([[{ captureId: 'c1', image: 'c1.jpg', tags: ['旧'] }]]);
  });

  test('redo: applyTags へ newTags が渡る', async () => {
    const { undo, tagCalls } = setup();
    undo.push('tags', tagEdit('c1', ['旧'], ['新']));
    await undo.undo();

    expect(await undo.redo()).toBe(true);
    expect(tagCalls[1]).toEqual([{ captureId: 'c1', image: 'c1.jpg', tags: ['新'] }]);
  });

  // redo 後は undo スタックへ戻っている（もう一往復できる）
  test('redo 後に再 undo 可能', async () => {
    const { undo } = setup();
    undo.push('tags', tagEdit('c1', ['旧'], ['新']));
    await undo.undo();
    await undo.redo();

    expect(await undo.undo()).toBe(true);
  });
});

describe('poster-tags ルーティング', () => {
  test('applyPosterTags へ {key,tags} で渡る', async () => {
    const { undo, posterCalls } = setup();
    undo.push('poster-tags', [{ key: 'x:alice', prevTags: ['a'], newTags: ['a', 'b'] }]);
    await undo.undo();

    expect(posterCalls).toEqual([[{ key: 'x:alice', tags: ['a'] }]]);
  });

  test('applyTags 側は呼ばれない', async () => {
    const { undo, tagCalls } = setup();
    undo.push('poster-tags', [{ key: 'x:alice', prevTags: ['a'], newTags: ['a', 'b'] }]);
    await undo.undo();

    expect(tagCalls).toHaveLength(0);
  });
});

test('新規編集で redo スタックを破棄（線形履歴）', async () => {
  const { undo } = setup();
  undo.push('tags', tagEdit('c1', ['旧'], ['新']));
  await undo.undo(); // redo スタックに1件ある状態

  undo.push('tags', tagEdit('c2', [], ['t']));

  expect(await undo.redo()).toBe(false);
});

test('上限50: 51件 push すると最古が落ちる', async () => {
  const { undo } = setup();
  for (let i = 0; i < 51; i++) undo.push('tags', tagEdit(`c${i}`, [], ['t']));

  let n = 0;
  while (await undo.undo()) n++;

  expect(n).toBe(50);
});
