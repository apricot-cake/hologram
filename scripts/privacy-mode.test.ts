// プライバシーモード（#88）— 保存の往復とキー判定のユニットテスト。
//
// 形は panels-pref.test.ts / inspector-pref.test.ts をそのまま写している（docs/testing.md
// 「新しいプリファレンスを足す時はこの形を写す」）＝`electron` を差し替えて本物の
// ipc-config.ts を登録し、その `set-pref` / `get-prefs` をレンダラーの `window.hologram`
// スタブへ配線して、**レンダラーが送るキー名と main の許可キー（PREF_KEYS）を1本の線で
// つなげて**見る。片端だけを見ても捕まらない＝`set-pref` は許可キーに無いキーを
// `{ok:false}` で捨て、呼び出し側はその返り値を読まないので、キー名の取りこぼしは
// **無言で、しかも保存できているように見える**（#391 の `inspectorOpen` が数ヶ月そうだった）。
//
// キー判定（P・無修飾）を別立てで見るのは、この機能の唯一の設計上の逸脱がそこにあるため:
// 他の全域ショートカットは confirmGet()/lightboxIsOpen()/settingsIsOpen()/paletteIsOpen()
// のどれかで一度は手を引くが、これは引かない（#88 は「今すぐ隠す」が要る瞬間ほど何かが
// 開いている、という前提）。ここが崩れていないかを固定するのが後半のスイート。
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

// --- localStorage / window.hologram / document の代役 --------------------
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

// document.documentElement の代役 — privacy-mode.ts が直接触る唯一の DOM API（[data-theme]
// と同じ、CSS へ渡すための属性）。jsdom を持ち込まず、呼ばれた属性操作だけを見る。
let attr: string | null = null;
const documentStub = {
  documentElement: {
    setAttribute: (name: string, value: string) => {
      if (name === 'data-privacy-mode') attr = value;
    },
    removeAttribute: (name: string) => {
      if (name === 'data-privacy-mode') attr = null;
    },
  },
};

beforeEach(() => {
  configJson = '{}';
  cache.clear();
  attr = null;
  (globalThis as any).localStorage = localStorageStub;
  (globalThis as any).window = { hologram: bridge };
  (globalThis as any).document = documentStub;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type PrivacyModule = typeof import('../app/src/renderer/src/services/privacy-mode');
const freshPrivacy = (): Promise<PrivacyModule> => import('../app/src/renderer/src/services/privacy-mode');

const CACHE_KEY = 'hologram-privacy-mode';

describe('main: 許可キーと get-prefs', () => {
  test('privacyMode は受け付けられ config.json へ書かれる', () => {
    expect(setPref('privacyMode', true)).toEqual({ ok: true });
    expect(readStoredConfig().privacyMode).toBe(true);
  });

  test('書いた値は get-prefs に出てくる', () => {
    setPref('privacyMode', true);
    expect(getPrefs().privacyMode).toBe(true);
  });

  test('未設定は null＝「一度も使っていない」（false ではない）', () => {
    expect(getPrefs().privacyMode).toBeNull();
  });

  // config.json は人が手で編集できる＝真偽値以外が入りうる。他の開閉プリファレンスと同じ扱い。
  test('真偽値でない値は null へ倒す', () => {
    configJson = JSON.stringify({ privacyMode: 'true' });
    expect(getPrefs().privacyMode).toBeNull();
  });

  test('他のプリファレンスと同時に持てる', () => {
    setPref('panelsHidden', true);
    setPref('privacyMode', true);
    expect(getPrefs()).toMatchObject({ panelsHidden: true, privacyMode: true });
  });
});

describe('renderer: 状態の保存と DOM 属性', () => {
  test('既定は「かかっていない」＝<html> に属性を立てない', async () => {
    const privacy = await freshPrivacy();
    expect(privacy.isEnabled()).toBe(false);
    expect(attr).toBeNull();
  });

  test('setEnabled は config.json・localStorage・DOM 属性の3つへ同時に書く', async () => {
    const privacy = await freshPrivacy();
    privacy.setEnabled(true);
    expect(readStoredConfig().privacyMode).toBe(true);
    expect(cache.get(CACHE_KEY)).toBe('true');
    expect(attr).toBe('true');
    expect(privacy.isEnabled()).toBe(true);
  });

  test('解除すると属性を外す（"false" 文字列を残さない）', async () => {
    const privacy = await freshPrivacy();
    privacy.setEnabled(true);
    privacy.setEnabled(false);
    expect(attr).toBeNull();
    expect(readStoredConfig().privacyMode).toBe(false);
  });

  test('toggle も同じ経路を通る', async () => {
    const privacy = await freshPrivacy();
    privacy.toggle();
    expect(privacy.isEnabled()).toBe(true);
    privacy.toggle();
    expect(privacy.isEnabled()).toBe(false);
  });

  test('同じ値の再設定は購読者を起こさない', async () => {
    const privacy = await freshPrivacy();
    let notified = 0;
    privacy.subscribe(() => {
      notified++;
    });
    privacy.setEnabled(false);
    expect(notified).toBe(0);
    privacy.setEnabled(true);
    expect(notified).toBe(1);
  });

  // モジュール読み込み時点（React の初回描画より前）で、前回のキャッシュ済みの値が
  // すでに <html> へ反映されていること — これが「一瞬だけ元の絵が見える」を防ぐ仕掛けの全部。
  test('前回オンのままだったキャッシュは、モジュール読み込み時点で属性を立てる', async () => {
    cache.set(CACHE_KEY, 'true');
    const privacy = await freshPrivacy();
    expect(privacy.isEnabled()).toBe(true);
    expect(attr).toBe('true');
  });
});

describe('renderer: 起動時の突き合わせ（config.json が勝つ）', () => {
  test('config.json の外部編集がキャッシュに勝つ', async () => {
    cache.set(CACHE_KEY, 'false');
    configJson = JSON.stringify({ privacyMode: true });
    const privacy = await freshPrivacy();
    expect(privacy.isEnabled()).toBe(false); // 初回描画はキャッシュの推測で塗る
    await privacy.load();
    expect(privacy.isEnabled()).toBe(true);
    expect(attr).toBe('true');
  });

  test('config.json 側が未設定ならキャッシュの値が残る', async () => {
    cache.set(CACHE_KEY, 'true');
    const privacy = await freshPrivacy();
    await privacy.load();
    expect(privacy.isEnabled()).toBe(true);
  });

  test('起動途中のユーザー操作は突き合わせに上書きされない', async () => {
    cache.set(CACHE_KEY, 'true');
    configJson = JSON.stringify({ privacyMode: true });
    const privacy = await freshPrivacy();
    const pending = privacy.load();
    privacy.setEnabled(false); // 突き合わせが着地する前にユーザーが解除した
    await pending;
    expect(privacy.isEnabled()).toBe(false);
    expect(attr).toBeNull();
  });
});

// P（無修飾）。他の全域ショートカットと違い、確認ダイアログ・ライトボックス・設定・
// パレットが開いていても手を引かない（#88 の設計そのもの）— それを固定する。
describe('renderer: P キーの判定', () => {
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

  test('P で切り替わる', async () => {
    const privacy = await freshPrivacy();
    const k = key({ key: 'p' });
    privacy.handleShortcutPrivacyKey(k.ev);
    expect(privacy.isEnabled()).toBe(true);
    expect(k.wasPrevented()).toBe(true);
  });

  // Shift+P（Caps Lock 含む）も同じ物理キー＝どちらでも同じ意味であること。
  test('大文字（Shift+P）でも同じ', async () => {
    const privacy = await freshPrivacy();
    privacy.handleShortcutPrivacyKey(key({ key: 'P', shiftKey: true }).ev);
    expect(privacy.isEnabled()).toBe(true);
  });

  test('Ctrl/Cmd/Alt が乗っていたら無視する（Ctrl+P は印刷等の領分）', async () => {
    const privacy = await freshPrivacy();
    privacy.handleShortcutPrivacyKey(key({ key: 'p', ctrlKey: true }).ev);
    expect(privacy.isEnabled()).toBe(false);
    privacy.handleShortcutPrivacyKey(key({ key: 'p', metaKey: true }).ev);
    expect(privacy.isEnabled()).toBe(false);
    privacy.handleShortcutPrivacyKey(key({ key: 'p', altKey: true }).ev);
    expect(privacy.isEnabled()).toBe(false);
  });

  test('入力欄で打っている間は横取りしない', async () => {
    const privacy = await freshPrivacy();
    const k = key({ key: 'p', target: { tagName: 'INPUT' } as any });
    privacy.handleShortcutPrivacyKey(k.ev);
    expect(privacy.isEnabled()).toBe(false);
    expect(k.wasPrevented()).toBe(false);
  });

  test('contenteditable も同じ', async () => {
    const privacy = await freshPrivacy();
    privacy.handleShortcutPrivacyKey(key({ key: 'p', target: { tagName: 'DIV', isContentEditable: true } as any }).ev);
    expect(privacy.isEnabled()).toBe(false);
  });

  // #88 の設計そのもの: 他の全域ショートカットと違い、ここには
  // confirmGet()/lightboxIsOpen()/settingsIsOpen()/paletteIsOpen() の類のガードが
  // 一切無い。この関数のシグネチャがそれらの状態モジュールを一切 import していないこと
  // 自体が固定になる（依存していれば型検査かここが壊れる）。
  test('モーダル等の状態モジュールへの依存を持たない（オーバーレイの上からでも効く設計）', async () => {
    const privacy = await freshPrivacy();
    // target が非INPUTである限り、他に何も見ずに切り替わる。
    privacy.handleShortcutPrivacyKey(key({ key: 'p', target: { tagName: 'DIV' } as any }).ev);
    expect(privacy.isEnabled()).toBe(true);
  });

  test('修飾なしの p は preventDefault してから切り替える', async () => {
    const privacy = await freshPrivacy();
    const k = key({ key: 'p' });
    expect(k.wasPrevented()).toBe(false);
    privacy.handleShortcutPrivacyKey(k.ev);
    expect(k.wasPrevented()).toBe(true);
  });
});
