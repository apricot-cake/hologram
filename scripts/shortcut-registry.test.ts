// Unit tests for services/shortcut-registry.ts (#246 — command registry for rebindable
// global shortcuts). This module has no existing test coverage even though it's the thing
// every builder's handleShortcutXKey now calls instead of comparing a literal key — a bug
// here breaks every shortcut in the app silently (tryRun() never throws, it just returns
// false and the key falls through). What we pin down:
// (1) combo string round-tripping (event -> canonical string -> display label) stays fixed,
// (2) conflict detection — including the Shift-insensitive ids — matches what dispatch()
// itself checks, so a reassignment can never quietly collide with a live binding,
// (3) tryRun()'s three-way outcome (not-this-id / claimed-but-inert / claimed-and-ran) since
// callers chain several ids on the same physical key (undo-builder.ts's undo/redo pair, etc.),
// (4) persistence round trip through the same window.hologram.getPrefs/setPref seam other
// prefs modules use (panels.ts, privacy-mode.ts).
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { comboFromEvent, comboLabel, currentCombo, findConflict, isTypingTarget, list, load, normalizeKey, registerShortcut, resetShortcuts, resetToDefault, setCustomCombo, subscribe, tryRun, type ShortcutEntry } from '../app/src/renderer/src/services/shortcut-registry';

let store: Record<string, unknown>;
let getPrefsImpl: () => Promise<{ shortcutOverrides: unknown }>;
let setPrefImpl: (key: string, value: unknown) => Promise<unknown>;

const bridge = {
  getPrefs: () => getPrefsImpl(),
  setPref: (key: string, value: unknown) => setPrefImpl(key, value),
};

beforeEach(() => {
  store = {};
  getPrefsImpl = async () => ({ shortcutOverrides: store.shortcutOverrides ?? null });
  setPrefImpl = async (key, value) => {
    store[key] = value;
    return { ok: true };
  };
  (globalThis as any).window = { hologram: bridge };
  resetShortcuts();
});

function makeEntry(partial: { id: string; defaultCombo: string; ignoreShift?: boolean; canExecute?(e: KeyboardEvent): boolean; perform?(e: KeyboardEvent): void }): ShortcutEntry {
  return {
    id: partial.id,
    titleKey: partial.id,
    defaultCombo: partial.defaultCombo,
    ignoreShift: partial.ignoreShift,
    canExecute: partial.canExecute ?? (() => true),
    perform: partial.perform ?? vi.fn(),
  };
}

function key(init: Partial<KeyboardEvent> & { key: string }) {
  return {
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent;
}

describe('コンボ変換: normalizeKey / comboFromEvent / comboLabel', () => {
  test('normalizeKey: スペースは Space、+ は =、文字は小文字化（Caps Lock 無効化）', () => {
    expect(normalizeKey(' ')).toBe('Space');
    expect(normalizeKey('+')).toBe('=');
    expect(normalizeKey('A')).toBe('a');
    expect(normalizeKey('z')).toBe('z');
  });

  test('normalizeKey: 複数文字のキー名はそのまま（ArrowLeft, Tab 等）', () => {
    expect(normalizeKey('ArrowLeft')).toBe('ArrowLeft');
    expect(normalizeKey('Tab')).toBe('Tab');
    expect(normalizeKey('Escape')).toBe('Escape');
  });

  test('comboFromEvent: 修飾キーは Ctrl→Shift→Alt の固定順で結合される', () => {
    expect(comboFromEvent(key({ key: 'z', ctrlKey: true, shiftKey: true, altKey: true }))).toBe('Ctrl+Shift+Alt+z');
  });

  test('comboFromEvent: metaKey（Cmd）も Ctrl 扱い', () => {
    expect(comboFromEvent(key({ key: 'z', metaKey: true }))).toBe('Ctrl+z');
  });

  test('comboFromEvent: 修飾なしはキー単体', () => {
    expect(comboFromEvent(key({ key: 'p' }))).toBe('p');
  });

  test('comboFromEvent: スペース・+ は正規化を経由する', () => {
    expect(comboFromEvent(key({ key: ' ' }))).toBe('Space');
    expect(comboFromEvent(key({ key: '+', ctrlKey: true }))).toBe('Ctrl+=');
  });

  test('comboLabel: 単一文字キーは大文字表示、矢印は記号、その他はそのまま', () => {
    expect(comboLabel('Ctrl+Shift+z')).toBe('Ctrl+Shift+Z');
    expect(comboLabel('Alt+ArrowLeft')).toBe('Alt+←');
    expect(comboLabel('Ctrl+Tab')).toBe('Ctrl+Tab');
    expect(comboLabel('Space')).toBe('Space');
  });
});

describe('登録・解除・一覧', () => {
  test('未登録の id は currentCombo が null', () => {
    expect(currentCombo('nope')).toBeNull();
  });

  test('登録すると list() に既定コンボで現れる', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    expect(list()).toEqual([{ id: 'undo', title: 'undo', defaultCombo: 'Ctrl+z', currentCombo: 'Ctrl+z', isCustom: false }]);
  });

  test('unregister（登録時の返り値）で list() から消える', () => {
    const off = registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    off();
    expect(list()).toEqual([]);
    expect(currentCombo('undo')).toBeNull();
  });

  test('同じ id を再登録すると古い方の unregister は効かない（差し替え順序に耐える）', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const offOld = registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const newer = makeEntry({ id: 'undo', defaultCombo: 'Ctrl+Shift+z' });
    registerShortcut(newer);
    offOld();
    expect(currentCombo('undo')).toBe('Ctrl+Shift+z');
  });

  test('resetShortcuts はすべての登録と override を消す', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    setCustomCombo('undo', 'Ctrl+y');
    resetShortcuts();
    expect(list()).toEqual([]);
    expect(currentCombo('undo')).toBeNull();
  });

  test('isTypingTarget: INPUT / TEXTAREA / contentEditable で true', () => {
    expect(isTypingTarget(key({ key: 'a', target: { tagName: 'INPUT' } as any }))).toBe(true);
    expect(isTypingTarget(key({ key: 'a', target: { tagName: 'TEXTAREA' } as any }))).toBe(true);
    expect(isTypingTarget(key({ key: 'a', target: { tagName: 'DIV', isContentEditable: true } as any }))).toBe(true);
  });

  test('isTypingTarget: 通常の DOM 要素や target なしは false', () => {
    expect(isTypingTarget(key({ key: 'a', target: { tagName: 'DIV' } as any }))).toBe(false);
    expect(isTypingTarget(key({ key: 'a', target: null }))).toBe(false);
  });
});

describe('衝突検出（findConflict）', () => {
  test('同じコンボの別コマンドを検出する', () => {
    registerShortcut(makeEntry({ id: 'a', defaultCombo: 'Ctrl+k' }));
    registerShortcut(makeEntry({ id: 'b', defaultCombo: 'Ctrl+j' }));
    expect(findConflict('Ctrl+k')).toEqual({ id: 'a', title: 'a' });
  });

  test('excludeId を渡すと自分自身は衝突扱いにならない', () => {
    registerShortcut(makeEntry({ id: 'a', defaultCombo: 'Ctrl+k' }));
    expect(findConflict('Ctrl+k', 'a')).toBeNull();
  });

  test('衝突なしは null', () => {
    registerShortcut(makeEntry({ id: 'a', defaultCombo: 'Ctrl+k' }));
    expect(findConflict('Ctrl+j')).toBeNull();
  });

  test('ignoreShift のコマンドは Shift 有無どちらでも衝突扱い', () => {
    registerShortcut(makeEntry({ id: 'selectAll', defaultCombo: 'Ctrl+a', ignoreShift: true }));
    expect(findConflict('Ctrl+Shift+a')).toEqual({ id: 'selectAll', title: 'selectAll' });
    expect(findConflict('Ctrl+a')).toEqual({ id: 'selectAll', title: 'selectAll' });
  });

  test('ignoreShift でないコマンドは Shift の有無で別コンボ扱い', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    registerShortcut(makeEntry({ id: 'redo', defaultCombo: 'Ctrl+Shift+z' }));
    expect(findConflict('Ctrl+z')).toEqual({ id: 'undo', title: 'undo' });
    expect(findConflict('Ctrl+Shift+z')).toEqual({ id: 'redo', title: 'redo' });
  });
});

describe('再割り当て（setCustomCombo）', () => {
  test('空いているコンボへの割り当ては成功し、list() と currentCombo に反映される', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const result = setCustomCombo('undo', 'Ctrl+y');
    expect(result).toEqual({ ok: true });
    expect(currentCombo('undo')).toBe('Ctrl+y');
    expect(list()).toEqual([{ id: 'undo', title: 'undo', defaultCombo: 'Ctrl+z', currentCombo: 'Ctrl+y', isCustom: true }]);
  });

  test('割り当ては config.json（window.hologram.setPref）へ永続化される', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    setCustomCombo('undo', 'Ctrl+y');
    expect(store.shortcutOverrides).toEqual({ undo: 'Ctrl+y' });
  });

  test('使用中のコンボへの割り当ては衝突先の id/title を伴って拒否される', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    registerShortcut(makeEntry({ id: 'redo', defaultCombo: 'Ctrl+y' }));
    const result = setCustomCombo('undo', 'Ctrl+y');
    expect(result).toEqual({ ok: false, conflict: { id: 'redo', title: 'redo' } });
    expect(currentCombo('undo')).toBe('Ctrl+z'); // 変更されていない
    expect(store.shortcutOverrides).toBeUndefined(); // 永続化もされない
  });

  test('未登録の id への割り当ては ok:false（衝突先は空）', () => {
    expect(setCustomCombo('nope', 'Ctrl+y')).toEqual({ ok: false, conflict: { id: '', title: '' } });
  });

  test('ignoreShift のコマンドは Shift を剥がしてから保存される', () => {
    registerShortcut(makeEntry({ id: 'selectAll', defaultCombo: 'Ctrl+a', ignoreShift: true }));
    setCustomCombo('selectAll', 'Ctrl+Shift+q');
    expect(currentCombo('selectAll')).toBe('Ctrl+q');
  });

  test('自分が既に持っているコンボへの再割り当ては自分自身との衝突にならない', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    expect(setCustomCombo('undo', 'Ctrl+z')).toEqual({ ok: true });
  });

  test('永続化の呼び出し自体が同期的に投げても割り当ては成功する（persist の catch は握りつぶす）', () => {
    // persist() は setPref(...) の呼び出しを try/catch するだけ（await しない fire-and-forget）
    // なので、実際に捕まえられるのは呼び出し時点の同期 throw だけ（他の prefs モジュールと同型）。
    setPrefImpl = (() => {
      throw new Error('boom');
    }) as unknown as typeof setPrefImpl;
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    expect(setCustomCombo('undo', 'Ctrl+y')).toEqual({ ok: true });
    expect(currentCombo('undo')).toBe('Ctrl+y');
  });

  test('割り当て成功は購読者へ通知する', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const seen = vi.fn();
    const unsub = subscribe(seen);
    setCustomCombo('undo', 'Ctrl+y');
    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe('既定に戻す（resetToDefault）', () => {
  test('override を消して既定コンボへ戻り、永続化・通知される', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    setCustomCombo('undo', 'Ctrl+y');
    const seen = vi.fn();
    const unsub = subscribe(seen);
    resetToDefault('undo');
    expect(currentCombo('undo')).toBe('Ctrl+z');
    expect(store.shortcutOverrides).toEqual({});
    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
  });

  test('override が無い id への resetToDefault は何もしない（通知もしない）', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const seen = vi.fn();
    const unsub = subscribe(seen);
    resetToDefault('undo');
    expect(seen).not.toHaveBeenCalled();
    unsub();
  });
});

describe('起動時の読み込み（load）', () => {
  test('保存済み overrides を読み込んで反映する', async () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    store.shortcutOverrides = { undo: 'Ctrl+y' };
    await load();
    expect(currentCombo('undo')).toBe('Ctrl+y');
  });

  test('保存が無ければ既定のまま（例外にならない）', async () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    await load();
    expect(currentCombo('undo')).toBe('Ctrl+z');
  });

  test('読み込みが失敗しても例外を投げない', async () => {
    getPrefsImpl = async () => {
      throw new Error('boom');
    };
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    await expect(load()).resolves.toBeUndefined();
    expect(currentCombo('undo')).toBe('Ctrl+z');
  });

  test('読み込みで反映されると購読者へ通知する', async () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    store.shortcutOverrides = { undo: 'Ctrl+y' };
    const seen = vi.fn();
    const unsub = subscribe(seen);
    await load();
    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
  });
});

describe('購読（subscribe/notify）', () => {
  test('複数の購読者すべてに通知される', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribe(a);
    const unsubB = subscribe(b);
    setCustomCombo('undo', 'Ctrl+y');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  test('解除した購読者は呼ばれない', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const seen = vi.fn();
    const unsub = subscribe(seen);
    unsub();
    setCustomCombo('undo', 'Ctrl+y');
    expect(seen).not.toHaveBeenCalled();
  });

  test('1つの購読者が例外を投げても他の購読者は呼ばれる', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const ok = vi.fn();
    const unsubBad = subscribe(() => {
      throw new Error('boom');
    });
    const unsubOk = subscribe(ok);
    expect(() => setCustomCombo('undo', 'Ctrl+y')).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
    unsubBad();
    unsubOk();
  });
});

describe('実行（tryRun）', () => {
  test('未登録の id は false・preventDefault もしない', () => {
    const e = key({ key: 'z', ctrlKey: true });
    expect(tryRun('undo', e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  test('コンボが一致しなければ false（呼び出し側が次の id を試せる）', () => {
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z' }));
    const e = key({ key: 'z' }); // Ctrl なし
    expect(tryRun('undo', e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  test('一致して canExecute が true なら preventDefault + perform され true を返す', () => {
    const perform = vi.fn();
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z', perform }));
    const e = key({ key: 'z', ctrlKey: true });
    expect(tryRun('undo', e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(perform).toHaveBeenCalledWith(e);
  });

  test('一致するが canExecute が false なら true を返しつつ何もしない（例外なし・preventDefault なし）', () => {
    const perform = vi.fn();
    registerShortcut(makeEntry({ id: 'zoom.fit', defaultCombo: 'Ctrl+0', canExecute: () => false, perform }));
    const e = key({ key: '0', ctrlKey: true });
    expect(tryRun('zoom.fit', e)).toBe(true);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(perform).not.toHaveBeenCalled();
  });

  test('ignoreShift のコマンドは Shift の有無に関わらず実行される', () => {
    const perform = vi.fn();
    registerShortcut(makeEntry({ id: 'selectAll', defaultCombo: 'Ctrl+a', ignoreShift: true, perform }));
    expect(tryRun('selectAll', key({ key: 'a', ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  test('カスタム割り当て後は新しいコンボでのみ実行され、既定コンボは反応しない', () => {
    const perform = vi.fn();
    registerShortcut(makeEntry({ id: 'undo', defaultCombo: 'Ctrl+z', perform }));
    setCustomCombo('undo', 'Ctrl+q');
    expect(tryRun('undo', key({ key: 'z', ctrlKey: true }))).toBe(false);
    expect(tryRun('undo', key({ key: 'q', ctrlKey: true }))).toBe(true);
    expect(perform).toHaveBeenCalledTimes(1);
  });
});
