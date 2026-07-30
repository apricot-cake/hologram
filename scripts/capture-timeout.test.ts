// 保存が「保存中...」のまま永久に終わらない不具合の再現と、その上限（#507）。
//
// ネイティブホストへの 30 秒はもともと在った。それでも画面が固まったのは、
// **コンテンツスクリプトが結果を待つ脚**に上限が無かったから＝バックグラウンドが
// 黙った瞬間（MV3 のサービスワーカー停止・メッセージの取りこぼし・その先の
// どこかの無期限待ち）、バナーを busy から動かす者が誰も居なくなる。
//
// ここが見るのは「必ず終わるか」と「終わったことが必ず記録されるか」。
// **その記録が「起動しただけ」と読み違えられないか**は scripts/save-log.test.ts
// （#519）で、jsdom ＋ 手動クロックの装置は共通の scripts/lib-capture-rig.ts。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { clickPost, makeRig, REPLY_UNTIL_SAVE, settle } from './lib-capture-rig.ts';

// 待つ側が測るのは**沈黙**で、保存の総時間ではない（#507 の続き）。
// 上限がひとつの平らな 90 秒だったころ、90 秒でなければならない理由があった＝
// 脚（crop 10s ＋ メタデータ 20s ＋ ホスト 30s）は直列なので、平らな上限は合計を
// 越えないと遅い保存を失敗と呼んでしまう。ワーカーは脚の切れ目ごとに1行
// 押してくる（saveProgress）ので、待つ側は「次の1行」を待てば足りる＝
// 受領 10 秒・沈黙 40 秒という短い2問に分かれる。
const ackOf = (rig: { sent: any[] }) => rig.sent.find((m) => m.type === 'captureAndSend').saveId;

test('バックグラウンドが受領すら返さなければ、10 秒で終わる（永久に「保存中...」にしない）', async () => {
  // captureAndSend にだけ答えない＝バックグラウンドが黙った状態そのもの。
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');

  // 受領の上限より手前では諦めない＝押した直後に失敗と言い出さないこと。
  rig.advance(9_000);
  await settle();
  expect(rig.state()).toBe('busy');

  rig.advance(1_500); // 受領の 10 秒を越える
  await settle();
  expect(rig.state()).toBe('error');
  // バナーはブラウザのロケールに従う＝jsdom は en。日本語版の同じ文言は
  // i18n-parity.test.ts が両言語に在ることを見る。ここは「次の一手が書いてある」
  // ことだけを確かめる＝「失敗しました」で終わらせないのが #507 の要求。
  expect(rig.text()).toContain('Try again');
});

test('受領が来たら、遅い保存を失敗と呼ばない（脚の合計を越えても待つ）', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  const saveId = ackOf(rig);

  // ワーカーが「受け取った」と告げる＝ここから測るのは沈黙になる。
  rig.push({ type: 'saveProgress', saveId, reached: [] });
  rig.advance(30_000); // 受領だけの上限（10 秒）はもう越えている
  await settle();
  expect(rig.state()).toBe('busy');

  // 脚を通過するたびに待ち直す＝実測の最重量（4枚・12.4 秒）どころか、
  // 平らな上限だった 90 秒を越えて進む保存も打ち切られない。
  for (const stage of ['capture', 'crop', 'metadata', 'bridge']) {
    rig.push({ type: 'saveProgress', saveId, reached: [stage] });
    rig.advance(30_000);
    await settle();
    expect(rig.state(), `${stage} を報告した直後に打ち切られた`).toBe('busy');
  }

  // 最後の1行から沈黙が続けば終わる＝ホストの 30 秒より長い 40 秒。
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
  // 「受け取られなかった」と「受け取ったあと黙った」は原因が別＝前者は居ない
  // ワーカー、後者は生きているが脚で止まったワーカー。行がどちらか言うこと。
  expect(String(timeout.error)).toMatch(/never acknowledged/i);
});

test('サービスワーカーが落ちてチャネルが閉じたら、見張りを待たずに終わる', async () => {
  // 応答なしでコールバックだけ呼ばれる＝Chrome が「返事なしでポートが閉じた」と
  // 告げる形。MV3 でワーカーが保存の途中で停止したときに実際に起きる。
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
  // #34 が保存の前に足した往復。ここで黙られると、クリックの受け口はもう外され
  // ているのに画面は「クリックしてください」のまま＝何を押しても動かない。
  const rig = makeRig((msg) => (msg.type === 'checkDuplicate' ? undefined : msg.type === 'captureAndSend' ? undefined : { ok: true }));
  await clickPost(rig);
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(false);

  rig.advance(13_000);
  for (let i = 0; i < 20; i++) await settle();
  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');
});

// --- 打ち切りが記録に残ること（4つの面すべて） -------------------------------
//
// 上限を最初に入れたとき、`capture.log` へ1行書いていたのは Alt+S の面だけだった。
// ユーザーが実際に固まりを報告したのは**ホバー保存ボタン**の面で、そちらは常駐
// スクリプトなので activate の行すら出ない＝打ち切っても記録が完全に無音になる。
// 「終わりを宣言する」と「後から追える」は別の話で、後者が1面だけ欠けていた。
//
// 面ごとに jsdom のハーネスを4つ立てる代わりに、壊れた不変条件そのものを見る＝
// **上限を張る場所は、必ず打ち切りを記録する**。増えた面が記録を忘れる形の退行は
// これで捕まる（記録の中身は下の単体テストが見る）。
describe('打ち切りは必ず記録される（#507 の穴）', () => {
  const UTILS = path.join(import.meta.dirname, '..', 'extension', 'utils');
  const SURFACES = ['capture.ts', 'overlay.ts', 'drag.ts', 'bulk-capture.ts'];

  // コメントを落としてから見る。この不変条件を最初に書いたとき、呼び出しを1行
  // コメントアウトしただけのファイルが素通りした＝「書いてある」と「呼んでいる」は
  // 別物で、後者だけが記録を出す。
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
      // deadline.ts は数値、save-deadline.ts は待ち方そのもの＝どちらも面ではない。
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
    // 生の診断文がそのまま入る＝ユーザーへ見せる文言とは別物（ログは開発者が読む）
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
