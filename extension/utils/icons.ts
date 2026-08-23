// ページ上の UI を描くのに使う絵文字（旧 glass-ui.ts。#136 が画面を不透
// 明にし、#270 がテーマ対応にしたことで「glass（ガラス）」という名前が何
// も説明しなくなった。同じファイルが持っていた色は今 tokens.ts にある）。
//
// マークアップではなく createElementNS で組み立てる: innerHTML のような文
// 字列シンクは、Trusted Types を強制するホスト（x.com がそうだ）ではその
// まま拒否される。DOM を組み立てるこの経路はそもそもシンクではない。
import { token } from './tokens.ts';

const SVGNS = 'http://www.w3.org/2000/svg';

// 線の色は `currentColor` から取るため、絵文字を持つ要素側にインクの色を
// 設定すれば絵文字にも色が付く。これは forced-colors モードを機能させて
// いる仕組みでもある＝ブラウザがテキストの色を自身のシステム色に置き換
// え、絵文字は誰も選んでいない固定の色調に留まるのではなくそれに追従す
// る。
export function makeIcon(paths: readonly string[], size = 22): SVGSVGElement {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  svg.style.pointerEvents = 'none';
  return svg;
}

// 0.9秒のリニア＝アプリのスピナーと同じ速さ。reduced motion の下でも常にそ
// うしてきたとおり動かしたままにする＝これは処理が進行中であることを伝え
// るためのもので、止まったリングは保存が止まったと言っているように見えて
// しまう。
const SPIN_MS = 900;

export function makeSpinner(size = 22): HTMLDivElement {
  const sp = document.createElement('div');
  sp.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid ${token.badgeNeutral};border-top-color:currentColor;box-sizing:border-box;pointer-events:none;`;
  sp.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: SPIN_MS, iterations: Number.POSITIVE_INFINITY });
  return sp;
}

export const ICONS = {
  drop: ['M12 4v9', 'm8.5 9.5 3.5 3.5 3.5-3.5', 'M4.5 15.5v2a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-2'],
  check: ['m6 12.5 4.2 4.2L18 8'],
  partial: ['M6 12h12'],
  cross: ['M7 7l10 10', 'M17 7 7 17'],
  warn: ['M12 6.5v6.5', 'M12 17.2v.05'],
  target: ['M12 3.5a8.5 8.5 0 1 0 0 17a8.5 8.5 0 1 0 0-17', 'M12 11.9v.2'],
};
