// Unit test that inspector open/close (`inspectorOpen`) reaches config.json (#391).
//
// Why this suite exists = **the dropped write was silent**. Main's `set-pref`
// discards any key not in the allowlist (PREF_KEYS in ipc-config.ts) by returning
// `{ok:false}`, and the renderer-side caller never reads that return value. So
// `inspectorOpen` survived for months "believing it was saving but never actually
// written", and `inspector-panel.ts`'s `load()`, which was supposed to reconcile
// against config.json, had become permanent dead code (localStorage's cache was
// the only place it was actually saved). A test that only looks at one end can't
// catch this — the question is whether the key name the renderer sends matches
// the key name main accepts — so this **connects both ends with a single line**.
//
// How they're connected: swap out `electron` and register the real ipc-config.ts,
// wiring its `set-pref` / `get-prefs` handlers straight into the window.hologram
// stub. Only the IPC transport is fake; the allowlist, default-value resolution,
// and cache reconciliation are all real product code running.
//
// A single Map stands in for localStorage (this module only uses getItem/setItem
// and the fact that values are strings). Nothing else touches the DOM, so jsdom
// isn't needed.
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

// Stands in for config.json itself. Held as a string so every read/write by a
// handler round-trips through real serialization, so it can't pass merely because
// they're sharing an object reference.
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

// --- stand-in for localStorage / window.hologram -------------------------------
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

// The renderer's bridge = calls the real handlers registered above directly.
const bridge = {
  getPrefs: async () => getPrefs(),
  setPref: async (key: string, value: unknown) => setPref(key, value),
};

// Stand-in for screen width. Width was once an input to `isVisible` (#259's narrow
// slide-over), so the two cases below drive wide<->narrow and assert that it no
// longer moves the answer — the guard against that coming back. It provides only the
// same shape as the real matchMedia (matches + change event), and `fireWidth` fires
// the listener. Nothing under test subscribes any more, which is the point.
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

// Open/close state lives inside the module, so re-import it per scenario (after seeding localStorage).
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

  // config.json can be hand-edited by a person = non-boolean values can end up in there. Fall back to the same handling as the other stored toggles.
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

// The heart of #391: load() is the process of "reconciling config.json against the
// cache at startup", and while the allowlisted key was missing it always did an
// early return, making it dead code. Now that it's alive again, pin it down.
describe('renderer: 起動時の突き合わせ（config.json が勝つ）', () => {
  test('config.json の外部編集がキャッシュに勝つ', async () => {
    cache.set(CACHE_KEY, 'false'); // previous startup = it was closed
    configJson = JSON.stringify({ inspectorOpen: true }); // rewritten to open outside the app
    const panel = await freshPanel();
    expect(panel.isOpen()).toBe(false); // the first render paints from the cache's guess
    let notified = 0;
    panel.subscribe(() => {
      notified++;
    });
    await panel.load();
    expect(panel.isOpen()).toBe(true);
    expect(notified).toBe(1); // it changed, so subscribers are notified
    expect(cache.get(CACHE_KEY)).toBe('true'); // the cache follows along too
  });

  test('localStorage を消しても config.json から復元される', async () => {
    configJson = JSON.stringify({ inspectorOpen: false });
    const panel = await freshPanel();
    expect(panel.isOpen()).toBe(true); // no cache = default is open
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

  // load() lands one tick after startup = if the user touched it during that gap, the user's action is newer.
  test('起動途中のユーザー操作は突き合わせに上書きされない', async () => {
    configJson = JSON.stringify({ inspectorOpen: true });
    const panel = await freshPanel();
    const pending = panel.load();
    panel.setOpen(false); // the user closed it before load() resolved
    await pending;
    expect(panel.isOpen()).toBe(false);
    expect(readStoredConfig().inspectorOpen).toBe(false);
  });

  // With two places it's saved, re-reading right after writing must give the same answer (stands in for a restart).
  test('保存 → 起動し直し（キャッシュ健在）で復元される', async () => {
    const first = await freshPanel();
    first.setOpen(false);
    vi.resetModules();
    const second = await freshPanel();
    await second.load();
    expect(second.isOpen()).toBe(false);
  });
});

// isVisible (P2-7) = "is it currently shown on screen". This is a different question
// from isOpen (= should it be shown), and it has four inputs. Why we pin this down =
// **there used to be two copies of this formula**. The shell assembles it on the
// React side, while modules outside React (inspector-builder / image-tab-builder /
// undo-builder) answered the same question by reading `#postDetail.hidden` back
// from the DOM. Now that the formula is unified into one, this locks down that
// each input actually has an effect.
describe('renderer: 画面に出ているか（isVisible）', () => {
  // Take all four inputs from the same generation of modules = after resetModules
  // they'd become separate instances, so import them together.
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
    expect(panel.isOpen()).toBe(true); // only hidden = the saved selection is untouched
    panels.setHidden(false);
    expect(panel.isVisible()).toBe(true);
  });

  // #975: the panel is a docked column at every width, so neither the window's size nor
  // the selection may take it off screen. #259 had both do exactly that below 1280px
  // (an overlay riding on the selection), and this is the guard against that coming back.
  test('狭幅でも同じに出る＝幅も選択も表示条件ではない', async () => {
    const { panel, store } = await freshWorld();
    fireWidth(false);
    expect(panel.isVisible()).toBe(true); // nothing selected: the column stands on its placeholder (#244)
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
    panel.setOpen(false); // (1) the panel itself
    panels.setHidden(true); // (2) bulk mask
    fireWidth(false); // not an input any more (#975)
    store.store.setState({ inspectedKey: 'post:1' }); // nor this one
    expect(notified).toBe(2);
    off();
    panel.setOpen(true);
    expect(notified).toBe(2);
  });
});
