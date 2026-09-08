/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { OverlaySite } from '../extractor/types.ts';
import { createTracker } from './tracker.ts';

class FakeIntersectionObserver {
  readonly observed = new Set<Element>();

  observe(element: Element) {
    this.observed.add(element);
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }
}

function unit(id: string, top: number): HTMLElement {
  const element = document.createElement('article');
  element.className = 'unit';
  element.id = id;
  element.getBoundingClientRect = () => ({ bottom: top + 100, height: 100, left: 0, right: 100, top, width: 100, x: 0, y: top, toJSON: () => ({}) });
  return element;
}

describe('overlay tracker の追跡上限', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('上限到達後も画面へ入った新しいユニットを画面外の古いユニットより優先する', async () => {
    for (let i = 0; i < 600; i += 1) document.body.appendChild(unit(`old-${i}`, 10_000 + i * 120));

    const site = {
      unitSelector: '.unit',
      mediaIn: () => [],
    } as unknown as OverlaySite;
    const tracker = createTracker(
      site,
      { maxTracked: 600, scanDebounceMs: 0, observerMargin: '200px' },
      {
        onAnchorRemoved: vi.fn(),
        onEnter: vi.fn(),
        onLeave: vi.fn(),
        onIntersectionSettled: vi.fn(),
        onMutation: vi.fn(),
      },
    );

    expect(tracker.tracked.size).toBe(600);
    const current = unit('current', 100);
    document.body.appendChild(current);

    await vi.waitFor(() => expect(tracker.tracked.has(current)).toBe(true));
    expect(tracker.tracked.size).toBe(600);
    expect(tracker.tracked.has(document.getElementById('old-0') as Element)).toBe(false);

    tracker.dispose();
  });
});
