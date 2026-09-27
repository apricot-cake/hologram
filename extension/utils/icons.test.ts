// @vitest-environment jsdom
import { Check, Download, LoaderCircle, TriangleAlert, X, createElement } from 'lucide';
import { expect, test, vi } from 'vitest';
import { ICONS, makeIcon, makeSpinner } from './icons.ts';

test('共有アイコンは Lucide の定義をそのまま使う', () => {
  expect(ICONS).toEqual({ drop: Download, check: Check, cross: X, warn: TriangleAlert });
  for (const icon of Object.values(ICONS)) {
    const svg = makeIcon(icon, 15);
    expect(svg.innerHTML).toBe(createElement(icon).innerHTML);
    expect(svg.getAttribute('width')).toBe('15');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
  }
});

test('保存中も CSS の円ではなく Lucide の LoaderCircle を使う', () => {
  const spinner = makeSpinner(15);
  expect(spinner.tagName).toBe('svg');
  expect(spinner.innerHTML).toBe(createElement(LoaderCircle).innerHTML);
  expect(spinner.classList.contains('spinner')).toBe(true);
});

test('Trusted Types を必要とする HTML 書き込みを使わない', () => {
  const setter = vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(() => {
    throw new Error('TrustedHTML required');
  });
  try {
    for (const icon of Object.values(ICONS)) expect(() => makeIcon(icon)).not.toThrow();
    expect(() => makeSpinner()).not.toThrow();
    expect(setter).not.toHaveBeenCalled();
  } finally {
    setter.mockRestore();
  }
});
