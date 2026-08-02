// Practice mode's pure state (#103): duration/idx/tick transitions. No DOM, no
// deps -- mirrors the shape of lightbox.test.ts / triage.ts's own coverage inside
// triage-builder.test.ts, but this module has no builder dependency of its own
// worth a separate deps-stub test (see practice-builder.test.ts for the flatten +
// shuffle half).

import { beforeEach, expect, test } from 'vitest';
import * as P from '../app/src/renderer/src/services/practice';

beforeEach(() => {
  P.close(); // reset module state between tests (close() is a no-op when already closed)
});

test('openWith seeds idx 0 and the full duration as remaining', () => {
  P.openWith([{ src: 'a' }, { src: 'b' }]);
  const s = P.get();
  expect(s.open).toBe(true);
  expect(s.idx).toBe(0);
  expect(s.remaining).toBe(s.duration);
  expect(P.current()).toEqual({ src: 'a' });
});

test('close drops the queue so a re-open starts from a fresh snapshot', () => {
  P.openWith([{ src: 'a' }]);
  P.close();
  expect(P.get().open).toBe(false);
  expect(P.get().items).toEqual([]);
});

test('setIdx wraps both ways (a practice session loops, it never ends)', () => {
  P.openWith([{ src: 'a' }, { src: 'b' }, { src: 'c' }]);
  P.setIdx(-1);
  expect(P.get().idx).toBe(2);
  P.next();
  expect(P.get().idx).toBe(0);
  P.prev();
  expect(P.get().idx).toBe(2);
});

test('a step resets remaining to the full duration', () => {
  P.openWith([{ src: 'a' }, { src: 'b' }]);
  P.setDuration(30000);
  P.tick(20000);
  expect(P.get().remaining).toBe(10000);
  P.next();
  expect(P.get().remaining).toBe(30000);
});

test('setDuration resets the current countdown to the new length', () => {
  P.openWith([{ src: 'a' }]);
  P.setDuration(30000);
  P.tick(25000);
  expect(P.get().remaining).toBe(5000);
  P.setDuration(60000);
  expect(P.get().remaining).toBe(60000);
});

test('togglePause stops tick from advancing the countdown', () => {
  P.openWith([{ src: 'a' }]);
  P.setDuration(30000);
  P.togglePause();
  P.tick(10000);
  expect(P.get().remaining).toBe(30000); // untouched -- tick() no-ops while paused
  P.togglePause();
  P.tick(10000);
  expect(P.get().remaining).toBe(20000);
});

test('tick past zero steps to the next item and resets the countdown', () => {
  P.openWith([{ src: 'a' }, { src: 'b' }]);
  P.setDuration(30000);
  P.tick(31000);
  expect(P.get().idx).toBe(1);
  expect(P.get().remaining).toBe(30000);
});

test('tick is a no-op while closed or empty', () => {
  P.tick(5000); // closed
  expect(P.get().remaining).toBe(P.get().duration);
  P.openWith([]);
  P.tick(5000); // open but empty
  expect(P.get().items).toEqual([]);
});
