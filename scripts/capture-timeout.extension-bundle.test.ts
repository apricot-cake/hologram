// 保存が「保存中...」のまま永久に止まる不具合を再現し、その打ち切りを固定する (#507)。
//
// native host への 30 秒の打ち切りは既にあった。それでも画面が凍っていたのは、content script が
// 結果を待つ足に上限が無かったから＝background が黙った瞬間（MV3 のサービスワーカーの停止・
// 落ちたメッセージ・鎖の先のどこかにある無制限の待ち）、バナーを busy から動かす者が誰も
// 居なくなる。
//
// ここで見るのは「必ず終わるか」と「終わったという事実が必ず記録されるか」。その記録が
// 「始まっただけ」と誤読されうるかどうかは scripts/save-log.test.ts (#519) が覆う。
// jsdom と手動の時計のリグは scripts/lib-capture-rig.ts として共有している。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { clickPost, makeRig, REPLY_UNTIL_SAVE, settle } from './lib-capture-rig.ts';

// 待つ側が測るのは保存全体の長さではなく、沈黙の長さ（#507 の続き）。90 秒の平らな上限が1本
// だけだった頃、それが 90 秒でなければならなかった理由がある＝足（crop 10秒 + metadata 20秒 +
// host 30秒）は直列に走るので、平らな上限はその合計を超えないと、遅いだけの正常な保存を失敗と
// 呼んでしまう。ワーカーは足の境目ごとに1行を押し出す (saveProgress) ので、待つ側は「次の行」を
// 待てば足りる＝短い2つの問いに分かれる。応答まで10秒、沈黙40秒。
const ackOf = (rig: { sent: any[] }) => rig.sent.find((m) => m.type === 'captureAndSend').saveId;

test('バックグラウンドが受領すら返さなければ、10 秒で終わる（永久に「保存中...」にしない）', async () => {
  // captureAndSend だけが返ってこない＝background が黙る状態そのもの。
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');

  // 受領の上限より前には諦めない＝クリックした直後に失敗と呼ばない。
  rig.advance(9_000);
  await settle();
  expect(rig.state()).toBe('busy');

  rig.advance(1_500); // 受領の上限（10秒）を越える
  await settle();
  expect(rig.state()).toBe('error');
  // バナーはブラウザのロケールに従う＝jsdom は en。同じ文言が日本語版にもあることは
  // i18n-parity.test.ts が見る。ここで確かめるのは「次にどうすればよいかが書かれている」こと
  // だけ＝#507 の要求は、「失敗した」で終わらせないことだった。
  expect(rig.text()).toContain('Try again');
});

test('受領が来たら、遅い保存を失敗と呼ばない（脚の合計を越えても待つ）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  const saveId = ackOf(rig);

  // ワーカーが「受け取った」と告げる＝ここから測る対象が沈黙に変わる。
  rig.push({ type: 'saveProgress', saveId, reached: [] });
  rig.advance(30_000); // 受領だけの上限（10秒）は既に越えている
  await settle();
  expect(rig.state()).toBe('busy');

  // 足を1つ越えるたびに待ちを引き直す＝実測でいちばん重かったケース（画像4枚・12.4秒）は
  // もちろん、旧来の平らな 90 秒の上限をはるかに越える保存も打ち切らない。
  for (const stage of ['capture', 'crop', 'metadata', 'bridge']) {
    rig.push({ type: 'saveProgress', saveId, reached: [stage] });
    rig.advance(30_000);
    await settle();
    expect(rig.state(), `${stage} を報告した直後に打ち切られた`).toBe('busy');
  }

  // 最後の行のあとも沈黙が続けば終わる＝ホストの 30 秒より長い 40 秒。
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
  // 「一度も受け取られなかった」と「受け取られたあと黙った」は原因が違う＝前者はワーカーが
  // そもそも居ない、後者はワーカーは生きていて足のどこかで詰まっている。行はどちらかを言わ
  // なければいけない。
  expect(String(timeout.error)).toMatch(/never acknowledged/i);
});

test('サービスワーカーが落ちてチャネルが閉じたら、見張りを待たずに終わる', async () => {
  // 応答が無いままコールバックだけ呼ばれる＝Chrome が「返信の無いままポートが閉じた」と
  // 告げるときの形。MV3 のワーカーが保存の途中で停止すると、実際にこうなる。
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
  // #34 が保存の手前に足した往復。ここが黙ると、クリックのハンドラは既に外れているのに画面は
  // 「クリックしてください」と言い続ける＝何を押しても何も起きない。
  const rig = makeRig((msg) => (msg.type === 'checkDuplicate' ? undefined : msg.type === 'captureAndSend' ? undefined : { ok: true }));
  await clickPost(rig);
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);

  rig.advance(13_000);
  for (let i = 0; i < 20; i++) await settle();
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');
});

// --- 打ち切りは必ず記録される（4つの画面すべてで） ---------------------------------------
//
// 上限を最初に足したとき、`capture.log` へ行を書いていたのは Alt+S の画面だけだった。利用者が
// 実際に固まると報告した画面はホバー保存のボタンで、こちらは常駐のスクリプト＝activate の行
// すら出さないので、そこでの打ち切りは記録の上で完全に沈黙していた。「終わったと告げる」ことと
// 「あとから追える」ことは別で、後者が1つの画面だけ欠けていた。
//
// 画面ごとに jsdom のハーネスを4つ立てる代わりに、壊れていた不変条件を直に見る＝上限を張って
// いる場所では、打ち切りが必ず記録される。これで、新しい画面が記録を忘れるという後退の形を
// 捕まえられる（記録の中身そのものは、下の単体テストが見る）。
describe('打ち切りは必ず記録される（#507 の穴）', () => {
  const UTILS = path.join(import.meta.dirname, '..', 'extension', 'utils');
  const SURFACES = ['capture.ts', 'overlay.ts', 'drag.ts', 'bulk-capture.ts'];

  // コメントを取り除いてから見る。この不変条件を書いた当初、呼び出しが1行コメントアウトされて
  // いるだけのファイルが素通りした＝「書いてある」と「呼ばれている」は別で、記録を実際に
  // 生むのは後者だけ。
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
      // deadline.ts は数値そのもの、save-deadline.ts は待ちの仕組みそのもの＝どちらも画面ではない。
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
    // 診断の生テキストがそのまま入る＝利用者へ見せる文言とは別（ログは開発者のためのもの）
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
