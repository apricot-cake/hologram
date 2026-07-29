// app/src/renderer/src/_shared/view-transition.ts ＝ React 島から View Transitions API を
// 起動する唯一の入口（#252）のオフライン純ユニットテスト。jsdom には View Transitions が
// 無いので `document.startViewTransition` は偽物を差し込み、「いつ呼ばれ／いつ呼ばれないか」
// と「名前をいつ付けていつ剥がすか」だけを見る。
//
// このスイートが存在する理由＝**この API の失敗は全て無言**だから。名前が重複しても、
// API が無くても、reduced-motion でも、例外は飛ばず console にも出ず、演出だけが消える。
// 「動いている」と「演出が飛んでいる」を区別できるのは、起動したか・名前が一意かを
// 直接見るこの層だけ（実際に何フレーム動いたかは見られない＝そこは実機の目視）。
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { canViewTransition, isViewTransitionRunning, runViewTransition } from '../app/src/renderer/src/_shared/view-transition.ts';

const KEYS = ['window', 'document', 'Element', 'HTMLElement', 'Node'];

type FakeTransition = { finished: Promise<void> };

let dom: JSDOM;
let saved: Record<string, unknown>;
// 差し込んだ startViewTransition が受け取ったコールバック。実 API はキャプチャ後に
// 非同期で呼ぶので、テスト側も手で呼んで「呼ばれる前に名前が付いているか」を見る。
let started: (() => void)[];
let transitions: { settle: () => void; reject: (e: Error) => void }[];
let finish: () => void;
let fail: () => void;

function installDom(reducedMotion = false) {
  dom = new JSDOM('<!doctype html><html><body></body></html>');
  saved = {};
  for (const k of KEYS) {
    saved[k] = (global as any)[k];
    (global as any)[k] = (dom.window as any)[k];
  }
  (dom.window as any).matchMedia = (q: string) => ({ matches: reducedMotion && q.includes('prefers-reduced-motion'), media: q });
  started = [];
  transitions = [];
}

// 1回の startViewTransition ＝ 1本の finished。install ごとに1本を共有させると、
// 連続起動のテストが同じ Promise を取り合って偽の結果になる（実 API は当然1本ずつ）。
// テスト間に漏れる状態が1つある＝モジュール内の「走行中の本数」カウンタなので、
// afterEach で必ず全部 settle させて 0 へ戻す。
function installViewTransitionApi() {
  (dom.window.document as any).startViewTransition = (cb: () => void): FakeTransition => {
    let settle!: () => void;
    let reject!: (e: Error) => void;
    const finished = new Promise<void>((res, rej) => {
      settle = res;
      reject = rej;
    });
    finished.catch(() => {}); // 誰も掴まなかった reject を unhandled にしない
    transitions.push({ settle, reject });
    started.push(cb);
    return { finished };
  };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
finish = () => transitions.at(-1)?.settle();
fail = () => transitions.at(-1)?.reject(new Error('skipped'));

function card(key: string): HTMLElement {
  const el = dom.window.document.createElement('div');
  el.className = 'post-card';
  el.dataset.key = key;
  dom.window.document.body.appendChild(el);
  return el;
}

const nameOf = (el: HTMLElement) => el.style.getPropertyValue('view-transition-name');

beforeEach(() => {
  installDom();
});
afterEach(async () => {
  // 走行中カウンタはモジュール内に残るので、開けたものは全部閉じてから次のテストへ渡す。
  for (const t of transitions) t.settle();
  await flush();
  expect(isViewTransitionRunning()).toBe(false);
  for (const k of KEYS) (global as any)[k] = saved[k];
});

describe('起動できるかの判定', () => {
  test('API が無ければ起動しない', () => {
    expect(canViewTransition()).toBe(false);
  });

  test('API があれば起動する', () => {
    installViewTransitionApi();
    expect(canViewTransition()).toBe(true);
  });

  test('prefers-reduced-motion が有効なら、API があっても起動しない', () => {
    installDom(true);
    installViewTransitionApi();
    expect(canViewTransition()).toBe(false);
  });
});

describe('フォールバック（演出を諦めても更新は必ず走る）', () => {
  test('API が無い時は update をその場で呼ぶ', () => {
    let ran = 0;
    runViewTransition(() => ran++);
    expect(ran).toBe(1);
  });

  test('reduced-motion の時は update をその場で呼び、startViewTransition を呼ばない', () => {
    installDom(true);
    installViewTransitionApi();
    let ran = 0;
    runViewTransition(() => ran++);
    expect(ran).toBe(1);
    expect(started).toHaveLength(0);
  });

  test('startViewTransition が例外を投げたら update をその場で呼び、名前を残さない', () => {
    installViewTransitionApi();
    const a = card('cap-a');
    (dom.window.document as any).startViewTransition = () => {
      throw new Error('nope');
    };
    let ran = 0;
    runViewTransition(
      () => ran++,
      () => new Map([[a, 'post-card-cap-a']]),
    );
    expect(ran).toBe(1);
    expect(nameOf(a)).toBe('');
  });
});

describe('名前の付け外し', () => {
  test('コールバックが呼ばれる前に名前が付き、finished で剥がれる', async () => {
    installViewTransitionApi();
    const a = card('cap-a');
    const b = card('cap-b');
    let ran = 0;
    runViewTransition(
      () => ran++,
      () =>
        new Map([
          [a, 'post-card-cap-a'],
          [b, 'post-card-cap-b'],
        ]),
    );
    // 実 API と同じ順序＝古い状態のキャプチャは名前が付いた後、update はその後。
    expect(nameOf(a)).toBe('post-card-cap-a');
    expect(nameOf(b)).toBe('post-card-cap-b');
    expect(ran).toBe(0);
    expect(started).toHaveLength(1);

    started[0]();
    expect(ran).toBe(1);
    expect(nameOf(a)).toBe('post-card-cap-a'); // 新しい状態のキャプチャがまだ残っている

    finish();
    await flush();
    expect(nameOf(a)).toBe('');
    expect(nameOf(b)).toBe('');
    // 剥がすのは style プロパティだけ＝要素に空の style 属性を残さない
    expect(a.getAttribute('style')).toBe('');
  });

  test('finished が reject しても名前は剥がれる（次の回の重複を作らない）', async () => {
    installViewTransitionApi();
    const a = card('cap-a');
    runViewTransition(
      () => {},
      () => new Map([[a, 'post-card-cap-a']]),
    );
    expect(nameOf(a)).toBe('post-card-cap-a');
    fail();
    await flush();
    expect(nameOf(a)).toBe('');
  });
});

describe('遷移中フラグ（グリッドのカード入場を二重に走らせないための唯一の合図）', () => {
  test('コールバックの中で既に立っている＝グリッドの再描画がそれを見られる', () => {
    installViewTransitionApi();
    let insideCallback: boolean | null = null;
    runViewTransition(() => {
      insideCallback = isViewTransitionRunning();
    });
    expect(isViewTransitionRunning()).toBe(true); // 古い状態のキャプチャ中も立っている
    started[0]();
    expect(insideCallback).toBe(true);
  });

  test('finished で降りる', async () => {
    installViewTransitionApi();
    runViewTransition(() => {});
    started[0]();
    expect(isViewTransitionRunning()).toBe(true);
    finish();
    await flush();
    expect(isViewTransitionRunning()).toBe(false);
  });

  test('reject でも降りる（降りないとカード入場が二度と出なくなる）', async () => {
    installViewTransitionApi();
    runViewTransition(() => {});
    fail();
    await flush();
    expect(isViewTransitionRunning()).toBe(false);
  });

  test('API が無い回は立てない＝素の更新なので入場アニメは通常どおり出てよい', () => {
    let during: boolean | null = null;
    runViewTransition(() => {
      during = isViewTransitionRunning();
    });
    expect(during).toBe(false);
    expect(isViewTransitionRunning()).toBe(false);
  });

  test('名前が重複して諦めた回も立てない（演出が無いのに入場まで消えると何も動かない）', () => {
    installViewTransitionApi();
    const a = card('cap-a');
    const b = card('cap-a');
    let during: boolean | null = null;
    runViewTransition(
      () => {
        during = isViewTransitionRunning();
      },
      () =>
        new Map([
          [a, 'post-card-cap-a'],
          [b, 'post-card-cap-a'],
        ]),
    );
    expect(started).toHaveLength(0);
    expect(during).toBe(false);
  });

  test('連続で起動しても、先に終わった1本目で降りない（素朴な真偽値だと降りる）', async () => {
    installViewTransitionApi();
    runViewTransition(() => {}); // 1本目
    runViewTransition(() => {}); // 2本目（密度を続けて切り替えた時の形）
    expect(transitions).toHaveLength(2);
    transitions[0].settle(); // 先に始まった方だけ終わる
    await flush();
    expect(isViewTransitionRunning()).toBe(true); // 2本目はまだ走っている
    transitions[1].settle();
    await flush();
    expect(isViewTransitionRunning()).toBe(false);
  });
});

describe('重複検査（重複したまま起動すると、演出だけが無言で飛ぶ）', () => {
  test('同じ名前が2枚に付くなら起動せず、update だけ走る', () => {
    installViewTransitionApi();
    const a = card('cap-a');
    const b = card('cap-a'); // 仮想化でセルが再利用され、同じ captureId が2枚出た状態
    let ran = 0;
    runViewTransition(
      () => ran++,
      () =>
        new Map([
          [a, 'post-card-cap-a'],
          [b, 'post-card-cap-a'],
        ]),
    );
    expect(ran).toBe(1);
    expect(started).toHaveLength(0);
    expect(nameOf(a)).toBe(''); // 諦めた回は名前も付けない
    expect(nameOf(b)).toBe('');
  });

  test('DOM に生き残った名前とぶつかっても起動しない', () => {
    installViewTransitionApi();
    const leftover = card('cap-a'); // 前回の後始末が走らなかった残骸
    leftover.style.setProperty('view-transition-name', 'post-card-cap-a');
    const fresh = card('cap-a');
    let ran = 0;
    runViewTransition(
      () => ran++,
      () => new Map([[fresh, 'post-card-cap-a']]),
    );
    expect(ran).toBe(1);
    expect(started).toHaveLength(0);
  });

  test('自分が付け直す要素の古い名前は重複扱いにしない', () => {
    installViewTransitionApi();
    const a = card('cap-a');
    a.style.setProperty('view-transition-name', 'post-card-cap-a'); // 同じ要素・同じ名前
    let ran = 0;
    runViewTransition(
      () => ran++,
      () => new Map([[a, 'post-card-cap-a']]),
    );
    expect(started).toHaveLength(1);
    expect(ran).toBe(0);
  });

  test('名前が一意なら起動する', () => {
    installViewTransitionApi();
    const a = card('cap-a');
    const b = card('cap-b');
    runViewTransition(
      () => {},
      () =>
        new Map([
          [a, 'post-card-cap-a'],
          [b, 'post-card-cap-b'],
        ]),
    );
    expect(started).toHaveLength(1);
  });
});
