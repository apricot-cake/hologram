'use strict';

// undo.ts のロジック単体テスト。undo.ts は real ES module（named exports）なので
// 動的 import() で読み込む。線形履歴のスタック意味論（上限50・新規編集で redo 破棄・
// prev/new の方向写像・poster-tags ルーティング・適用有無の bool 返却）を
// スタブ deps 注入で検証する。副作用（IPC 書き・再描画）は viewer 残置＝
// ここでは呼び出し記録のみ見る。
//
//   node scripts/test-undo-unit.cts

const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const U = await import(pathToFileURL(path.join(__dirname, '..', 'app', 'src', 'renderer', 'src', 'services', 'undo.ts')).href);

  let failed = 0;
  function assert(name, cond) {
    if (cond) {
      console.log('ok  ', name);
    } else {
      console.log('FAIL', name);
      failed++;
    }
  }

  // --- スタブ: 適用呼び出しを記録するだけ ---
  const tagCalls: any[] = [];
  const posterCalls: any[] = [];
  const undo = U.makeUndo({
    applyTags: (records) => {
      tagCalls.push(records);
    },
    applyPosterTags: (records) => {
      posterCalls.push(records);
    },
  });

  // --- 空スタックは no-op（false 返却＝トーストしない契約） ---
  assert('undo: 空スタックで false', (await undo.undo()) === false);
  assert('redo: 空スタックで false', (await undo.redo()) === false);
  assert('空 undo で apply 未呼び出し', tagCalls.length === 0 && posterCalls.length === 0);

  // --- push ガード: 空 records は積まれない ---
  undo.push('tags', []);
  undo.push('tags', null);
  assert('push: 空/null records は無視', (await undo.undo()) === false);

  // --- undo は prevTags・redo は newTags を適用（post 側の形状写像込み） ---
  undo.push('tags', [{ captureId: 'c1', image: 'i1.jpg', prevTags: ['旧'], newTags: ['新'] }]);
  assert('undo: エントリ有りで true', (await undo.undo()) === true);
  assert('undo: applyTags へ prevTags が {captureId,image,tags} で渡る', tagCalls.length === 1 && tagCalls[0][0].captureId === 'c1' && tagCalls[0][0].image === 'i1.jpg' && tagCalls[0][0].tags.join() === '旧');
  assert('redo: エントリ有りで true', (await undo.redo()) === true);
  assert('redo: applyTags へ newTags が渡る', tagCalls.length === 2 && tagCalls[1][0].tags.join() === '新');
  // redo 後は undo スタックへ戻っている（もう一往復できる）
  assert('redo 後に再 undo 可能', (await undo.undo()) === true);

  // --- poster-tags ルーティング: applyPosterTags へ {key,tags} ---
  undo.push('poster-tags', [{ key: 'x:alice', prevTags: ['a'], newTags: ['a', 'b'] }]);
  await undo.undo();
  assert('poster-tags: applyPosterTags へルーティング', posterCalls.length === 1 && posterCalls[0][0].key === 'x:alice' && posterCalls[0][0].tags.join() === 'a');
  assert('poster-tags: applyTags は増えない', tagCalls.length === 3);

  // --- 新規編集で redo 破棄（線形履歴） ---
  // 直前の undo で redo スタックに1件あるはず → push で消える
  undo.push('tags', [{ captureId: 'c2', image: 'i2.jpg', prevTags: [], newTags: ['t'] }]);
  assert('push: redo スタック破棄', (await undo.redo()) === false);

  // --- 上限50: 51件積むと最古が落ちる ---
  const undo2 = U.makeUndo({ applyTags: () => {}, applyPosterTags: () => {} });
  for (let i = 0; i < 51; i++) undo2.push('tags', [{ captureId: 'c' + i, image: 'i.jpg', prevTags: [], newTags: ['t'] }]);
  let n = 0;
  while (await undo2.undo()) n++;
  assert('上限50: 51件 push で undo 可能は50件', n === 50);

  if (failed) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nall undo unit tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
