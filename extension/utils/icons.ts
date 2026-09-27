import { Check, Download, LoaderCircle, TriangleAlert, X, createElement, type IconNode } from 'lucide';

export type { IconNode } from 'lucide';

// Lucide の DOM API を使い、Trusted Types を強制するページでも
// innerHTML へ書き込まずにアイコンを生成する。
export function makeIcon(icon: IconNode, size = 22): SVGElement {
  const svg = createElement(icon, { width: size, height: size, class: 'lucide', 'aria-hidden': 'true', focusable: 'false' });
  svg.style.pointerEvents = 'none';
  return svg;
}

export function makeSpinner(size = 22): SVGElement {
  const svg = makeIcon(LoaderCircle, size);
  svg.classList.add('spinner');
  return svg;
}

export const ICONS = {
  drop: Download,
  check: Check,
  cross: X,
  warn: TriangleAlert,
};
