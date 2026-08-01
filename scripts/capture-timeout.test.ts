// Reproduces the bug where a save gets stuck forever on "Saving..." and pins down its
// timeout (#507).
//
// The 30-second timeout to the native host already existed. What still froze the screen was
// that **the leg where the content script waits for a result** had no upper bound = the moment
// the background goes silent (MV3 service worker stopping, a dropped message, an unbounded wait
// somewhere further down the chain), nobody is left to move the banner off "busy".
//
// What's checked here is "does it always finish" and "is the fact that it finished always
// recorded". Whether **that record could be misread as "just started"** is covered by
// scripts/save-log.test.ts (#519); the jsdom + manual-clock rig is shared as scripts/lib-capture-rig.ts.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { clickPost, makeRig, REPLY_UNTIL_SAVE, settle } from './lib-capture-rig.ts';

// What the waiting side measures is **silence**, not the total save duration (continuing
// #507). Back when there was a single flat 90-second ceiling, there was a reason it had to be
// 90 seconds = since the legs (crop 10s + metadata 20s + host 30s) run in series, a flat ceiling
// has to exceed the sum or it will call a slow-but-fine save a failure. The worker pushes one
// line per leg boundary (saveProgress), so the waiting side only needs to wait for "the next
// line" = it splits into two short questions: 10 seconds to acknowledge, 40 seconds of silence.
const ackOf = (rig: { sent: any[] }) => rig.sent.find((m) => m.type === 'captureAndSend').saveId;

test('バックグラウンドが受領すら返さなければ、10 秒で終わる（永久に「保存中...」にしない）', async () => {
  // Only captureAndSend goes unanswered = exactly the state where the background goes silent.
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');

  // Don't give up before the acknowledgment ceiling = don't call it a failure right after clicking.
  rig.advance(9_000);
  await settle();
  expect(rig.state()).toBe('busy');

  rig.advance(1_500); // Past the 10-second acknowledgment ceiling
  await settle();
  expect(rig.state()).toBe('error');
  // The banner follows the browser's locale = jsdom is en. i18n-parity.test.ts checks that the
  // same wording exists in the Japanese version too. Here we only confirm that "the next step
  // is written down" = #507's requirement was to not just end with "it failed".
  expect(rig.text()).toContain('Try again');
});

test('受領が来たら、遅い保存を失敗と呼ばない（脚の合計を越えても待つ）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  const saveId = ackOf(rig);

  // The worker signals "received" = from here what's measured becomes silence.
  rig.push({ type: 'saveProgress', saveId, reached: [] });
  rig.advance(30_000); // Already past the acknowledgment-only ceiling (10 seconds)
  await settle();
  expect(rig.state()).toBe('busy');

  // Reset the wait every time a leg is crossed = a save going well past even the heaviest
  // measured case (4 images, 12.4s), let alone the old flat 90-second ceiling, isn't cut off.
  for (const stage of ['capture', 'crop', 'metadata', 'bridge']) {
    rig.push({ type: 'saveProgress', saveId, reached: [stage] });
    rig.advance(30_000);
    await settle();
    expect(rig.state(), `${stage} を報告した直後に打ち切られた`).toBe('busy');
  }

  // If silence continues after the last line, it ends = 40 seconds, longer than the host's 30.
  rig.advance(41_000);
  await settle();
  expect(rig.state()).toBe('error');
});

test('別の保存の進捗では待ち直さない（他のタブに固まりを支えさせない）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  rig.push({ type: 'saveProgress', saveId: 'someone-else', reached: ['metadata'] });
  rig.advance(11_000);
  await settle();
  expect(rig.state()).toBe('error');
});

test('タイムアウトは capture.log へ残す（どちらの上限で終えたかも書く）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  rig.advance(11_000);
  await settle();

  const logged = rig.sent.filter((m) => m.type === 'logCapture').map((m) => m.entry);
  const timeout = logged.find((e) => e.phase === 'fail' && e.stage === 'result');
  expect(timeout, `logCapture entries: ${JSON.stringify(logged)}`).toBeTruthy();
  expect(String(timeout.error)).toMatch(/timed out/i);
  // "Never received" and "received, then went silent" have different causes = the former is
  // no worker at all, the latter is a worker that's alive but stuck on a leg. The line must say which.
  expect(String(timeout.error)).toMatch(/never acknowledged/i);
});

test('サービスワーカーが落ちてチャネルが閉じたら、見張りを待たずに終わる', async () => {
  // The callback fires with no response = the shape Chrome uses to say "the port closed with no
  // reply". This actually happens when the MV3 worker stops mid-save.
  const rig = makeRig((msg) => {
    if (msg.type === 'checkDuplicate') return { ok: true, duplicate: false };
    if (msg.type === 'captureAndSend') {
      rig.window.chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
      return null;
    }
    return { ok: true };
  });
  await clickPost(rig);
  await settle();
  expect(rig.state()).toBe('error');
});

test('重複の問い合わせに誰も答えなければ、上限で普通に保存へ進む（fail open）', async () => {
  // The round-trip #34 added before the save. If this goes silent, the click handler has
  // already been detached but the screen still says "please click" = nothing you press does anything.
  const rig = makeRig((msg) => (msg.type === 'checkDuplicate' ? undefined : msg.type === 'captureAndSend' ? undefined : { ok: true }));
  await clickPost(rig);
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);

  rig.advance(13_000);
  for (let i = 0; i < 20; i++) await settle();
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');
});

// --- A timeout is always recorded (across all 4 surfaces) -------------------------------
//
// When the ceiling was first added, only the Alt+S surface wrote a line to `capture.log`.
// The surface users actually reported freezing on was the **hover-save button**, which is a
// resident script — it doesn't even emit an activate line, so a timeout there left the record
// completely silent. "Declaring that it's over" and "traceable afterward" are two different
// things, and the latter was missing from just one surface.
//
// Instead of standing up 4 separate jsdom harnesses per surface, this checks the broken
// invariant directly = **wherever a ceiling is armed, a timeout must be recorded**. This
// catches the regression shape of a new surface forgetting to record (the content of the
// record itself is checked by the unit test below).
describe('打ち切りは必ず記録される（#507 の穴）', () => {
  const UTILS = path.join(import.meta.dirname, '..', 'extension', 'utils');
  const SURFACES = ['capture.ts', 'overlay.ts', 'drag.ts', 'bulk-capture.ts'];

  // Check with comments stripped out. When this invariant was first written, a file where the
  // call was just commented out on one line slipped through = "it's written" and "it's called"
  // are different things, and only the latter actually produces a record.
  const code = (file: string) =>
    fs
      .readFileSync(path.join(UTILS, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  test.each(SURFACES)('%s は上限を張り、かつ打ち切りを記録する', (file) => {
    const source = code(file);
    expect(source, `${file} が保存の上限を張らなくなった＝この不変条件の対象から外れたなら SURFACES を直す`).toMatch(/startSaveDeadline\(/);
    expect(source, `${file} が capture-log を読み込んでいない`).toMatch(/from '\.\/capture-log\.ts'/);
    expect(source, `${file} は上限を張るのに reportSaveTimeout() を呼んでいない＝打ち切りが capture.log に残らない`).toMatch(/reportSaveTimeout\(/);
  });

  test('上限を張るファイルを数え漏らしていない', () => {
    const armed = fs
      .readdirSync(UTILS)
      // deadline.ts is the numeric value, save-deadline.ts is the wait mechanism itself = neither is a surface.
      .filter((f) => f.endsWith('.ts') && f !== 'deadline.ts' && f !== 'save-deadline.ts')
      .filter((f) => code(f).includes('startSaveDeadline'));
    expect(armed.sort()).toEqual([...SURFACES].sort());
  });
});

describe('reportSaveTimeout が出す行', () => {
  test('stage=result / phase=fail と、どの面かを載せる', async () => {
    const sent: any[] = [];
    vi.stubGlobal('chrome', { runtime: { sendMessage: (m: any) => sent.push(m) } });
    const { reportSaveTimeout } = await import('../extension/utils/capture-log.ts');
    reportSaveTimeout('hover-save', 'x', 'https://x.com/alice/status/111', 'save timed out — no result');

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('logCapture');
    expect(sent[0].entry).toMatchObject({
      stage: 'result',
      phase: 'fail',
      via: 'hover-save',
      platform: 'x',
      url: 'https://x.com/alice/status/111',
    });
    // The raw diagnostic text goes in as-is = separate from the wording shown to the user (the log is for developers)
    expect(String(sent[0].entry.error)).toMatch(/timed out/i);
    vi.unstubAllGlobals();
  });

  test('バックグラウンドが居なくても投げない（診断は保存を邪魔しない）', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: () => {
          throw new Error('Extension context invalidated.');
        },
      },
    });
    const { reportSaveTimeout } = await import('../extension/utils/capture-log.ts');
    expect(() => reportSaveTimeout('drop-zone', 'x', null, 'boom')).not.toThrow();
    vi.unstubAllGlobals();
  });
});
