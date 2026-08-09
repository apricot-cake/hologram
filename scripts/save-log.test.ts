// capture.log は「起動しただけ」と「保存が始まって終わらなかった」を見分けられなければ
// いけない (#519)。
//
// この2つは同じ記録しか残していなかった＝どちらも `stage=activate` の行が1本あって、その後に
// 何も続かない。ログを読んだ進捗確認のセッションはこれを3回続けて誤診し、1度は利用者へ誤った
// 警告を出して取り下げるところまでいった。ログは嘘をついていない。答えを持っていないのに、
// そこから答えが読めてしまった。それが根本の原因なので、ここで見るのは「そもそも読める答えが
// あるか」。
//
// #507（待つ足のすべてに上限を置く）が、この半分を埋めた＝上限に当たった保存は失敗として
// 1行を残し、その行は段を名乗る。残っていたのは、① 始まりの行がそもそも無い（上限に当たる
// 前にプロセスが消えると、やはり沈黙する）、② 行どうしを結ぶ識別子が無い、③ やめたことが
// 記録されない、の3つ。ここではその3つを見る。
//
// background 側（`save`/`begin` の行と、失敗の行が運ぶ saveId と reached）は
// scripts/background-wiring.test.ts。中止が4つの画面すべてに記録されること (#507) は
// scripts/capture-timeout.test.ts。リグは scripts/lib-capture-rig.ts。
import { expect, test } from 'vitest';
import { clickPost, makeRig, pressKey, REPLY_UNTIL_SAVE, settle } from './lib-capture-rig.ts';
import { asUser } from './lib-user-event.ts';

// --- ① 起動しただけ --------------------------------------------------------------

test('UI を開いて保存せずに閉じた＝やめたことが行として残る（沈黙ではない）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await settle();

  // 投稿を1つもクリックせずに Esc。これがまさに2回目の誤診の状況＝利用者は「UI を見るために
  // 起動しただけ」だった。
  pressKey(rig, 'Escape');
  await settle();

  const cancel = rig.logged().find((e) => e.phase === 'cancel');
  expect(cancel, `logCapture entries: ${JSON.stringify(rig.logged())}`).toMatchObject({ stage: 'select', phase: 'cancel' });
  // 保存は1件も始まっていない＝この行は「対象を選ばずに閉じた」を意味する。
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
  expect(cancel.saveId ?? null).toBe(null);
});

test('対象を選んだあとに閉じた場合は、選択ではなく保存をやめたことが残る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  expect(rig.state()).toBe('busy'); // 保存が走っている最中

  pressKey(rig, 'Escape');
  await settle();

  const cancel = rig.logged().find((e) => e.phase === 'cancel');
  expect(cancel).toMatchObject({ stage: 'save', phase: 'cancel', url: 'https://x.com/alice/status/111' });
  // 同じ保存の行として結べる＝これが無いと、時刻の近さから推測するしかない。
  const sentSave = rig.sent.find((m) => m.type === 'captureAndSend');
  expect(cancel.saveId).toBe(sentSave.saveId);
  expect(typeof cancel.saveId).toBe('string');
});

test('重複警告に「やめる」と答えたのは失敗でも沈黙でもない＝skip として残る', async () => {
  const rig = makeRig((msg) => (msg.type === 'checkDuplicate' ? { ok: true, duplicate: true, captureId: 'cap-old' } : msg.type === 'captureAndSend' ? undefined : { ok: true }));
  await clickPost(rig);
  expect(rig.state()).toBe('ask');

  const root = (rig.window.document.querySelector('hologram-extension-ui') as any).shadowRoot;
  const skip = Array.from(root.querySelectorAll('button')).at(-1) as any;
  skip.dispatchEvent(asUser(new rig.window.MouseEvent('click', { bubbles: true })));
  await settle();

  expect(rig.logged().at(-1)).toMatchObject({ stage: 'duplicate', phase: 'skip' });
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
});

// --- ② 保存が始まって終わらなかった ---------------------------------------------

test('保存が始まって終わらなかった場合は、やめた場合と違う行が残る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.advance(91_000); // どちらの上限も超える（応答まで10秒・沈黙40秒）
  await settle();

  const entries = rig.logged();
  // 出るのは result/fail。cancel は出ない＝利用者は何もやめていない。
  expect(entries.some((e) => e.phase === 'cancel')).toBe(false);
  const timeout = entries.find((e) => e.stage === 'result' && e.phase === 'fail');
  expect(timeout, `logCapture entries: ${JSON.stringify(entries)}`).toBeTruthy();
  expect(String(timeout.error)).toMatch(/timed out/i);
  expect(timeout.saveId).toBe(rig.sent.find((m) => m.type === 'captureAndSend').saveId);
});

// #507 の調査が答えられなかった問い＝どの足で詰まったか。3つの候補（ワーカーが止まる・
// metadata が止まる・crop が止まる）は、どれも同じ痕跡しか残さなかった。ワーカーが段を
// 抜けるたびに送る報告をページ側が覚えておけば、ワーカーがまるごと消えても、最後の行は
// 「黙る前にどこまで進んだか」を名乗れる。
test('途中まで進んでワーカーが黙った場合、最後の行がどの段まで進んだかを名乗る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  const saveId = rig.sent.find((m) => m.type === 'captureAndSend').saveId;

  // ワーカーが「スクリーンショットと crop は終わった」と報告し、そこで消える。
  rig.push({ type: 'saveProgress', saveId, reached: ['capture'] });
  rig.push({ type: 'saveProgress', saveId, reached: ['capture', 'crop'] });
  await settle();

  rig.advance(91_000);
  await settle();

  const timeout = rig.logged().find((e) => e.stage === 'result' && e.phase === 'fail');
  // ここが #519 の核心＝「何も届かなかった」ではなく「crop の後で黙った」と読める。
  expect(timeout.reached).toEqual(['capture', 'crop']);
});

test('別の保存の進捗報告は取り違えない', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.push({ type: 'saveProgress', saveId: 'someone-elses-save', reached: ['capture', 'crop', 'metadata'] });
  await settle();
  rig.advance(91_000);
  await settle();

  const timeout = rig.logged().find((e) => e.stage === 'result' && e.phase === 'fail');
  expect(timeout.reached).toEqual([]);
});

// --- 終わった保存に cancel が後付けされることはない ----------------------------------------

test('保存が終わったあとの片付けは cancel を書かない', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.push({ type: 'notify', success: true, metaOk: true, metaReason: null, grouped: 0 });
  await settle();
  expect(rig.state()).toBe('success');

  rig.advance(3000); // 成功の表示時間を過ぎて片付けが走る
  await settle();

  expect(rig.logged().some((e) => e.phase === 'cancel')).toBe(false);
});

test('上限で終わったあとの片付けも cancel を書かない（失敗が二重に見えない）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.advance(91_000);
  await settle();
  rig.advance(3000); // 失敗の表示時間を過ぎて片付けが走る
  await settle();

  const entries = rig.logged();
  expect(entries.some((e) => e.phase === 'cancel')).toBe(false);
  expect(entries.filter((e) => e.stage === 'result' && e.phase === 'fail')).toHaveLength(1);
});
