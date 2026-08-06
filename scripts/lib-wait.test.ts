import { describe, expect, it } from 'vitest';

// The contract the harnesses depend on (#986). The renderer half cannot be
// imported — it is source text meant for executeJavaScript — so it is exercised
// the only way it runs: evaluated, then called.
const { sleep, waitFor, neverHappens, rendererWaits, evalSource } = require('./lib-wait.cts');

describe('neverHappens (Node side)', () => {
  it('resolves when the condition never holds', async () => {
    await expect(neverHappens('the lightbox to open', () => false, 30, { pollMs: 5 })).resolves.toBeUndefined();
  });

  it('names the condition when it does hold', async () => {
    await expect(neverHappens('the lightbox to open', () => true, 30, { pollMs: 5 })).rejects.toThrow(/happened within 30ms but should not have: the lightbox to open/);
  });
});

describe('waitFor (Node side)', () => {
  it('resolves as soon as the condition holds', async () => {
    let hits = 0;
    await waitFor('the counter to reach 3', () => ++hits >= 3, { pollMs: 1 });
    expect(hits).toBe(3);
  });

  it('accepts an async condition', async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 20);
    await waitFor('the flag to flip', async () => ready, { pollMs: 1 });
    expect(ready).toBe(true);
  });

  // The reason this module exists: a timeout used to surface as a bare `false`,
  // and every call site invented its own wording for it — which is how #982
  // reported a broken layout when the wait that expired was for a face swap.
  it('names what it was waiting for when it times out', async () => {
    await expect(waitFor('the sidecar to appear', () => false, { timeoutMs: 30, pollMs: 5 })).rejects.toThrow(/timed out after 30ms waiting for: the sidecar to appear/);
  });

  it('checks the condition at least once even with a zero timeout', async () => {
    await expect(waitFor('an immediate truth', () => true, { timeoutMs: 0 })).resolves.toBeUndefined();
  });
});

describe('sleep', () => {
  it('waits roughly the requested time', async () => {
    const t0 = Date.now();
    // biome-ignore lint/plugin: the delay under test — there is no post-condition to observe, the elapsed time IS the subject.
    await sleep(30);
    // Only a lower bound: a loaded machine may take much longer, and asserting an
    // upper bound here would make this suite the very thing #986 is about.
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});

describe('rendererWaits (source text for the renderer)', () => {
  // Evaluates the emitted source in this process and hands back the helpers, which
  // is exactly what evalSource's wrapper does inside the renderer.
  const load = (budgetMs?: number) => {
    const factory = new Function(`${rendererWaits(budgetMs === undefined ? {} : { budgetMs })}
      return { sleep, waitFor, waitStable, neverHappens };`);
    return factory();
  };

  it('returns true when the condition holds', async () => {
    const { waitFor: rWaitFor } = load();
    expect(await rWaitFor('a truth', () => true)).toBe(true);
  });

  it('returns false and records the label on timeout', async () => {
    const { waitFor: rWaitFor } = load();
    const before = (globalThis as any).__waitTimeouts?.length ?? 0;
    expect(await rWaitFor('the grid to fill', () => false, 20)).toBe(false);
    const recorded = (globalThis as any).__waitTimeouts;
    expect(recorded.length).toBe(before + 1);
    expect(recorded[recorded.length - 1]).toEqual({ label: 'the grid to fill', ms: 20 });
  });

  it('caps every wait by the run budget so timeouts cannot chain', async () => {
    const { waitFor: rWaitFor } = load(40);
    const t0 = Date.now();
    // Three waits that each ask for a second; the budget is 40ms for all of them.
    await rWaitFor('a', () => false, 1000);
    await rWaitFor('b', () => false, 1000);
    await rWaitFor('c', () => false, 1000);
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it('waitStable returns once a reading repeats', async () => {
    const { waitStable } = load();
    const values = [1, 2, 3, 3, 3, 3];
    let i = 0;
    expect(await waitStable('the layout to settle', () => values[Math.min(i++, values.length - 1)])).toBe(true);
  });

  it('neverHappens is true only when the condition never holds', async () => {
    const { neverHappens } = load();
    expect(await neverHappens('the lightbox to open', () => false, 30)).toBe(true);
    expect(await neverHappens('the lightbox to open', () => true, 30)).toBe(false);
  });
});

describe('evalSource', () => {
  it('inlines the body and its arguments, closing over nothing', async () => {
    const outside = 'must not be reachable';
    const src = evalSource(async (_waits, args: { want: number }) => args.want * 2, { want: 21 });
    expect(src).not.toContain(outside);
    expect(src).toContain('"want":21');
    // Runs the produced source the same way the renderer does.
    expect(await new Function(`return ${src}`)()).toBe(42);
  });
});
