// Unit tests for the PURE placement math extension/utils/overlay/positioning.ts
// carves out of the timeline overlay's corner control (#399). These take plain
// rects and numbers -- no DOM, no jsdom, no browser -- which is the acceptance
// bar #399 set for "the main positioning branches verifiable without a
// browser". The DOM-touching half of that module (controlHost, mountControl,
// modalCovers, etc.) is still exercised end-to-end by scripts/overlay.test.ts,
// which runs the built content script inside jsdom.
import { describe, expect, test } from 'vitest';
import { computeMediaOffset, computeTextOffset, rectHoldsPointer, resolveViewerCloseButtonClearance } from '../extension/utils/overlay/positioning.ts';

describe('rectHoldsPointer', () => {
  const r = { left: 10, top: 20, width: 100, height: 50 };

  test('内側の点を含む', () => {
    expect(rectHoldsPointer(r, 50, 40)).toBe(true);
  });

  test('左上・右下の境界はどちらも含む（閉区間）', () => {
    expect(rectHoldsPointer(r, 10, 20)).toBe(true);
    expect(rectHoldsPointer(r, 110, 70)).toBe(true);
  });

  test('矩形の外は含まない', () => {
    expect(rectHoldsPointer(r, 9, 40)).toBe(false);
    expect(rectHoldsPointer(r, 50, 71)).toBe(false);
  });
});

describe('computeMediaOffset（positionControl の主分岐）', () => {
  test('host が無い＝box 自身がホスト: 固定インセットだけが乗る', () => {
    const boxRect = { left: 300, top: 400, width: 200, height: 200 };

    expect(computeMediaOffset(null, boxRect, 6)).toEqual({ left: 6, top: 6 });
  });

  test('host が box と別要素: box とホストの差分＋インセット', () => {
    const hostRect = { left: 100, top: 200, width: 400, height: 400 };
    const boxRect = { left: 130, top: 260, width: 200, height: 200 };

    // (130-100)+6=36, (260-200)+6=66
    expect(computeMediaOffset(hostRect, boxRect, 6)).toEqual({ left: 36, top: 66 });
  });
});

describe('computeTextOffset（テキスト投稿のアバター縁への配置・#575）', () => {
  test('40px アバターの135度点を中心に、24pxの円をのせるオフセット', () => {
    // scripts/overlay.test.ts の p14 と同じ数値（post 要素が host、avatar がその
    // 中に立つ）: host (50,6000)・avatar (66,6012,40x40) -> (10,6) が実測値。
    const hostRect = { left: 50, top: 6000, width: 120, height: 120 };
    const avatarRect = { left: 66, top: 6012, width: 40, height: 40 };

    expect(computeTextOffset(hostRect, avatarRect, 24)).toEqual({ left: 10, top: 6 });
  });
});

describe('resolveViewerCloseButtonClearance（X の閉じるボタン回避・#704）', () => {
  // scripts/overlay.test.ts の写真ビューア suite と同じ数値: ラッパー(host)
  // (50,8900,600x600)、画像から出した left/top はどちらも106、閉じるボタンは
  // (160,9010,36x36)。実測の結果は top=152 に落ち着く。
  const hostRect = { left: 50, top: 8900, width: 600, height: 600 };

  test('衝突が無ければ top はそのまま', () => {
    expect(resolveViewerCloseButtonClearance(hostRect, 106, 106, 24, [])).toBe(106);
  });

  test('閉じるボタンと重なる時は、その下端＋インセットまで下げる', () => {
    const closeButton = { left: 160, top: 9010, width: 36, height: 36 };

    expect(resolveViewerCloseButtonClearance(hostRect, 106, 106, 24, [closeButton])).toBe(152);
  });

  test('下げた先で別のボタンとまた重なる場合は、そちらもクリアするまで続ける', () => {
    const upper = { left: 160, top: 9010, width: 36, height: 36 }; // これだけなら下げ先は152
    // upper をクリアした先(controlTop=8900+152=9052)のすぐ下に置き、衝突を連鎖させる
    const chained = { left: 160, top: 9060, width: 36, height: 36 };

    const result = resolveViewerCloseButtonClearance(hostRect, 106, 106, 24, [upper, chained]);

    // upper との衝突で152へ、chained(top 9060, bottom 9096)は
    // controlTop=8900+152=9052 <9096 かつ +24=9076>9060 なので更に衝突し、
    // bottom(9096)-8900+6=202 まで押し下げられる。
    expect(result).toBe(202);
  });

  test('4回まででも解決しない場合は打ち切る（無限ループにしない）', () => {
    // 押し下げるたびにまた真上に衝突するボタンを100個並べる = 毎回 collisions が
    // 見つかり続けるが、for ループは4回で打ち切って有限の値を返す。
    const stack = Array.from({ length: 100 }, (_, i) => ({ left: 160, top: 9000 + i * 40, width: 36, height: 36 }));

    expect(() => resolveViewerCloseButtonClearance(hostRect, 106, 106, 24, stack)).not.toThrow();
  });
});
