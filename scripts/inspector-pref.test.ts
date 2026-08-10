// インスペクタの開閉 (`inspectorOpen`) が config.json まで届くことの単体テスト (#391)。
//
// このスイートがある理由＝落ちた書き込みが沈黙していたから。main の `set-pref` は許可リスト
// （ipc-config.ts の PREF_KEYS）に無いキーを `{ok:false}` を返して捨てるが、レンダラー側の
// 呼び出しはその返り値を一度も読まない。そのため `inspectorOpen` は「保存しているつもりで
// 一度も書かれていない」まま何か月も生き延び、config.json と突き合わせるはずだった
// `inspector-panel.ts` の `load()` は恒久的な死んだコードになっていた（実際に保存されて
// いたのは localStorage のキャッシュだけ）。片端だけを見るテストではこれを捕まえられない＝
// 問うべきは、レンダラーが送るキー名と main が受けるキー名が一致するかどうかなので、ここでは
// 両端を1本の線でつなぐ。
//
// つなぎ方: `electron` を差し替えて本物の ipc-config.ts を登録し、その `set-pref` /
// `get-prefs` のハンドラをそのまま window.hologram の差し替えへ配線する。偽物は IPC の
// 運び屋だけで、許可リスト・既定値の解決・キャッシュの突き合わせは、どれも製品のコードが
// そのまま動いている。
//
// localStorage の代役は Map 1つ（このモジュールは getItem/setItem と、値が文字列である
// ことしか使わない）。他に DOM を触るものが無いので jsdom は要らない。
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { IpcContext } from '../app/src/main/ipc-context';
import { register as registerConfigIpc } from '../app/src/main/ipc-config';

type Handler = (event: unknown, ...args: any[]) => any;

const stub = vi.hoisted(() => ({ handlers: new Map<string, Handler>() }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => {
      stub.handlers.set(channel, handler);
    },
  },
  app: { getVersion: () => '0.0.0-test' },
}));

// config.json そのものの代役。文字列で持つので、ハンドラの読み書きは毎回、実際の直列化を
// 往復する。オブジェクトの参照を共有しているだけで通ってしまうことがない。
let configJson = '{}';
const readStoredConfig = () => JSON.parse(configJson) as Record<string, unknown>;

const ctx = {
  readConfig: () => JSON.parse(configJson),
  writeConfig: (next: unknown) => {
    configJson = JSON.stringify(next);
  },
  getSaveFolder: () => null,
  getDbWriter: () => ({}),
  installer: {},
  getWin: () => null,
} as unknown as IpcContext;

registerConfigIpc(ctx);

const setPref = (key: string, value: unknown) => stub.handlers.get('set-pref')?.(null, key, value);
const getPrefs = () => stub.handlers.get('get-prefs')?.(null);

// --- localStorage / window.hologram の代役 ---------------------------------------
const cache = new Map<string, string>();
const localStorageStub = {
  getItem: (k: string) => (cache.has(k) ? (cache.get(k) as string) : null),
  setItem: (k: string, v: string) => {
    cache.set(k, String(v));
  },
  removeItem: (k: string) => {
    cache.delete(k);
  },
};

// レンダラーのブリッジ＝上で登録した本物のハンドラを直に呼ぶ。
const bridge = {
  getPrefs: async () => getPrefs(),
  setPref: async (key: string, value: unknown) => setPref(key, value),
};

// 画面幅の代役。幅はかつて `isVisible` の入力だった（#259 の狭幅スライドオーバー）ので、下の
// 2つのケースは広幅と狭幅を行き来させ、いまはもう答えを動かさないことを見る＝それが戻って
// くることへの防ぎ。用意しているのは本物の matchMedia と同じ形（matches と change イベント）
// だけで、`fireWidth` がリスナーを起こす。もう誰も購読していない、というのが要点。
let mediaListener: ((e: { matches: boolean }) => void) | null = null;
let mediaMatches = true;
function fireWidth(wide: boolean): void {
  mediaMatches = wide;
  mediaListener?.({ matches: wide });
}

beforeEach(() => {
  configJson = '{}';
  cache.clear();
  mediaListener = null;
  mediaMatches = true;
  (globalThis as any).localStorage = localStorageStub;
  (globalThis as any).window = { hologram: bridge };
  (globalThis as any).matchMedia = () => ({
    get matches() {
      return mediaMatches;
    },
    addEventListener: (_type: string, cb: (e: { matches: boolean }) => void) => {
      mediaListener = cb;
    },
  });
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  (globalThis as any).matchMedia = undefined;
});

// 開閉の状態はモジュールの中にあるので、シナリオごとに（localStorage へ種を入れてから）import し直す。
type PanelModule = typeof import('../app/src/renderer/src/services/inspector-panel');
const freshPanel = (): Promise<PanelModule> => import('../app/src/renderer/src/services/inspector-panel');

const CACHE_KEY = 'hologram-inspector-open';

describe('main: 許可キーと get-prefs', () => {
  test('inspectorOpen は受け付けられ config.json へ書かれる', () => {
    expect(setPref('inspectorOpen', false)).toEqual({ ok: true });
    expect(readStoredConfig().inspectorOpen).toBe(false);
  });

  test('書いた値は get-prefs に出てくる', () => {
    setPref('inspectorOpen', false);
    expect(getPrefs().inspectorOpen).toBe(false);
  });

  test('未設定は null＝「一度も切り替えていない」（false ではない）', () => {
    expect(getPrefs().inspectorOpen).toBeNull();
  });

  // config.json は人が手で編集できる＝真偽値でない値が入りうる。他の保存済みの切り替えと同じ扱いへ倒す。
  test('真偽値でない値は null へ倒す', () => {
    configJson = JSON.stringify({ inspectorOpen: 'false' });
    expect(getPrefs().inspectorOpen).toBeNull();
  });

  test('許可キーに無いキーは拒否され、その事実がログに出る', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(setPref('inspectorOpn', false)).toEqual({ ok: false });
    expect(readStoredConfig()).not.toHaveProperty('inspectorOpn');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('inspectorOpn');
  });
});

describe('renderer: 開閉の保存', () => {
  test('setOpen は config.json と localStorage の両方へ書く', async () => {
    const panel = await freshPanel();
    panel.setOpen(false);
    expect(readStoredConfig().inspectorOpen).toBe(false);
    expect(cache.get(CACHE_KEY)).toBe('false');
    expect(panel.isOpen()).toBe(false);
  });

  test('toggle も同じ経路を通る', async () => {
    const panel = await freshPanel();
    panel.toggle();
    expect(panel.isOpen()).toBe(false);
    expect(readStoredConfig().inspectorOpen).toBe(false);
  });
});

// #391 の核心。load() は「起動時に config.json とキャッシュを突き合わせる」処理で、許可リストに
// キーが無かった間はいつも早期に return しており、死んだコードになっていた。生き返ったので固定する。
describe('renderer: 起動時の突き合わせ（config.json が勝つ）', () => {
  test('config.json の外部編集がキャッシュに勝つ', async () => {
    cache.set(CACHE_KEY, 'false'); // 前回の起動＝閉じていた
    configJson = JSON.stringify({ inspectorOpen: true }); // アプリの外で開くように書き換えられた
    const panel = await freshPanel();
    expect(panel.isOpen()).toBe(false); // 最初の描画はキャッシュの推測で塗る
    let notified = 0;
    panel.subscribe(() => {
      notified++;
    });
    await panel.load();
    expect(panel.isOpen()).toBe(true);
    expect(notified).toBe(1); // 変わったので購読者へ知らせる
    expect(cache.get(CACHE_KEY)).toBe('true'); // キャッシュも追従する
  });

  test('localStorage を消しても config.json から復元される', async () => {
    configJson = JSON.stringify({ inspectorOpen: false });
    const panel = await freshPanel();
    expect(panel.isOpen()).toBe(true); // キャッシュが無い＝既定は開
    await panel.load();
    expect(panel.isOpen()).toBe(false);
    expect(cache.get(CACHE_KEY)).toBe('false');
  });

  test('config.json 側が未設定ならキャッシュの値が残る', async () => {
    cache.set(CACHE_KEY, 'false');
    const panel = await freshPanel();
    await panel.load();
    expect(panel.isOpen()).toBe(false);
  });

  test('一致していれば購読者を起こさない', async () => {
    cache.set(CACHE_KEY, 'false');
    configJson = JSON.stringify({ inspectorOpen: false });
    const panel = await freshPanel();
    let notified = 0;
    panel.subscribe(() => {
      notified++;
    });
    await panel.load();
    expect(notified).toBe(0);
  });

  // load() が着地するのは起動から1ティック後＝その隙に利用者が触っていたら、利用者の操作の方が新しい。
  test('起動途中のユーザー操作は突き合わせに上書きされない', async () => {
    configJson = JSON.stringify({ inspectorOpen: true });
    const panel = await freshPanel();
    const pending = panel.load();
    panel.setOpen(false); // load() が解決するより前に利用者が閉じた
    await pending;
    expect(panel.isOpen()).toBe(false);
    expect(readStoredConfig().inspectorOpen).toBe(false);
  });

  // 保存先が2か所あるので、書いた直後に読み直しても同じ答えでなければいけない（起動し直しの代役）。
  test('保存 → 起動し直し（キャッシュ健在）で復元される', async () => {
    const first = await freshPanel();
    first.setOpen(false);
    vi.resetModules();
    const second = await freshPanel();
    await second.load();
    expect(second.isOpen()).toBe(false);
  });
});

// isVisible (P2-7)＝「いま画面に出ているか」。これは isOpen（＝出すべきか）とは別の問いで、
// 入力が4つある。ここを固定する理由＝この式の複製がかつて2つあったから。シェルは React 側で
// これを組み立て、React の外のモジュール（inspector-builder / image-tab-builder /
// undo-builder）は同じ問いに、DOM から `#postDetail.hidden` を読み戻して答えていた。式が1つに
// 統合されたいま、各入力が実際に効いていることをここで固定する。
describe('renderer: 画面に出ているか（isVisible）', () => {
  // 4つの入力を同じ世代のモジュールから取る＝resetModules の後は別々の実体になるので、まとめて import する。
  async function freshWorld() {
    const panel = await freshPanel();
    const panels = await import('../app/src/renderer/src/services/panels');
    const store = await import('../app/src/renderer/src/services/store');
    return { panel, panels, store };
  }

  test('既定（広幅・開・マスク無し）は出ている＝未選択でもプレースホルダを出す', async () => {
    const { panel } = await freshWorld();
    expect(panel.isVisible()).toBe(true);
  });

  test('ユーザーが閉じたら出ていない', async () => {
    const { panel } = await freshWorld();
    panel.setOpen(false);
    expect(panel.isVisible()).toBe(false);
  });

  test('#245 の一括マスクは、パネル自身の状態を変えずに隠す', async () => {
    const { panel, panels } = await freshWorld();
    panels.setHidden(true);
    expect(panel.isVisible()).toBe(false);
    expect(panel.isOpen()).toBe(true); // 隠れただけ＝保存された選択には触れない
    panels.setHidden(false);
    expect(panel.isVisible()).toBe(true);
  });

  // #975: このパネルはどの幅でも据え付けの列なので、ウィンドウの大きさも選択も、これを画面から
  // 消してはいけない。#259 では 1280px を下回ると両方がまさにそれをしていた（選択に乗って出る
  // オーバーレイ）。ここはそれが戻ってくることへの防ぎ。
  test('狭幅でも同じに出る＝幅も選択も表示条件ではない', async () => {
    const { panel, store } = await freshWorld();
    fireWidth(false);
    expect(panel.isVisible()).toBe(true); // 何も選ばれていない。列はプレースホルダで立つ (#244)
    store.store.setState({ inspectedKey: 'post:1' });
    expect(panel.isVisible()).toBe(true);
    store.store.setState({ inspectedKey: null });
    expect(panel.isVisible()).toBe(true);
  });

  test('subscribeVisible は2つの入力で起き、解除できる', async () => {
    const { panel, panels, store } = await freshWorld();
    let notified = 0;
    const off = panel.subscribeVisible(() => {
      notified++;
    });
    panel.setOpen(false); // (1) パネル自身
    panels.setHidden(true); // (2) 一括マスク
    fireWidth(false); // もう入力ではない (#975)
    store.store.setState({ inspectedKey: 'post:1' }); // これも入力ではない
    expect(notified).toBe(2);
    off();
    panel.setOpen(true);
    expect(notified).toBe(2);
  });
});
