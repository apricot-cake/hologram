// 新しいローカルビルドに合わせて拡張機能が自分を起動し直すかどうかの判断(#650)。
//
// 実機で確かめるのは「合図が届いたら本当に入れ替わるか」で、これは scripts/e2e の
// 領分。ここで見るのは入れ替えてよい瞬間かどうかの判断＝壊れると誰かの作業を黙って
// 消す側で、しかも時間が絡むので実機では再現しにくい。
//
//   1. 一度使ったトークンで二度リロードしない(無限ループに対する唯一の止め弁)
//   2. 保存が飛んでいる間・キャプチャUI が開いている間・一括取込が走っている間は待つ
//   3. 待ちは必ず終わる＝新しい証拠が来ない hold は LOCAL_BUILD_RELOAD_WORK_MS で失効し、
//      保存ごとの期限が保存自身の枠を必ず空ける(deadline.ts)
//
// 時計は注入する＝実時間を待つテストは遅いだけでなく、境界のちょうど上か少し先かを
// 固定できない。

import { describe, expect, test } from 'vitest';
import { LOCAL_BUILD_RELOAD_QUIET_MS, LOCAL_BUILD_RELOAD_WORK_MS, bulkActivity, captureActivity, createLocalBuildReloadGate, shouldReloadFor } from './local-build-reload.ts';

function gateAt(start = 1_000_000) {
  let clock = start;
  let inFlight = 0;
  const gate = createLocalBuildReloadGate({ now: () => clock, savesInFlight: () => inFlight });
  return {
    gate,
    advance(ms: number) {
      clock += ms;
    },
    setInFlight(n: number) {
      inFlight = n;
    },
    // 「今リロードしてよいか」＝background.ts が blockedUntil を読む形そのもの。
    free() {
      return gate.blockedUntil() <= clock;
    },
  };
}

describe('shouldReloadFor — 二重リロードと無関係な環境を弾く', () => {
  test('ローカルビルドIDが無いバンドル（ストア配布）は絶対に発火しない', () => {
    expect(shouldReloadFor('build-b', '', null)).toBe(false);
  });

  test('ホストが印を返さない（ビルドしていない環境）なら発火しない', () => {
    expect(shouldReloadFor(null, 'build-a', null)).toBe(false);
  });

  test('一致していれば発火しない＝ディスク上の物がもう載っている', () => {
    expect(shouldReloadFor('build-a', 'build-a', null)).toBe(false);
  });

  test('食い違えば発火する', () => {
    expect(shouldReloadFor('build-b', 'build-a', null)).toBe(true);
  });

  test('同じトークンで既に一度リロードしていたら、もう発火しない', () => {
    // 注意: これが無限ループに対する唯一の止め弁。別のツリーからビルドすると
    // 「ディスク上の印は変わったが、ブラウザが読んでいるフォルダは変わっていない」
    // が起こりうる＝リロードしても新しい ID にならず、次の応答がまた同じ要求を出す。
    expect(shouldReloadFor('build-b', 'build-a', 'build-b')).toBe(false);
  });

  test('さらに新しいビルドが出れば、また1回だけ発火する', () => {
    expect(shouldReloadFor('build-c', 'build-a', 'build-b')).toBe(true);
  });
});

describe('createLocalBuildReloadGate — 壊してはいけない作業の間は待つ', () => {
  test('何も起きていなければ即座に空いている', () => {
    const h = gateAt();
    expect(h.free()).toBe(true);
  });

  test('保存が飛んでいる間は待つ／終われば静穏時間のあとに空く', () => {
    const h = gateAt();
    h.setInFlight(1);
    expect(h.free()).toBe(false);
    h.advance(LOCAL_BUILD_RELOAD_WORK_MS * 2); // 1つでも飛んでいる限り、いくら時間が経っても待つ
    expect(h.free()).toBe(false);
    h.setInFlight(0);
    expect(h.free()).toBe(true);
  });

  test('キャプチャUI が開いている間は待ち、閉じれば静穏時間で空く', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(7));
    expect(h.free()).toBe(false);
    h.gate.end(captureActivity(7));
    expect(h.free()).toBe(false); // 直後はまだ静穏時間の中
    h.advance(LOCAL_BUILD_RELOAD_QUIET_MS + 1);
    expect(h.free()).toBe(true);
  });

  test('開いたまま放置された UI も上限で失効する＝永久に待たない', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(7)); // Esc も保存もされず、そのまま放置
    h.advance(LOCAL_BUILD_RELOAD_WORK_MS - 1);
    expect(h.free()).toBe(false);
    h.advance(2);
    expect(h.free()).toBe(true);
  });

  test('一括取込は保存ごとに延命され、止まれば上限で失効する', () => {
    const h = gateAt();
    h.gate.begin(bulkActivity(3));
    // 1秒に1件(bulk-capture.ts の MIN_SAVE_PERIOD_MS)＝走っている限り空かない
    for (let i = 0; i < 200; i++) {
      h.advance(1_000);
      h.gate.refresh(bulkActivity(3));
      expect(h.free()).toBe(false);
    }
    // 走りが止まった(利用者がスクロールをやめたか、行が尽きた)
    h.advance(LOCAL_BUILD_RELOAD_WORK_MS + 1);
    expect(h.free()).toBe(true);
  });

  test('refresh は開いていない活動を作らない＝ただの1回の保存が取込扱いにならない', () => {
    const h = gateAt();
    h.gate.refresh(bulkActivity(3)); // 取込は走っていない
    expect(h.free()).toBe(true);
  });

  test('タブが消えれば、そのタブの hold も消える（静穏時間も要らない）', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(7));
    h.gate.begin(bulkActivity(7));
    h.gate.dropTab(7);
    expect(h.free()).toBe(true);
  });

  test('同じタブのキャプチャUI と一括取込は別々の hold＝片方の終了が他方を解かない', () => {
    const h = gateAt();
    h.gate.begin(bulkActivity(5));
    h.gate.begin(captureActivity(5));
    h.gate.end(captureActivity(5));
    h.advance(LOCAL_BUILD_RELOAD_QUIET_MS + 1);
    expect(h.free()).toBe(false); // 取込はまだ走っている
    h.gate.end(bulkActivity(5));
    h.advance(LOCAL_BUILD_RELOAD_QUIET_MS + 1);
    expect(h.free()).toBe(true);
  });

  test('blockedUntil は1作業ぶんより先を指さない＝止まったまま伸び続けない', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(1));
    h.gate.begin(bulkActivity(2));
    h.setInFlight(3);
    expect(h.gate.blockedUntil()).toBeLessThanOrEqual(1_000_000 + LOCAL_BUILD_RELOAD_WORK_MS);
  });
});
