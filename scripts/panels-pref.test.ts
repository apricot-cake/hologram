// 周辺 UI の一括表示・非表示 (#245)＝保存の往復とキー判定の単体テスト。
//
// 保存の側は inspector-pref.test.ts の形をそのまま写している（docs/テスト.md:「新しい設定を
// 足すときはこの形を写す」）＝`electron` を差し替えて本物の ipc-config.ts を登録し、その
// `set-pref` / `get-prefs` をレンダラーの `window.hologram` スタブへつないで、レンダラーが
// 送るキー名と main の許可リスト (PREF_KEYS) が1本の線でつながっていることを見る。片端だけ
// を見ていても捕まらない。`set-pref` は許可リストに無いキーを黙って `{ok:false}` で捨て、
// 呼び出し側はその返り値を読まない。だからキー名の取りこぼしは一切音を立てず、保存できた
// ようにさえ見える (#391 の `inspectorOpen` が何か月もそうだった)。
//
// 保存の往復に加えて、この一式は #245 の中身そのものも動かす。一括状態は2つのパネルの状態を
// 書き換えずに覆うマスクだ、という設計 (services/panels.ts の冒頭) が本当に成り立っている
// なら、「隠す → 再起動 → 戻す」で元の組み合わせが返るはず。別のスナップショットをメモリに
// 持つ実装では、それが成り立たない。ここで実装の選択そのものを押さえている。
//
// キー判定 (Ctrl+Shift+B) を別に見るのは、修飾の少ない打鍵が同じ物理キーの2つ目のハンドラ
// だったから（SidebarProvider の Ctrl+B。#981 で広がったサイドバーとともに退役した）。Shift
// は今もこの防ぎが守るべき境目。Ctrl+B は今や誰のものでもなく、ここで飲み込めば空いている
// キーを黙って占めることになる。
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

// config.json そのものの代役。文字列で持つので、ハンドラは読み書きのたびに直列化を本当に
// 一往復する＝オブジェクトを共有しているだけで通ってしまうことがない。
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

// --- localStorage / window.hologram の代役 --------------------------------------
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

// 状態はモジュールの中に居るので、筋書きごとに import し直す（localStorage を仕込んだ後で）。
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

  // config.json は人が手で編集できるので、真偽値でない値が入りうる。他の開閉の設定と同じ扱い。
  test('真偽値でない値は null へ倒す', () => {
    configJson = JSON.stringify({ panelsHidden: 'true' });
    expect(getPrefs().panelsHidden).toBeNull();
  });

  // 一括状態とインスペクタ自身の状態は別々に保存される＝片方だけを見て復元することはできない。(#981: サイドバーはもう自分の状態を持たず、隠すのはマスクだけ。)
  test('パネル自身の状態と同時に持てる', () => {
    setPref('inspectorOpen', false);
    setPref('panelsHidden', true);
    expect(getPrefs()).toMatchObject({ inspectorOpen: false, panelsHidden: true });
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

// #245 の設計の核心。一括状態はマスクであり、覆っている間もパネル自身の状態に触らない。
// 別のスナップショットを持つ実装は、そのスナップショットが消えた瞬間に組み合わせを見失う
// ＝下の「再起動をまたいで戻せる」テストが落ちる。
describe('renderer: マスクは各パネルの状態を書き換えない', () => {
  // 覆う直前の状態はインスペクタが閉じている＝既定と反対の側へ倒してあるので、既定へ落ちた
  // だけの復元を「戻った」と読み違えずに済む。
  test('隠している間もパネル自身の保存値はそのまま', async () => {
    const inspector = await freshInspector();
    const panels = await freshPanels();
    inspector.setOpen(false);
    panels.setHidden(true);
    expect(inspector.isOpen()).toBe(false);
    expect(getPrefs()).toMatchObject({ inspectorOpen: false, panelsHidden: true });
  });

  test('隠す → 再起動 → 戻す で元の組み合わせが返る', async () => {
    const inspector = await freshInspector();
    const panels = await freshPanels();
    inspector.setOpen(false);
    panels.setHidden(true);

    vi.resetModules(); // 再起動（生き残るのは localStorage と config.json だけ）
    const inspector2 = await freshInspector();
    const panels2 = await freshPanels();
    await panels2.load();
    await inspector2.load();
    expect(panels2.isHidden()).toBe(true);

    panels2.reveal();
    expect(panels2.isHidden()).toBe(false);
    expect(inspector2.isOpen()).toBe(false);
  });
});

describe('renderer: 起動時の突き合わせ（config.json が勝つ）', () => {
  test('config.json の外部編集がキャッシュに勝つ', async () => {
    cache.set(CACHE_KEY, 'false');
    configJson = JSON.stringify({ panelsHidden: true });
    const panels = await freshPanels();
    expect(panels.isHidden()).toBe(false); // 最初の描画はキャッシュの見込みで塗る
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

  // load() は起動の1ティック後に着く＝その間に利用者が何かを押していれば、そちらが新しい値。
  test('起動途中のユーザー操作は突き合わせに上書きされない', async () => {
    cache.set(CACHE_KEY, 'true'); // 前回は隠したまま終わった
    configJson = JSON.stringify({ panelsHidden: true });
    const panels = await freshPanels();
    const pending = panels.load();
    panels.setHidden(false); // 突き合わせが着く前に利用者が戻した
    await pending;
    expect(panels.isHidden()).toBe(false);
    expect(readStoredConfig().panelsHidden).toBe(false);
  });
});

// Ctrl+Shift+B だけ。修飾の少ない打鍵は #981 以降どこのものでもなく、ぶつかる相手のハンドラ
// が居た頃より境目を見失いやすい。
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

  // Caps Lock で 'b'/'B' が入れ替わっても、同じ打鍵は同じ意味でなければならない。
  test('小文字で届いても同じ', async () => {
    const panels = await freshPanels();
    panels.handleShortcutPanelsKey(key({ key: 'b', ctrlKey: true, shiftKey: true }).ev);
    expect(panels.isHidden()).toBe(true);
  });

  test('Shift 無しには手を出さない（#981 以降は誰のものでもない＝黙って奪わない）', async () => {
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
