// The judgment of when the extension reloads itself for a new local build (#650).
//
// What's confirmed on a real device is "does it actually get swapped in once
// the beacon arrives", which is a scripts/e2e-level concern. What this checks
// is **whether it's the right moment to swap in** = the judgment on the side
// that, if broken, silently wipes out someone's work, and since time is
// involved, this is hard to reproduce on a real device.
//
//   1. Never reload twice for the same token once used (the sole stop-valve against an infinite loop)
//   2. Wait while a save is in flight, the capture UI is open, or a bulk intake is running
//   3. **The wait always ends** = a hold with no incoming evidence expires after
//      DEV_RELOAD_WORK_MS, and each save leg's own deadline always frees the save's own slot (deadline.ts)
//
// Time is injected = a test that waits on real time isn't just slow, it also
// can't pin down whether it lands exactly on or just past a boundary.

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
    // "Is it okay to reload right now" = this is how background.ts reads blockedUntil.
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
    // Warning: this is the sole stop-valve against an infinite loop. Building
    // from a different tree can produce "the mark on disk changed, but the
    // folder the browser is reading from didn't" = reloading doesn't produce a
    // new ID, so the next reply issues the same request all over again.
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
    h.advance(DEV_RELOAD_WORK_MS * 2); // waits no matter how much time passes as long as one is in flight
    expect(h.free()).toBe(false);
    h.setInFlight(0);
    expect(h.free()).toBe(true);
  });

  test('キャプチャUI が開いている間は待ち、閉じれば静穏時間で空く', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(7));
    expect(h.free()).toBe(false);
    h.gate.end(captureActivity(7));
    expect(h.free()).toBe(false); // still within the quiet period right after
    h.advance(DEV_RELOAD_QUIET_MS + 1);
    expect(h.free()).toBe(true);
  });

  test('開いたまま放置された UI も上限で失効する＝永久に待たない', () => {
    const h = gateAt();
    h.gate.begin(captureActivity(7)); // left as-is, with neither Esc nor a save
    h.advance(DEV_RELOAD_WORK_MS - 1);
    expect(h.free()).toBe(false);
    h.advance(2);
    expect(h.free()).toBe(true);
  });

  test('一括取込は保存ごとに延命され、止まれば上限で失効する', () => {
    const h = gateAt();
    h.gate.begin(bulkActivity(3));
    // one every second (bulk-capture.ts's MIN_SAVE_PERIOD_MS) = doesn't free up as long as it's running
    for (let i = 0; i < 200; i++) {
      h.advance(1_000);
      h.gate.refresh(bulkActivity(3));
      expect(h.free()).toBe(false);
    }
    // the run stopped (the user stopped scrolling, or ran out of rows)
    h.advance(DEV_RELOAD_WORK_MS + 1);
    expect(h.free()).toBe(true);
  });

  test('refresh は開いていない活動を作らない＝ただの1回の保存が取込扱いにならない', () => {
    const h = gateAt();
    h.gate.refresh(bulkActivity(3)); // no intake is running
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
    expect(h.free()).toBe(false); // the intake is still running
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
