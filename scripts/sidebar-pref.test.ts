// Unit tests for the sidebar open/close (`sidebarOpen`) default value and its round trip
// through config.json (#678).
//
// The saving side copies the shape of inspector-pref.test.ts exactly (docs/testing.md:
// "copy this shape when adding a new preference") = swaps out `electron`, registers the
// real ipc-config.ts, wires its `set-pref` / `get-prefs` to the renderer's `window.hologram`
// stub, and watches the key name the renderer sends and main's allow-list (PREF_KEYS)
// connected end to end on one line.
//
// sidebar-pref.ts is much thinner than inspector-panel.ts (no module-owned state, no
// isVisible, just a pure read/write pair), so this integration test is kept light too.
// main's general accept/reject wiring is already thinly covered by panels-pref.test.ts,
// sidebarOpen key included (`each panel's state can be held at the same time`), so it is
// not duplicated here.
//
// The focus is what's specific to #678: the DEFAULT_OPEN value itself (the sole
// mechanism deciding whether a new profile's first render is the rail or expanded), and
// the round trip of cachedOpen/persistOpen/loadOpen.
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

// A stand-in for config.json itself. Held as a string = each time a handler reads or
// writes it, a real serialize round trip happens, so a test can't pass merely because it
// shares an object reference.
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

// --- stand-ins for localStorage / window.hologram -------------------------------
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

// The heart of #678: for a new profile (cachedOpen() is null), the first render is
// decided by AppShell's `cachedOpen() ?? DEFAULT_OPEN`. If this regresses to false, a new
// profile's first launch silently falls back to the expanded column — acceptance
// criterion 1 hinges on this single value.
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

// load()'s reconciliation (config.json wins) = mirrors the same-shape case from inspector-pref.test.ts.
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
