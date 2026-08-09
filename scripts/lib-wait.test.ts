import { describe, expect, it } from 'vitest';

// ハーネスが頼っている取り決め(#986)。レンダラー側は import できない＝
// executeJavaScript へ渡すためのソーステキストなので、実際に動く唯一のやり方＝
// eval してから呼ぶ、で試す。
const { sleep, waitFor, neverHappens, rendererWaits, evalSource } = require('./lib-wait.cts');

describe('neverHappens (Node 側)', () => {
  it('条件が一度も成り立たなければ解決する', async () => {
    await expect(neverHappens('the lightbox to open', () => false, 30, { pollMs: 5 })).resolves.toBeUndefined();
  });

  it('成り立ってしまったら条件を名指しする', async () => {
    await expect(neverHappens('the lightbox to open', () => true, 30, { pollMs: 5 })).rejects.toThrow(/起きるべきではなかったのに 30ms 以内に起きた: the lightbox to open/);
  });
});

describe('waitFor (Node 側)', () => {
  it('条件が成り立った時点で解決する', async () => {
    let hits = 0;
    await waitFor('the counter to reach 3', () => ++hits >= 3, { pollMs: 1 });
    expect(hits).toBe(3);
  });

  it('非同期の条件も受け取る', async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 20);
    await waitFor('the flag to flip', async () => ready, { pollMs: 1 });
    expect(ready).toBe(true);
  });

  // このモジュールがある理由。以前は時間切れが素の `false` として出てきて、呼び出し側が
  // それぞれ勝手な言い回しを作っていた。だから #982 は、実際に切れた待ちが顔の差し替え
  // だったのに、レイアウトが壊れたと報告された。
  it('時間切れのとき何を待っていたかを名指しする', async () => {
    await expect(waitFor('the sidecar to appear', () => false, { timeoutMs: 30, pollMs: 5 })).rejects.toThrow(/30ms 待っても実現しなかった: the sidecar to appear/);
  });

  it('待ち時間が 0 でも条件を最低1回は見る', async () => {
    await expect(waitFor('an immediate truth', () => true, { timeoutMs: 0 })).resolves.toBeUndefined();
  });
});

describe('sleep', () => {
  it('頼んだ時間だけおおよそ待つ', async () => {
    const t0 = Date.now();
    // biome-ignore lint/plugin: the delay under test — there is no post-condition to observe, the elapsed time IS the subject.
    await sleep(30);
    // 下限だけを見る。負荷の高い機械ではずっと長くかかりうるし、ここで上限を主張すると、
    // この一式そのものが #986 の言う問題になる。
    expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
  });
});

describe('rendererWaits (レンダラーへ渡すソーステキスト)', () => {
  // 吐き出したソースをこのプロセスで eval してヘルパを返す。evalSource の包みが
  // レンダラーの中でやっているのとちょうど同じこと。
  const load = (budgetMs?: number) => {
    const factory = new Function(`${rendererWaits(budgetMs === undefined ? {} : { budgetMs })}
      return { sleep, waitFor, waitStable, neverHappens };`);
    return factory();
  };

  it('条件が成り立てば true を返す', async () => {
    const { waitFor: rWaitFor } = load();
    expect(await rWaitFor('a truth', () => true)).toBe(true);
  });

  it('時間切れなら false を返し、ラベルを記録する', async () => {
    const { waitFor: rWaitFor } = load();
    const before = (globalThis as any).__waitTimeouts?.length ?? 0;
    expect(await rWaitFor('the grid to fill', () => false, 20)).toBe(false);
    const recorded = (globalThis as any).__waitTimeouts;
    expect(recorded.length).toBe(before + 1);
    expect(recorded[recorded.length - 1]).toEqual({ label: 'the grid to fill', ms: 20 });
  });

  it('待ちは1回の実行の持ち時間で頭打ちにする＝時間切れが連鎖しない', async () => {
    const { waitFor: rWaitFor } = load(40);
    const t0 = Date.now();
    // 1秒ずつ求める待ちが3つ。持ち時間はその全部で 40ms。
    await rWaitFor('a', () => false, 1000);
    await rWaitFor('b', () => false, 1000);
    await rWaitFor('c', () => false, 1000);
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it('waitStable は同じ読みが繰り返された時点で返る', async () => {
    const { waitStable } = load();
    const values = [1, 2, 3, 3, 3, 3];
    let i = 0;
    expect(await waitStable('the layout to settle', () => values[Math.min(i++, values.length - 1)])).toBe(true);
  });

  it('neverHappens が true になるのは条件が一度も成り立たないときだけ', async () => {
    const { neverHappens } = load();
    expect(await neverHappens('the lightbox to open', () => false, 30)).toBe(true);
    expect(await neverHappens('the lightbox to open', () => true, 30)).toBe(false);
  });
});

describe('evalSource', () => {
  it('本体と引数を埋め込み、外側を1つも閉じ込めない', async () => {
    const outside = 'must not be reachable';
    const src = evalSource(async (_waits, args: { want: number }) => args.want * 2, { want: 21 });
    expect(src).not.toContain(outside);
    expect(src).toContain('"want":21');
    // 出来たソースをレンダラーと同じやり方で走らせる。
    expect(await new Function(`return ${src}`)()).toBe(42);
  });
});
