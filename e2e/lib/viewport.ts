// E2Eウィンドウが、レイアウトの幅のブレークポイント（#649）に対してどこに位置するか。
//
// このファイルが存在する理由。以前のハーネスはコンテンツボックスの幅をリテラルで固定していて、
// そのリテラルはブレークポイントそのもの＝layout-mode.tsのWIDE_MIN_PXを、境界をwide側に
// 含めた形でそのまま書いたものだった。2つの数値はたまたま等しく、しかも2か所に書かれていたので、
// ブレークポイントを上げていたらフローのテスト一式がまるごとnarrow側に動いていたはずだ＝どのケースも
// 成功したまま、書かれた意図どおりのwideレイアウトを見るケースは一つもなくなる。失敗に見えない失敗。
//
// だからこの境界の所有者はlayout-mode.tsただ1つに保ち、テスト一式が使うすべての幅はここで
// そこから算出する。e2e/配下のどこにもこの数値を書き直してはいけない＝
// scripts/harness-viewport.test.tsがその両面を強制する。

import { WIDE_MIN_PX } from '../../app/src/renderer/src/services/layout-mode.ts';

export { WIDE_MIN_PX };

// 境界は2つのピクセルの間にある。そして`min-width`はその名前が示す値を含む＝ちょうどWIDE_MIN_PXの
// ときレイアウトはすでにwideである。これは逆に取り違えやすいので、切り替えの両側にある2つの幅には、
// 呼び出しのたびに`bp`や`bp - 1`と書く代わりに名前を与えている。justAboveは以下の導出が土台にする値、
// justBelowはnarrowの形をその最大幅で見たい仕様が求める値。

/** `breakpoint`のwide側でなお最も狭い幅。 */
export function justAbove(breakpoint: number): number {
  return breakpoint;
}

/** `breakpoint`のnarrow側でなお最も広い幅。 */
export function justBelow(breakpoint: number): number {
  return breakpoint - 1;
}

// 切り替え自体を扱わないケースが、切り替え地点からどれだけ離れて座るべきか。正の余白であれば
// どんな値でもレイアウトの条件を満たすので、これは調整して決めた数値ではない＝ウィンドウサイズの
// 1段分であり、スクロールバーの溝とDPIの丸め（コンテンツボックスの1、2ピクセルを左右する）が
// ケースを境界まで押し戻せないだけの広さがあり、かつブレークポイントを足し戻しても普通のディスプレイに
// 収まる小ささでもある。
const CLEARANCE_PX = 160;

/** `breakpoint`のwide側に十分な余裕を持った幅＝切り替えではなくwideレイアウトそのものを見たいケース用。 */
export function wideOf(breakpoint: number): number {
  return justAbove(breakpoint) + CLEARANCE_PX;
}

/**
 * すべてのケースが使うウィンドウのコンテンツボックス。基準線がピクセルなので固定するが、
 * 固定するのはブレークポイントに対して相対的にであって、隣接させるのではない。高さには
 * 従うべきブレークポイントがない。
 */
export const CONTENT_SIZE = { width: wideOf(WIDE_MIN_PX), height: 800 };
