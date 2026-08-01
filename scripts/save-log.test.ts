// capture.log must be able to distinguish "just launched" from "a save started and never finished" (#519).
//
// These two used to leave the same record = both have a single `stage=activate` line
// with nothing following it. A progress-check session reading the log misdiagnosed this
// 3 times in a row, and once even gave the user a false warning and had to retract it.
// **The log wasn't lying — it had no answer, yet an answer could be read out of it**, and
// that's the root cause, so what's checked here is "is there a readable answer at all".
//
// #507 (a cap on every waiting leg) filled half of this = a save that hit its cap
// leaves one line as a failure, and that line names the stage. What was left was ①
// **there's no starting line at all** (still silent if the process disappears before
// hitting the cap), ② there's no identifier tying lines together, and ③ **cancelling
// isn't recorded**. This tests those 3.
//
// The background side (the `save`/`begin` lines, and the saveId and reached carried by
// a failure line) is scripts/background-wiring.test.ts. That an abort is recorded on all
// 4 surfaces (#507) is scripts/capture-timeout.test.ts. The rig is scripts/lib-capture-rig.ts.
import { expect, test } from 'vitest';
import { clickPost, makeRig, pressKey, REPLY_UNTIL_SAVE, settle } from './lib-capture-rig.ts';
import { asUser } from './lib-user-event.ts';

// --- ① just launched ------------------------------------------------------------

test('UI を開いて保存せずに閉じた＝やめたことが行として残る（沈黙ではない）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await settle();

  // Esc without clicking a single post. This is exactly misdiagnosis #2's situation = the
  // user had "just launched it to look at the UI".
  pressKey(rig, 'Escape');
  await settle();

  const cancel = rig.logged().find((e) => e.phase === 'cancel');
  expect(cancel, `logCapture entries: ${JSON.stringify(rig.logged())}`).toMatchObject({ stage: 'select', phase: 'cancel' });
  // Not a single save started = this line means "closed without selecting a target".
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);
  expect(cancel.saveId ?? null).toBe(null);
});

test('対象を選んだあとに閉じた場合は、選択ではなく保存をやめたことが残る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  expect(rig.state()).toBe('busy'); // the save is in flight

  pressKey(rig, 'Escape');
  await settle();

  const cancel = rig.logged().find((e) => e.phase === 'cancel');
  expect(cancel).toMatchObject({ stage: 'save', phase: 'cancel', url: 'https://x.com/alice/status/111' });
  // Can be tied together as lines of the same save = without this, you'd have to guess from how close the timestamps are.
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

// --- ② a save started and never finished ---------------------------------------------

test('保存が始まって終わらなかった場合は、やめた場合と違う行が残る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.advance(91_000); // exceeds both caps (10s to acknowledge, 40s of silence)
  await settle();

  const entries = rig.logged();
  // what appears is result/fail. No cancel appears = the user didn't cancel anything.
  expect(entries.some((e) => e.phase === 'cancel')).toBe(false);
  const timeout = entries.find((e) => e.stage === 'result' && e.phase === 'fail');
  expect(timeout, `logCapture entries: ${JSON.stringify(entries)}`).toBeTruthy();
  expect(String(timeout.error)).toMatch(/timed out/i);
  expect(timeout.saveId).toBe(rig.sent.find((m) => m.type === 'captureAndSend').saveId);
});

// The question the #507 investigation couldn't answer = which leg got stuck. The 3
// candidates (the worker stalling, metadata stalling, crop stalling) all left the same
// evidence behind. If the page remembers the report the worker sends each time it clears
// a stage, then even if the worker disappears entirely, the last line can still name
// "how far it got before going silent".
test('途中まで進んでワーカーが黙った場合、最後の行がどの段まで進んだかを名乗る', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  const saveId = rig.sent.find((m) => m.type === 'captureAndSend').saveId;

  // The worker reports "screenshot and crop are done" and then disappears right there.
  rig.push({ type: 'saveProgress', saveId, reached: ['capture'] });
  rig.push({ type: 'saveProgress', saveId, reached: ['capture', 'crop'] });
  await settle();

  rig.advance(91_000);
  await settle();

  const timeout = rig.logged().find((e) => e.stage === 'result' && e.phase === 'fail');
  // This is the heart of #519 = it reads as "went silent after the crop", not "nothing ever arrived".
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

// --- a completed save never gets a cancel appended ----------------------------------------

test('保存が終わったあとの片付けは cancel を書かない', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.push({ type: 'notify', success: true, metaOk: true, metaReason: null, grouped: 0 });
  await settle();
  expect(rig.state()).toBe('success');

  rig.advance(3000); // past the success dwell time, cleanup runs
  await settle();

  expect(rig.logged().some((e) => e.phase === 'cancel')).toBe(false);
});

test('上限で終わったあとの片付けも cancel を書かない（失敗が二重に見えない）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.advance(91_000);
  await settle();
  rig.advance(3000); // past the failure dwell time, cleanup runs
  await settle();

  const entries = rig.logged();
  expect(entries.some((e) => e.phase === 'cancel')).toBe(false);
  expect(entries.filter((e) => e.stage === 'result' && e.phase === 'fail')).toHaveLength(1);
});
