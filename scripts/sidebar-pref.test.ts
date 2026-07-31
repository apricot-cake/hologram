// サイドバー開閉（`sidebarOpen`）の既定値とconfig.json往復のユニットテスト（#678）。
//
// 保存の側は inspector-pref.test.ts の形をそのまま写している（docs/testing.md「新しい
// プリファレンスを足す時はこの形を写す」）＝`electron` を差し替えて本物の ipc-config.ts を
// 登録し、その `set-pref` / `get-prefs` をレンダラーの `window.hologram` スタブへ配線して、
// レンダラーが送るキー名と main の許可キー（PREF_KEYS）を1本の線でつなげて見る。
//
// sidebar-pref.ts は inspector-panel.ts よりずっと薄い（モジュール所有の状態も isVisible
// も無い、純粋な read/write の対）ので、この一本化テストも軽く作る。main 側の一般的な
// accept/reject 配線は panels-pref.test.ts が sidebarOpen キー込みで既に薄く見ている
// （`各パネルの状態と同時に持てる`）ので、ここでは重複させない。
//
// 焦点は #678 固有のもの: DEFAULT_OPEN の値そのもの（新規プロファイルの初回描画が
// レールか展開かを決める唯一の仕掛け）と、cachedOpen/persistOpen/loadOpen の往復。
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

const bridge = {
  getPrefs: async () => getPrefs(),
  setPref: async (key: string, value: unknown) => setPref(key, value),
};

beforeEach(() => {
  configJson = '{}';
  cache.clear();
  (globalThis as any).localStorage = localStorageStub;
  (globalThis as any).window = { hologram: bridge };
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type PrefModule = typeof import('../app/src/renderer/src/services/sidebar-pref');
const freshPref = (): Promise<PrefModule> => import('../app/src/renderer/src/services/sidebar-pref');

const CACHE_KEY = 'hologram-sidebar-open';

// #678 の本体: 新規プロファイル（cachedOpen() が null）の初回描画は AppShell が
// `cachedOpen() ?? DEFAULT_OPEN` で決める。ここが false へ回帰すると、新規プロファイルの
// 初回起動が黙って展開カラムへ戻る——受け入れ条件1がこの値1つにかかっている。
describe('既定値', () => {
  test('DEFAULT_OPEN は false（新規プロファイルの初回描画はレール）', async () => {
    const pref = await freshPref();
    expect(pref.DEFAULT_OPEN).toBe(false);
  });
});

describe('cachedOpen', () => {
  test('未設定は null', async () => {
    const pref = await freshPref();
    expect(pref.cachedOpen()).toBeNull();
  });
});

describe('config.json / localStorage の往復', () => {
  test('persistOpen は両方へ書き、cachedOpen が読み戻す', async () => {
    const pref = await freshPref();
    pref.persistOpen(true);
    expect(readStoredConfig().sidebarOpen).toBe(true);
    expect(cache.get(CACHE_KEY)).toBe('true');
    expect(pref.cachedOpen()).toBe(true);
  });

  test('false も同じ経路で往復する', async () => {
    const pref = await freshPref();
    pref.persistOpen(false);
    expect(readStoredConfig().sidebarOpen).toBe(false);
    expect(pref.cachedOpen()).toBe(false);
  });
});

// load() の突き合わせ（config.json が勝つ）＝ inspector-pref.test.ts の同型ケースを写す。
describe('loadOpen（起動時の突き合わせ）', () => {
  test('config.json の値が返り、キャッシュへ反映される', async () => {
    configJson = JSON.stringify({ sidebarOpen: true });
    const pref = await freshPref();
    expect(await pref.loadOpen()).toBe(true);
    expect(cache.get(CACHE_KEY)).toBe('true');
  });

  test('config.json が未設定なら null（キャッシュの推測を上書きしない）', async () => {
    const pref = await freshPref();
    expect(await pref.loadOpen()).toBeNull();
  });

  test('真偽値でない値は null へ倒す', async () => {
    configJson = JSON.stringify({ sidebarOpen: 'true' });
    const pref = await freshPref();
    expect(await pref.loadOpen()).toBeNull();
  });
});
