// Bulk show/hide toggle for surrounding UI (#245) — unit tests for the save round trip and key detection.
//
// The save side copies the shape of inspector-pref.test.ts verbatim (docs/testing.md: "copy
// this shape when adding a new preference") — it swaps out `electron` to register the real
// ipc-config.ts, then wires its `set-pref` / `get-prefs` up to the renderer's `window.hologram`
// stub, checking **that the key name the renderer sends and main's allow-list (PREF_KEYS) are
// connected by a single line**. Looking at only one end won't catch it: `set-pref` silently
// drops any key not in the allow list with `{ok:false}`, and the caller doesn't read that
// return value, so a missed key name **fails silently and even looks like it saved**
// (#391's `inspectorOpen` was like that for months).
//
// On top of the save round trip, this suite also exercises the substance of #245 itself. If
// the design that the bulk state is **a mask that covers without rewriting** the two panels'
// state (per the header of services/panels.ts) actually holds, then "hide -> restart -> restore"
// should return the original combination — which doesn't hold for an implementation that keeps
// a separate snapshot in memory. That's what pins down the implementation choice itself here.
//
// Key detection (Ctrl+Shift+B) is checked separately because its counterpart Ctrl+B lives in a
// different file (SidebarProvider in components/ui/sidebar.tsx) — the two handlers end up
// contending for the same physical key, and whether Shift is held is the only dividing line.
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

// Stand-in for config.json itself. Held as a string, so the handler genuinely does a full
// round trip through serialization on every read/write — it never passes just because it's sharing an object.
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

// --- Stand-ins for localStorage / window.hologram -------------------------------
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

// State lives inside the module, so re-import per scenario (after seeding localStorage).
type PanelsModule = typeof import('../app/src/renderer/src/services/panels');
const freshPanels = (): Promise<PanelsModule> => import('../app/src/renderer/src/services/panels');
type InspectorModule = typeof import('../app/src/renderer/src/services/inspector-panel');
const freshInspector = (): Promise<InspectorModule> => import('../app/src/renderer/src/services/inspector-panel');

const CACHE_KEY = 'hologram-panels-hidden';

describe('main: 許可キーと get-prefs', () => {
  test('panelsHidden は受け付けられ config.json へ書かれる', () => {
    expect(setPref('panelsHidden', true)).toEqual({ ok: true });
    expect(readStoredConfig().panelsHidden).toBe(true);
  });

  test('書いた値は get-prefs に出てくる', () => {
    setPref('panelsHidden', true);
    expect(getPrefs().panelsHidden).toBe(true);
  });

  test('未設定は null＝「一度も使っていない」（false ではない）', () => {
    expect(getPrefs().panelsHidden).toBeNull();
  });

  // config.json can be hand-edited by a person, so non-boolean values can end up in it. Same handling as the other open/close preferences.
  test('真偽値でない値は null へ倒す', () => {
    configJson = JSON.stringify({ panelsHidden: 'true' });
    expect(getPrefs().panelsHidden).toBeNull();
  });

  // The bulk state and each panel's state are saved independently — restoring by looking at only one of them isn't possible.
  test('各パネルの状態と同時に持てる', () => {
    setPref('sidebarOpen', true);
    setPref('inspectorOpen', false);
    setPref('panelsHidden', true);
    expect(getPrefs()).toMatchObject({ sidebarOpen: true, inspectorOpen: false, panelsHidden: true });
  });
});

describe('renderer: 一括状態の保存', () => {
  test('既定は「隠していない」', async () => {
    const panels = await freshPanels();
    expect(panels.isHidden()).toBe(false);
  });

  test('setHidden は config.json と localStorage の両方へ書く', async () => {
    const panels = await freshPanels();
    panels.setHidden(true);
    expect(readStoredConfig().panelsHidden).toBe(true);
    expect(cache.get(CACHE_KEY)).toBe('true');
    expect(panels.isHidden()).toBe(true);
  });

  test('toggle も同じ経路を通る', async () => {
    const panels = await freshPanels();
    panels.toggle();
    expect(panels.isHidden()).toBe(true);
    expect(readStoredConfig().panelsHidden).toBe(true);
    panels.toggle();
    expect(panels.isHidden()).toBe(false);
    expect(readStoredConfig().panelsHidden).toBe(false);
  });

  test('同じ値の再設定は購読者を起こさない', async () => {
    const panels = await freshPanels();
    let notified = 0;
    panels.subscribe(() => {
      notified++;
    });
    panels.setHidden(false);
    expect(notified).toBe(0);
    panels.setHidden(true);
    expect(notified).toBe(1);
  });

  test('reveal は隠れていない時は何もしない', async () => {
    const panels = await freshPanels();
    let notified = 0;
    panels.subscribe(() => {
      notified++;
    });
    panels.reveal();
    expect(notified).toBe(0);
    panels.setHidden(true);
    panels.reveal();
    expect(panels.isHidden()).toBe(false);
    expect(notified).toBe(2);
  });
});

// The core of #245's design: the bulk state is a mask, and it doesn't touch the panels' own
// state while covering them. An implementation that keeps a separate snapshot loses track of
// the combination the instant that snapshot evaporates — the "can restore across a restart" test below would fail.
describe('renderer: マスクは各パネルの状態を書き換えない', () => {
  // The combination right before covering: sidebar open, detail panel closed (both tipped to
  // the side opposite their defaults, so a restore that merely fell back to defaults isn't misread as "restored").
  test('隠している間もパネル自身の保存値はそのまま', async () => {
    const inspector = await freshInspector();
    const panels = await freshPanels();
    inspector.setOpen(false);
    setPref('sidebarOpen', true);
    panels.setHidden(true);
    expect(inspector.isOpen()).toBe(false);
    expect(getPrefs()).toMatchObject({ sidebarOpen: true, inspectorOpen: false, panelsHidden: true });
  });

  test('隠す → 再起動 → 戻す で元の組み合わせが返る', async () => {
    const inspector = await freshInspector();
    const panels = await freshPanels();
    inspector.setOpen(false);
    setPref('sidebarOpen', true);
    panels.setHidden(true);

    vi.resetModules(); // Restart (only localStorage and config.json survive)
    const inspector2 = await freshInspector();
    const panels2 = await freshPanels();
    await panels2.load();
    await inspector2.load();
    expect(panels2.isHidden()).toBe(true);

    panels2.reveal();
    expect(panels2.isHidden()).toBe(false);
    expect(inspector2.isOpen()).toBe(false);
    expect(getPrefs().sidebarOpen).toBe(true);
  });
});

describe('renderer: 起動時の突き合わせ（config.json が勝つ）', () => {
  test('config.json の外部編集がキャッシュに勝つ', async () => {
    cache.set(CACHE_KEY, 'false');
    configJson = JSON.stringify({ panelsHidden: true });
    const panels = await freshPanels();
    expect(panels.isHidden()).toBe(false); // The first render paints using the cache's guess
    let notified = 0;
    panels.subscribe(() => {
      notified++;
    });
    await panels.load();
    expect(panels.isHidden()).toBe(true);
    expect(notified).toBe(1);
    expect(cache.get(CACHE_KEY)).toBe('true');
  });

  test('config.json 側が未設定ならキャッシュの値が残る', async () => {
    cache.set(CACHE_KEY, 'true');
    const panels = await freshPanels();
    await panels.load();
    expect(panels.isHidden()).toBe(true);
  });

  // load() lands one tick after startup — if the user pressed something in that window, that's the newer value.
  test('起動途中のユーザー操作は突き合わせに上書きされない', async () => {
    cache.set(CACHE_KEY, 'true'); // Ended last time still hidden
    configJson = JSON.stringify({ panelsHidden: true });
    const panels = await freshPanels();
    const pending = panels.load();
    panels.setHidden(false); // User reverted it before the reconciliation landed
    await pending;
    expect(panels.isHidden()).toBe(false);
    expect(readStoredConfig().panelsHidden).toBe(false);
  });
});

// Ctrl+Shift+B. Its counterpart Ctrl+B lives on the SidebarProvider side, so if the boundary
// (whether Shift is held) isn't enforced here, the two shortcuts fire at the same time.
describe('renderer: Ctrl+Shift+B の判定', () => {
  const key = (init: Partial<KeyboardEvent> & { key: string }) => {
    let prevented = false;
    const preventDefault = () => {
      prevented = true;
    };
    return {
      ev: { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, preventDefault, ...init } as unknown as KeyboardEvent,
      wasPrevented: () => prevented,
    };
  };

  test('Ctrl+Shift+B で切り替わる', async () => {
    const panels = await freshPanels();
    const k = key({ key: 'B', ctrlKey: true, shiftKey: true });
    panels.handleShortcutPanelsKey(k.ev);
    expect(panels.isHidden()).toBe(true);
    expect(k.wasPrevented()).toBe(true);
  });

  // The same chord must mean the same thing even if Caps Lock swaps 'b'/'B'.
  test('小文字で届いても同じ', async () => {
    const panels = await freshPanels();
    panels.handleShortcutPanelsKey(key({ key: 'b', ctrlKey: true, shiftKey: true }).ev);
    expect(panels.isHidden()).toBe(true);
  });

  test('Shift 無しは相方（サイドバー単体）のもの＝ここは手を出さない', async () => {
    const panels = await freshPanels();
    const k = key({ key: 'b', ctrlKey: true });
    panels.handleShortcutPanelsKey(k.ev);
    expect(panels.isHidden()).toBe(false);
    expect(k.wasPrevented()).toBe(false);
  });

  test('Alt が乗っていたら無視する', async () => {
    const panels = await freshPanels();
    panels.handleShortcutPanelsKey(key({ key: 'B', ctrlKey: true, shiftKey: true, altKey: true }).ev);
    expect(panels.isHidden()).toBe(false);
  });

  test('修飾なしの B はただの文字', async () => {
    const panels = await freshPanels();
    panels.handleShortcutPanelsKey(key({ key: 'B', shiftKey: true }).ev);
    expect(panels.isHidden()).toBe(false);
  });

  test('入力欄で打っている間は横取りしない', async () => {
    const panels = await freshPanels();
    const k = key({ key: 'B', ctrlKey: true, shiftKey: true, target: { tagName: 'INPUT' } as any });
    panels.handleShortcutPanelsKey(k.ev);
    expect(panels.isHidden()).toBe(false);
    expect(k.wasPrevented()).toBe(false);
  });

  test('contenteditable も同じ', async () => {
    const panels = await freshPanels();
    panels.handleShortcutPanelsKey(key({ key: 'B', ctrlKey: true, shiftKey: true, target: { tagName: 'DIV', isContentEditable: true } as any }).ev);
    expect(panels.isHidden()).toBe(false);
  });
});
