// インスペクタ開閉（`inspectorOpen`）が config.json に届くことのユニットテスト（#391）。
//
// このスイートが存在する理由＝**取りこぼしが無言だった**から。main の `set-pref` は許可キー
// （ipc-config.ts の PREF_KEYS）に無いキーを `{ok:false}` で捨て、レンダラー側の呼び出しは
// その返り値を読まない。だから `inspectorOpen` は「保存しているつもりで一度も書かれない」
// まま数ヶ月生き延び、config.json を突き合わせるはずの `inspector-panel.ts` の `load()` は
// 恒久的な dead code になっていた（localStorage のキャッシュだけが実際の保存先だった）。
// 片端だけを見るテストではこれを捕まえられない＝レンダラーが送るキー名と main が受け付ける
// キー名が一致しているかが問題なので、**両端を1本の線でつなげて**見る。
//
// つなぎ方: `electron` を差し替えて本物の ipc-config.ts を登録し、その `set-pref` /
// `get-prefs` ハンドラを window.hologram のスタブへそのまま配線する。IPC の輸送だけが偽物で、
// 許可キー・既定値の解決・キャッシュとの突き合わせはすべて製品コードが走る。
//
// localStorage は Map 一枚の代役で足りる（このモジュールが使うのは getItem/setItem の2つと、
// 値が文字列であることだけ）。DOM は他に一切触らないので jsdom は要らない。
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

// config.json そのものの代役。文字列で持つ＝ハンドラが読み書きするたびに本当に
// シリアライズを1往復するので、「オブジェクトを共有しているから通っただけ」が起きない。
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

// --- localStorage / window.hologram の代役 -------------------------------
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

// レンダラーのブリッジ＝上で登録した本物のハンドラをそのまま呼ぶ。
const bridge = {
  getPrefs: async () => getPrefs(),
  setPref: async (key: string, value: unknown) => setPref(key, value),
};

// 画面幅（layout-mode.ts）の代役。`isVisible` の入力の一つが幅なので、テストから
// 広⇔狭を動かせるようにする＝本物の matchMedia と同じ形（matches ＋ change イベント）
// だけを備え、`fireWidth` でリスナーを起こす。
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

// モジュール内に開閉状態を持つので、シナリオごとに読み直す（localStorage を仕込んでから）。
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

  // config.json は人が手で編集できる＝真偽値以外が入りうる。sidebarOpen と同じ扱いに落とす。
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

// #391 の本体: load() は「起動時に config.json をキャッシュへ突き合わせる」処理で、
// 許可キーが無かった間は必ず早期 return する dead code だった。生き返ったので固定する。
describe('renderer: 起動時の突き合わせ（config.json が勝つ）', () => {
  test('config.json の外部編集がキャッシュに勝つ', async () => {
    cache.set(CACHE_KEY, 'false'); // 前回の起動＝閉じていた
    configJson = JSON.stringify({ inspectorOpen: true }); // アプリの外で開くよう書き換えられた
    const panel = await freshPanel();
    expect(panel.isOpen()).toBe(false); // 初回描画はキャッシュの推測で塗る
    let notified = 0;
    panel.subscribe(() => {
      notified++;
    });
    await panel.load();
    expect(panel.isOpen()).toBe(true);
    expect(notified).toBe(1); // 変わったので購読者へ伝わる
    expect(cache.get(CACHE_KEY)).toBe('true'); // キャッシュも追従
  });

  test('localStorage を消しても config.json から復元される', async () => {
    configJson = JSON.stringify({ inspectorOpen: false });
    const panel = await freshPanel();
    expect(panel.isOpen()).toBe(true); // キャッシュ不在＝既定は開
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

  // load() は起動から1tick 遅れて着地する＝その間にユーザーが触っていたら、そちらが新しい。
  test('起動途中のユーザー操作は突き合わせに上書きされない', async () => {
    configJson = JSON.stringify({ inspectorOpen: true });
    const panel = await freshPanel();
    const pending = panel.load();
    panel.setOpen(false); // load() が解決する前にユーザーが閉じた
    await pending;
    expect(panel.isOpen()).toBe(false);
    expect(readStoredConfig().inspectorOpen).toBe(false);
  });

  // 保存先が2つある以上、書いた直後に読み直しても同じ答えになることが要る（再起動の代役）。
  test('保存 → 起動し直し（キャッシュ健在）で復元される', async () => {
    const first = await freshPanel();
    first.setOpen(false);
    vi.resetModules();
    const second = await freshPanel();
    await second.load();
    expect(second.isOpen()).toBe(false);
  });
});

// isVisible（P2⑦）＝「いま画面に出ているか」。isOpen（＝出ているべきか）とは別の問いで、
// 入力が4つある。これを固定する理由＝**この式の写しが2つあった**から。シェルが React 側で
// 組み立て、React の外のモジュール（inspector-builder / image-tab-builder / undo-builder）は
// 同じ問いを `#postDetail.hidden` を DOM から読み返して答えていた。式を1本にした以上、
// 各入力が効いていることをここで押さえる。
describe('renderer: 画面に出ているか（isVisible）', () => {
  // 4つの入力を同じ世代のモジュールから取る＝resetModules 後は別インスタンスになるので、
  // まとめて import する。
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
    expect(panel.isOpen()).toBe(true); // 隠されただけ＝保存された選択は無傷
    panels.setHidden(false);
    expect(panel.isVisible()).toBe(true);
  });

  // 狭幅ではオーバーレイ＝選択に乗る（#259/#244）。何も選ばれていないのに浮いていると
  // 画面に穴が開くだけなので出ない。
  test('狭幅は選択があるときだけ出る', async () => {
    const { panel, store } = await freshWorld();
    fireWidth(false);
    expect(panel.isVisible()).toBe(false);
    store.set('inspectedKey', 'post:1');
    expect(panel.isVisible()).toBe(true);
    store.set('inspectedKey', null);
    expect(panel.isVisible()).toBe(false);
  });

  test('subscribeVisible は4つの入力すべてで起き、解除できる', async () => {
    const { panel, panels, store } = await freshWorld();
    let notified = 0;
    const off = panel.subscribeVisible(() => {
      notified++;
    });
    panel.setOpen(false); // ①パネル自身
    panels.setHidden(true); // ②一括マスク
    fireWidth(false); // ③幅
    store.set('inspectedKey', 'post:1'); // ④選択
    expect(notified).toBe(4);
    off();
    panel.setOpen(true);
    store.set('inspectedKey', null);
    expect(notified).toBe(4);
  });
});
