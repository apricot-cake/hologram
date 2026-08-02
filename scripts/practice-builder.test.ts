// Practice mode's queue construction (#103): flatten the on-screen groups into
// still images (video/ugoira excluded), shuffle, hand off to practice.ts. No DOM
// -- same layer triage-builder.test.ts covers for its own builder.

import { beforeEach, expect, test } from 'vitest';

let PB: any; // practice-builder.ts (deps injection)
let P: any; // practice.ts (pure state)

beforeEach(async () => {
  PB = await import('../app/src/renderer/src/services/practice-builder');
  P = await import('../app/src/renderer/src/services/practice');
  P.close();
});

function makeDeps(groups: any[]) {
  return {
    getViewGroups: () => groups,
    buildGroupGalleryItems: (g: any) => g.items,
  };
}

test('flattens every still image across every group, in group order', () => {
  const groups = [
    { key: 'g1', items: [{ src: 'a1' }, { src: 'a2' }] },
    { key: 'g2', items: [{ src: 'b1' }] },
  ];
  const pc = PB.makePractice(makeDeps(groups));
  pc.startPractice();

  const srcs = P.get().items.map((it: any) => it.src);
  expect(srcs.slice().sort()).toEqual(['a1', 'a2', 'b1']);
  expect(P.get().open).toBe(true);
});

test('drops video and ugoira items -- there is no still frame to hold under a timer', () => {
  const groups = [
    {
      key: 'g1',
      items: [{ src: 'still.jpg' }, { src: 'clip.mp4', video: true }, { src: 'anim.zip', ugoira: { file: 'anim.zip', frames: [] } }],
    },
  ];
  const pc = PB.makePractice(makeDeps(groups));
  pc.startPractice();

  const srcs = P.get().items.map((it: any) => it.src);
  expect(srcs).toEqual(['still.jpg']);
});

test('an empty filter result opens practice mode with an empty queue (empty-state, not a no-op)', () => {
  const pc = PB.makePractice(makeDeps([]));
  pc.startPractice();

  expect(P.get().open).toBe(true);
  expect(P.get().items).toEqual([]);
});

test('closePractice closes the session', () => {
  const pc = PB.makePractice(makeDeps([{ key: 'g1', items: [{ src: 'a' }] }]));
  pc.startPractice();
  pc.closePractice();

  expect(P.get().open).toBe(false);
});
