// 周辺UIの一括表示トグル（#245）— 保存の往復とキー判定のユニットテスト。
//
// 保存の側は inspector-pref.test.ts の形をそのまま写している（docs/testing.md「新しい
// プリファレンスを足す時はこの形を写す」）＝`electron` を差し替えて本物の ipc-config.ts を
// 登録し、その `set-pref` / `get-prefs` をレンダラーの `window.hologram` スタブへ配線して、
// **レンダラーが送るキー名と main の許可キー（PREF_KEYS）を1本の線でつなげて**見る。
// 片端だけを見ても捕まらない＝`set-pref` は許可キーに無いキーを `{ok:false}` で捨て、
// 呼び出し側はその返り値を読まないので、キー名の取りこぼしは**無言で、しかも保存できて
// いるように見える**（#391 の `inspectorOpen` が数ヶ月そうだった）。
//
// 保存の往復に加えて、このスイートは #245 の中身そのものも見る。一括状態は2つのパネルの
// 状態を**書き換えず覆うマスク**だという設計（services/panels.ts のヘッダ）が本物なら、
// 「隠す → 再起動 → 戻す」で元の組み合わせが返ってくるはずで、それはスナップショットを
// メモリに持つ実装では成立しない＝ここが実装の選択そのものを固定している。
//
// キー判定（Ctrl+Shift+B）を別立てで見るのは、相方の Ctrl+B が別ファイル
// （components/ui/sidebar.tsx の SidebarProvider）にいるため＝2つのハンドラが同じ物理キーを
// 取り合う形になっていて、Shift の有無だけが境界線になっている。
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

// モジュール内に状態を持つので、シナリオごとに読み直す（localStorage を仕込んでから）。
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

  // config.json は人が手で編集できる＝真偽値以外が入りうる。他の開閉プリファレンスと同じ扱い。
  test('真偽値でない値は null へ倒す', () => {
    configJson = JSON.stringify({ panelsHidden: 'true' });
    expect(getPrefs().panelsHidden).toBeNull();
  });

  // 一括状態と各パネルの状態は独立に保存される＝どちらか片方だけを見て復元できない。
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

// #245 の設計の核＝一括状態はマスクで、覆っている間パネル自身の状態には触らない。
// スナップショットを別に持つ実装だと、そのスナップショットが揮発した瞬間に組み合わせを
// 見失う＝下の「再起動を挟んでも戻せる」が落ちる。
describe('renderer: マスクは各パネルの状態を書き換えない', () => {
  // 覆う直前の組み合わせ＝サイドバーは開、詳細パネルは閉（どちらも既定と違う側に倒して
  // おく＝既定へ落ちただけの復元を「戻った」と読み違えない）。
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

    vi.resetModules(); // 再起動（localStorage と config.json だけが残る）
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
    expect(panels.isHidden()).toBe(false); // 初回描画はキャッシュの推測で塗る
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

  // load() は起動から1tick 遅れて着地する＝その間にユーザーが押していたら、そちらが新しい。
  test('起動途中のユーザー操作は突き合わせに上書きされない', async () => {
    cache.set(CACHE_KEY, 'true'); // 前回は隠したまま終わっている
    configJson = JSON.stringify({ panelsHidden: true });
    const panels = await freshPanels();
    const pending = panels.load();
    panels.setHidden(false); // 突き合わせが着地する前にユーザーが戻した
    await pending;
    expect(panels.isHidden()).toBe(false);
    expect(readStoredConfig().panelsHidden).toBe(false);
  });
});

// Ctrl+Shift+B。相方の Ctrl+B は SidebarProvider 側にいるので、境界（Shift の有無）が
// ここで守られていないと2つのショートカットが同時に走る。
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

  // Caps Lock で 'b'/'B' が入れ替わっても同じ chord は同じ意味であること。
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
