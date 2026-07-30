// capture.log が「起動しただけ」と「保存が始まって終わらなかった」を区別できること（#519）。
//
// この2つは同じ記録だった＝どちらも `stage=activate` の1行が在って、その後に何も
// 続かない。ログを読んだ進捗管理セッションが3回続けて誤診し、うち1回はユーザーへ
// 誤った警告を出して撤回している。**ログが嘘をついたのではなく、答えを持っていない
// のに答えを読み取れた**のが原因なので、ここで見るのは「読み取れる答えが在るか」。
//
// #507（待つ脚すべてに上限）はこの半分を埋めた＝上限に達した保存は失敗として1行
// 残り、その行が段を名乗る。残っていたのは①**始まりの行が無い**こと（上限に達する
// 前・プロセスごと消えた場合は今も無音）②行を結ぶ識別子が無いこと ③**やめたことが
// 記録されない**こと。ここが見るのはその3つ。
//
// バックグラウンド側（`save`/`begin` の行・失敗の行が運ぶ saveId と reached）は
// scripts/background-wiring.test.ts。打ち切りが4つの面すべてで記録されること（#507）は
// scripts/capture-timeout.test.ts。装置は scripts/lib-capture-rig.ts。
import { expect, test } from 'vitest';
import { clickPost, makeRig, pressKey, REPLY_UNTIL_SAVE, settle } from './lib-capture-rig.ts';
import { asUser } from './lib-user-event.ts';

// --- ① 起動しただけ ------------------------------------------------------------

test('UI を開いて保存せずに閉じた＝やめたことが行として残る（沈黙ではない）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await settle();

  // 投稿を1つもクリックせずに Esc。これが誤読その2の状況そのもの＝ユーザーは
  // 「UI を見るために起動しただけ」だった。
  pressKey(rig, 'Escape');
  await settle();

  const cancel = rig.logged().find((e) => e.phase === 'cancel');
  expect(cancel, `logCapture entries: ${JSON.stringify(rig.logged())}`).toMatchObject({ stage: 'select', phase: 'cancel' });
  // 保存は1件も始まっていない＝この行は「対象を選ばないまま閉じた」を意味する。
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
  expect(cancel.saveId ?? null).toBe(null);
});

test('対象を選んだあとに閉じた場合は、選択ではなく保存をやめたことが残る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  expect(rig.state()).toBe('busy'); // 保存は飛んでいる

  pressKey(rig, 'Escape');
  await settle();

  const cancel = rig.logged().find((e) => e.phase === 'cancel');
  expect(cancel).toMatchObject({ stage: 'save', phase: 'cancel', url: 'https://x.com/alice/status/111' });
  // 同じ保存の行として結べる＝これが無いと時刻の近さで推測するしかない。
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

  rig.advance(91_000); // 90 秒の見張りを越える
  await settle();

  const entries = rig.logged();
  // 出るのは result/fail。cancel は出ない＝ユーザーは何もやめていない。
  expect(entries.some((e) => e.phase === 'cancel')).toBe(false);
  const timeout = entries.find((e) => e.stage === 'result' && e.phase === 'fail');
  expect(timeout, `logCapture entries: ${JSON.stringify(entries)}`).toBeTruthy();
  expect(String(timeout.error)).toMatch(/timed out/i);
  expect(timeout.saveId).toBe(rig.sent.find((m) => m.type === 'captureAndSend').saveId);
});

// #507 の調査が答えられなかった問い＝どの脚で詰まったのか。3つの候補（ワーカーの
// 停止・メタデータの停止・crop の停止）が同じ証跡を残していた。段を通過するたび
// ワーカーが送る報告をページが覚えておけば、ワーカーごと消えても最後の行が
// 「どこまで進んで黙ったか」を名乗れる。
test('途中まで進んでワーカーが黙った場合、最後の行がどの段まで進んだかを名乗る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  const saveId = rig.sent.find((m) => m.type === 'captureAndSend').saveId;

  // ワーカーが「スクリーンショットと切り抜きは終わった」と報告し、そこで消える。
  rig.push({ type: 'saveProgress', saveId, reached: ['capture'] });
  rig.push({ type: 'saveProgress', saveId, reached: ['capture', 'crop'] });
  await settle();

  rig.advance(91_000);
  await settle();

  const timeout = rig.logged().find((e) => e.stage === 'result' && e.phase === 'fail');
  // ここが #519 の芯＝「何も来なかった」ではなく「切り抜きの後で黙った」と読める。
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

// --- 終わった保存には cancel を足さない ----------------------------------------

test('保存が終わったあとの片付けは cancel を書かない', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.push({ type: 'notify', success: true, metaOk: true, metaReason: null, grouped: 0 });
  await settle();
  expect(rig.state()).toBe('success');

  rig.advance(3000); // 成功の滞留を越えて cleanup が走る
  await settle();

  expect(rig.logged().some((e) => e.phase === 'cancel')).toBe(false);
});

test('上限で終わったあとの片付けも cancel を書かない（失敗が二重に見えない）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.advance(91_000);
  await settle();
  rig.advance(3000); // 失敗の滞留を越えて cleanup が走る
  await settle();

  const entries = rig.logged();
  expect(entries.some((e) => e.phase === 'cancel')).toBe(false);
  expect(entries.filter((e) => e.stage === 'result' && e.phase === 'fail')).toHaveLength(1);
});
