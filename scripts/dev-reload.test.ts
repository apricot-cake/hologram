// 新しいローカルビルドで拡張が自分をリロードする判断（#650）。
//
// 実機で確かめるのは「ビーコンが届いたら本当に入れ替わるか」で、それは
// scripts/e2e 相当の話。ここが見るのは**入れ替えてよい瞬間かどうか**＝壊すと
// 静かに人の作業を消す側の判断で、しかも時間が絡むので実機では再現しづらい。
//
//   1. 一度使ったトークンで二度リロードしない（無限ループの唯一の止め弁）
//   2. 保存中・キャプチャUI が開いている間・一括取込の走行中は待つ
//   3. **待ちは必ず切れる**＝証拠が来なくなった hold は DEV_RELOAD_WORK_MS で失効し、
//      保存の枠は各レグの期限で必ず解放される（deadline.ts）
//
// 時間は注入する＝実時間で待つテストは遅いだけでなく、境界のちょうど上か下かを
// 決められない。

import { describe, expect, test } from 'vitest';
import { DEV_RELOAD_QUIET_MS, DEV_RELOAD_WORK_MS, bulkActivity, captureActivity, createDevReloadGate, shouldReloadFor } from '../extension/utils/dev-reload.ts';

function gateAt(start = 1_000_000) {
  let clock = start;
  let inFlight = 0;
  const gate = createDevReloadGate({ now: () => clock, savesInFlight: () => inFlight });
  return {
    gate,
    advance(ms: number) {
      clock += ms;
    },
    setInFlight(n: number) {
      inFlight = n;
    },
    // 「今リロードしてよいか」＝ background.ts が blockedUntil をこう読む。
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
    // ⚠️ここが無限ループの唯一の止め弁。別ツリーでビルドすると「ディスク上の印は
    // 変わったが、ブラウザが読んでいるフォルダは変わっていない」が成立する＝
    // リロードしても新しい ID にならず、次の返信がまた同じ要求を出す。
    expect(shouldReloadFor('build-b', 'build-a', 'build-b')).toBe(false);
  });

  test('さらに新しいビルドが出れば、また1回だけ発火する', () => {
    expect(shouldReloadFor('build-c', 'build-a', 'build-b')).toBe(true);
  });
});

describe('createDevReloadGate — 壊してはいけない作業の間は待つ', () => {
  test('何も起きていなければ即座に空いている', () => {
    const h = gateAt();
    expect(h.free()).toBe(true);
  });

  test('保存が飛んでいる間は待つ／終われば静穏時間のあとに空く', () => {
    const h = gateAt();
    h.setInFlight(1);
    expect(h.free()).toBe(false);
    h.advance(DEV_RELOAD_WORK_MS * 2); // どれだけ経っても飛んでいる限り待つ
    expect(h.free()).toBe(false);
    h.setInFlight(0);
    expect(h.free()).toBe(true);
  });

  test('キャプチャUI が開いている間は待ち、閉じれば静穏時間で空く', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(7));
    expect(h.free()).toBe(false);
    h.gate.end(captureActivity(7));
    expect(h.free()).toBe(false); // 直後はまだ静穏時間
    h.advance(DEV_RELOAD_QUIET_MS + 1);
    expect(h.free()).toBe(true);
  });

  test('開いたまま放置された UI も上限で失効する＝永久に待たない', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(7)); // Esc も保存もされないまま放置
    h.advance(DEV_RELOAD_WORK_MS - 1);
    expect(h.free()).toBe(false);
    h.advance(2);
    expect(h.free()).toBe(true);
  });

  test('一括取込は保存ごとに延命され、止まれば上限で失効する', () => {
    const h = gateAt();
    h.gate.begin(bulkActivity(3));
    // 1秒ごとに1件（bulk-capture.ts の MIN_SAVE_PERIOD_MS）＝走っている限り空かない
    for (let i = 0; i < 200; i++) {
      h.advance(1_000);
      h.gate.refresh(bulkActivity(3));
      expect(h.free()).toBe(false);
    }
    // 走行が止まった（ユーザーがスクロールをやめた・行が尽きた）
    h.advance(DEV_RELOAD_WORK_MS + 1);
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
    h.advance(DEV_RELOAD_QUIET_MS + 1);
    expect(h.free()).toBe(false); // 取込はまだ走っている
    h.gate.end(bulkActivity(5));
    h.advance(DEV_RELOAD_QUIET_MS + 1);
    expect(h.free()).toBe(true);
  });

  test('blockedUntil は1作業ぶんより先を指さない＝止まったまま伸び続けない', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(1));
    h.gate.begin(bulkActivity(2));
    h.setInFlight(3);
    expect(h.gate.blockedUntil()).toBeLessThanOrEqual(1_000_000 + DEV_RELOAD_WORK_MS);
  });
});
