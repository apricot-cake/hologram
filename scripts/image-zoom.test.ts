// Unit tests for services/image-zoom.ts (#150 image view toolbar).
//
// What we pin down here is the "numbers" side, excluding rendering that's only
// visible in the real Electron app =
// (1) wheel and toolbar +/- step the same zoom ladder (2) the displayed % is
// normalized so natural size = 100% (react-zoom-pan-pinch's scale is based on
// fit=1, so outputting the raw scale would give a different number per image
// meaning) (3) no division-by-zero / NaN while naturalWidth hasn't arrived yet
// (4) the fit<->actual-size toggle stays the current double-click behavior of
// "small images don't mean anything at actual size, so use a fixed zoom".
//
// Controller registration is the sole source of truth for "is there a zoomable
// surface right now" (video and ugoira slides don't render Zoomable, so there's
// no registration), so this also covers the register/unregister bookkeeping and
// that Ctrl+0 / Ctrl+1 fire based on that. Whether the picture actually moved is
// the real renderer's territory (scripts/test-app-image-zoom.cts).

import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as Z from '../app/src/renderer/src/services/image-zoom';

describe('倍率ラダー: ホイール1ノッチとボタン1押しが同じ段', () => {
  test('＋1段は ZOOM_STEP 倍・−1段はその逆数', () => {
    expect(Z.steppedScale(1, 1)).toBeCloseTo(Z.ZOOM_STEP, 10);
    expect(Z.steppedScale(Z.ZOOM_STEP, -1)).toBeCloseTo(1, 10);
  });

  test('ホイールの deltaY=100 相当（dir=-1）とボタンの −1 が同じ値を出す', () => {
    const base = 3;
    expect(Z.steppedScale(base, -100 / 100)).toBe(Z.steppedScale(base, -1));
  });

  test('倍率は乗算＝どの倍率でも1段の効きが同じ比になる', () => {
    expect(Z.steppedScale(2, 1) / 2).toBeCloseTo(Z.steppedScale(10, 1) / 10, 10);
  });

  test('下はフィット(1)・上は MAX_SCALE で止まる', () => {
    expect(Z.steppedScale(1, -1)).toBe(Z.MIN_SCALE);
    expect(Z.steppedScale(Z.MAX_SCALE, 1)).toBe(Z.MAX_SCALE);
    expect(Z.clampScale(0.1)).toBe(Z.MIN_SCALE);
    expect(Z.clampScale(1e6)).toBe(Z.MAX_SCALE);
  });
});

describe('表示%: 原寸=100% へ正規化する', () => {
  test('フィット中の大きい画像は100%未満（Windows フォトと同型）', () => {
    // A 4000px image fits inside a 1520px frame = 38% at fit (scale=1)
    expect(Z.zoomPercentOf(1, 1520, 4000)).toBe(38);
  });

  test('原寸のスケールちょうどで 100%', () => {
    const actual = Z.actualScaleOf(4000, 1520);
    expect(Z.zoomPercentOf(actual, 1520, 4000)).toBe(100);
  });

  test('枠より小さい画像はフィットが既に原寸＝100%', () => {
    expect(Z.zoomPercentOf(1, 300, 300)).toBe(100);
    expect(Z.actualScaleOf(300, 300)).toBe(1);
  });

  test('naturalWidth 未着・レイアウト幅0では null（0除算も NaN も出さない）', () => {
    expect(Z.zoomPercentOf(1, 1520, 0)).toBeNull();
    expect(Z.zoomPercentOf(1, 0, 4000)).toBeNull();
    expect(Z.zoomPercentOf(Number.NaN, 1520, 4000)).toBeNull();
    // Asked for the actual-size scale in the same situation, fall back to fit(1) = the jump target never becomes NaN
    expect(Z.actualScaleOf(0, 0)).toBe(1);
  });
});

describe('フィット⇄原寸トグル: ダブルクリックの現行挙動を1本化したもの', () => {
  test('フィット中なら原寸へ', () => {
    expect(Z.fitToggleTarget(1, 2.63)).toEqual({ fit: false, scale: 2.63 });
  });

  test('拡大中ならフィットへ', () => {
    expect(Z.fitToggleTarget(2.63, 2.63)).toEqual({ fit: true });
  });

  test('原寸がフィットとほぼ同じ小さい画像は固定倍率で寄る（原寸ジャンプが無反応に見えないため）', () => {
    expect(Z.fitToggleTarget(1, 1)).toEqual({ fit: false, scale: Z.SMALL_IMAGE_ZOOM });
    expect(Z.actualTarget(1)).toBe(Z.SMALL_IMAGE_ZOOM);
    expect(Z.actualTarget(2.63)).toBe(2.63);
  });

  test('フィット判定は 1 ちょうどでなく帯＝アニメーション途中の端数で裏返らない', () => {
    expect(Z.isAtFit(1)).toBe(true);
    expect(Z.isAtFit(Z.FIT_EPSILON)).toBe(true);
    expect(Z.isAtFit(Z.FIT_EPSILON + 0.001)).toBe(false);
  });
});

describe('コントローラ登録: 「今ズームできる面があるか」の唯一の情報源', () => {
  const ctl = () => ({ step: vi.fn(), toggleFitActual: vi.fn(), fit: vi.fn(), actual: vi.fn() });

  test('未登録なら controller は null＝ツールバーは disabled 側', () => {
    expect(Z.getState().controller).toBeNull();
  });

  test('登録で controller が入り、解除で戻る', () => {
    const c = ctl();
    const off = Z.register(c);
    expect(Z.getState().controller).toBe(c);
    off();
    expect(Z.getState().controller).toBeNull();
  });

  test('解除は自分がまだ現役のときだけ効く＝スライド差し替えの順序で新しい方を消さない', () => {
    const a = ctl();
    const b = ctl();
    const offA = Z.register(a);
    const offB = Z.register(b); // the new slide registers first
    offA(); // the old slide's cleanup comes in afterward
    expect(Z.getState().controller).toBe(b);
    offB();
  });

  test('publish は変化したときだけ購読者を起こす', () => {
    const off = Z.register(ctl());
    const seen = vi.fn();
    const unsub = Z.subscribe(seen);
    const view = { percent: 125, atFit: false, canZoomIn: true, canZoomOut: true };
    Z.publish(view);
    Z.publish({ ...view });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(Z.getState().percent).toBe(125);
    unsub();
    off();
  });

  test('登録が無いときの publish は素通り＝死んだスライドの最終フレームが残らない', () => {
    Z.publish({ percent: 999, atFit: false, canZoomIn: true, canZoomOut: true });
    expect(Z.getState().percent).toBeNull();
  });
});

describe('Ctrl+0 / Ctrl+1', () => {
  const key = (init: Partial<KeyboardEvent> & { key: string }) => {
    const e = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: null, preventDefault: vi.fn(), ...init } as unknown as KeyboardEvent;
    return e;
  };
  const make = () => ({ step: vi.fn(), toggleFitActual: vi.fn(), fit: vi.fn(), actual: vi.fn() });
  let c: ReturnType<typeof make>;
  let off: (() => void) | undefined;

  beforeEach(() => {
    c = make();
    off?.();
    off = Z.register(c);
  });

  test('Ctrl+0 はフィット・Ctrl+1 は原寸', () => {
    Z.handleShortcutZoomKey(key({ key: '0', ctrlKey: true }));
    expect(c.fit).toHaveBeenCalledTimes(1);
    Z.handleShortcutZoomKey(key({ key: '1', ctrlKey: true }));
    expect(c.actual).toHaveBeenCalledTimes(1);
  });

  test('修飾なし・Shift/Alt 併用・別のキーは素通し', () => {
    for (const e of [key({ key: '0' }), key({ key: '0', ctrlKey: true, shiftKey: true }), key({ key: '1', ctrlKey: true, altKey: true }), key({ key: '2', ctrlKey: true })]) {
      Z.handleShortcutZoomKey(e);
    }
    expect(c.fit).not.toHaveBeenCalled();
    expect(c.actual).not.toHaveBeenCalled();
  });

  test('入力欄にフォーカスがあるときは奪わない', () => {
    Z.handleShortcutZoomKey(key({ key: '0', ctrlKey: true, target: { tagName: 'INPUT' } as unknown as EventTarget }));
    expect(c.fit).not.toHaveBeenCalled();
  });

  test('ズームできる面が無ければ何もしない＝グリッドや動画スライドでは素通し', () => {
    off();
    off = () => {};
    const e = key({ key: '0', ctrlKey: true });
    Z.handleShortcutZoomKey(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});
