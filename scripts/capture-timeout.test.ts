// 保存が「保存中...」のまま永久に終わらない不具合の再現と、その上限（#507）。
//
// ネイティブホストへの 30 秒はもともと在った。それでも画面が固まったのは、
// **コンテンツスクリプトが結果を待つ脚**に上限が無かったから＝バックグラウンドが
// 黙った瞬間（MV3 のサービスワーカー停止・メッセージの取りこぼし・その先の
// どこかの無期限待ち）、バナーを busy から動かす者が誰も居なくなる。
//
// ここが見るのは「必ず終わるか」。**終わったことが記録に残るか**は
// scripts/save-log.test.ts（#519）で、装置（jsdom ＋ 手動クロック）は共通の
// scripts/lib-capture-rig.ts。

import { expect, test } from 'vitest';
import { clickPost, makeRig, REPLY_UNTIL_SAVE, settle } from './lib-capture-rig.ts';

test('保存要求に誰も答えなければ、上限で必ず終わる（永久に「保存中...」にしない）', async () => {
  // captureAndSend にだけ答えない＝バックグラウンドが黙った状態そのもの。
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);

  expect(rig.sent.some((m) => m.type === 'captureAndSend')).toBe(true);
  expect(rig.state()).toBe('busy');

  // 正常な保存を巻き添えにしないこと＝バックグラウンド側の予算（crop 10s ＋
  // メタデータ 20s ＋ ネイティブホスト 30s）を跨いでもまだ待っている。
  rig.advance(60_000);
  await settle();
  expect(rig.state()).toBe('busy');

  rig.advance(31_000); // 90 秒の見張りを越える
  await settle();
  expect(rig.state()).toBe('error');
  // バナーはブラウザのロケールに従う＝jsdom は en。日本語版の同じ文言は
  // i18n-parity.test.ts が両言語に在ることを見る。ここは「次の一手が書いてある」
  // ことだけを確かめる＝「失敗しました」で終わらせないのが #507 の要求。
  expect(rig.text()).toContain('Try again');
});

test('タイムアウトは capture.log へ残す', async () => {
  const rig = makeRig(REPLY_UNTIL_SAVE);
  await clickPost(rig);
  rig.advance(91_000);
  await settle();

  const logged = rig.sent.filter((m) => m.type === 'logCapture').map((m) => m.entry);
  const timeout = logged.find((e) => e.phase === 'fail' && e.stage === 'result');
  expect(timeout, `logCapture entries: ${JSON.stringify(logged)}`).toBeTruthy();
  expect(String(timeout.error)).toMatch(/timed out/i);
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
