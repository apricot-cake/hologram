// services/image-zoom.ts の単体テスト(#150 画像ビューのツールバー)。
//
// ここで固定するのは、実 Electron でしか見えない描画を除いた「数」の側＝
// (1) ホイールとツールバーの +/- が同じ倍率ラダーを刻む (2) 表示%は原寸=100%
// へ正規化する(react-zoom-pan-pinch の scale はフィット=1 が基準なので、生の
// scale をそのまま出すと画像ごとに意味の違う数が出る) (3) naturalWidth が
// まだ届かないうちも 0 除算も NaN も出さない (4) フィット⇄原寸のトグルは
// 「小さい画像は原寸にしても意味が無いので固定倍率にする」という現行の
// ダブルクリックの挙動のまま。
//
// 「今ズームできる面があるか」の情報源はコントローラの登録だけ(動画と
// うごイラのスライドは Zoomable を描かないので登録が無い)。だからここでは
// 登録・解除の帳簿と、それを見て Ctrl+0 / Ctrl+1 が動くことも合わせて見る。
// 絵が実際に動いたかは実レンダラーの領分(e2e/harness/cases/test-app-image-zoom.cts)。

import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as Z from './image-zoom';

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
    // 4000px の画像を 1520px の枠に収めると、フィット(scale=1)で 38%
    expect(Z.zoomPercentOf(1, 1520, 4000)).toBe(38);
  });

  test('原寸のスケールちょうどで 100%', () => {
    const actual = 4000 / 1520;
    expect(Z.zoomPercentOf(actual, 1520, 4000)).toBe(100);
  });

  test('枠より小さい画像はフィットが既に原寸＝100%', () => {
    expect(Z.zoomPercentOf(1, 300, 300)).toBe(100);
  });

  test('naturalWidth 未着・レイアウト幅0では null（0除算も NaN も出さない）', () => {
    expect(Z.zoomPercentOf(1, 1520, 0)).toBeNull();
    expect(Z.zoomPercentOf(1, 0, 4000)).toBeNull();
    expect(Z.zoomPercentOf(Number.NaN, 1520, 4000)).toBeNull();
    // 同じ状況で原寸のスケールを聞かれたらフィット(1)へ退避する＝跳び先が NaN にならない
  });
});

describe('コントローラ登録: 「今ズームできる面があるか」の唯一の情報源', () => {
  const ctl = () => ({ step: vi.fn(), fit: vi.fn() });

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
    const offB = Z.register(b); // 新しいスライドが先に登録する
    offA(); // 古いスライドの片付けが後から来る
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

describe('ウィンドウフィットのショートカット', () => {
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

  test('Ctrl+0 はフィット・Ctrl+1 は何もしない', () => {
    Z.handleShortcutZoomKey(key({ key: '0', ctrlKey: true }));
    expect(c.fit).toHaveBeenCalledTimes(1);
    const removed = key({ key: '1', ctrlKey: true });
    Z.handleShortcutZoomKey(removed);
    expect(removed.preventDefault).not.toHaveBeenCalled();
  });

  test('修飾なし・Shift/Alt 併用・別のキーは素通し', () => {
    for (const e of [key({ key: '0' }), key({ key: '0', ctrlKey: true, shiftKey: true }), key({ key: '1', ctrlKey: true, altKey: true }), key({ key: '2', ctrlKey: true })]) {
      Z.handleShortcutZoomKey(e);
    }
    expect(c.fit).not.toHaveBeenCalled();
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
