// A unit test (#383) for the boundary itself of window.hologram, exposed via contextBridge in
// app/src/preload/index.ts. Swaps out `electron` wholesale and loads preload under plain Node,
// checking only that "callbacks passed to the renderer never receive Electron's raw
// IpcRendererEvent".
//
// Why this suite exists = **this leak is silent, and it still works**. Even if you write
// `ipcRenderer.on(ch, cb)`, the renderer side just discards the first argument as `_e` and works
// correctly anyway, so unless it's caught by types or a test, the fact that "the event is leaking
// through" never becomes visible to anyone (in #383, three of them actually leaked: backup-start /
// backup-done / integrity-check-done). Conversely, eyeballing the wrapped form (`(_e, x) => cb(x)`)
// one by one doesn't work either = the public API keeps growing. So on top of the individual
// contracts, we add **an inventory test that scans every exposed on* method**.
import { beforeAll, describe, expect, test, vi } from 'vitest';

type IpcListener = (event: unknown, ...args: unknown[]) => void;

// vi.mock's factory gets hoisted to the top of the file, so state touched from within it must be
// created beforehand with vi.hoisted (a plain let would throw from pre-initialization access).
const stub = vi.hoisted(() => ({
  // channel → the ipcRenderer listeners registered on that channel (in registration order)
  listeners: new Map<string, IpcListener[]>(),
  exposed: {} as Record<string, unknown>,
}));

vi.mock('electron-log/preload', () => ({}));
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: Record<string, unknown>) => {
      stub.exposed = api;
    },
  },
  ipcRenderer: {
    on: (channel: string, listener: IpcListener) => {
      const list = stub.listeners.get(channel) ?? [];
      list.push(listener);
      stub.listeners.set(channel, list);
    },
    removeListener: (channel: string, listener: IpcListener) => {
      const list = stub.listeners.get(channel) ?? [];
      const at = list.indexOf(listener);
      if (at >= 0) list.splice(at, 1);
    },
    invoke: async () => undefined,
    send: () => {},
  },
}));

// A stand-in for the real IpcRendererEvent. It only needs a unique reference (we only check identity).
const IPC_EVENT = { sender: 'ipcRenderer', senderId: 0, ports: [], preventDefault() {} };

// Runs register() and returns only the ipcRenderer listeners newly added inside it.
// Since listeners accumulate, take a before/after snapshot and diff it.
function listenersAddedBy(register: () => void): { channel: string; listener: IpcListener }[] {
  const before = new Map<string, number>();
  for (const [channel, list] of stub.listeners) before.set(channel, list.length);
  register();
  const added: { channel: string; listener: IpcListener }[] = [];
  for (const [channel, list] of stub.listeners) {
    for (let i = before.get(channel) ?? 0; i < list.length; i++) added.push({ channel, listener: list[i] });
  }
  return added;
}

// Calls one on* API, fires the listener registered behind it with IPC_EVENT, and returns the
// argument list the exposed-side callback actually received.
function callbackArgsOf(key: string, payload: unknown): unknown[][] {
  const seen: unknown[][] = [];
  const register = stub.exposed[key] as (cb: (...args: unknown[]) => void) => unknown;
  const added = listenersAddedBy(() => {
    register((...args) => seen.push(args));
  });
  expect(added, `${key} は ipcRenderer リスナーを1本だけ登録するはず`).toHaveLength(1);
  added[0].listener(IPC_EVENT, payload);
  expect(seen, `${key} のコールバックが1回だけ呼ばれるはず`).toHaveLength(1);
  return seen;
}

beforeAll(async () => {
  await import('../app/src/preload/index.ts');
});

describe('公開APIの形', () => {
  test('preload は window.hologram として1つの API を公開する', () => {
    expect(Object.keys(stub.exposed).length).toBeGreaterThan(0);
  });

  test('汎用の ipcRenderer やチャンネル名は公開しない', () => {
    for (const key of Object.keys(stub.exposed)) {
      expect(key).not.toMatch(/^(ipcRenderer|on|off|once|send|removeListener)$/);
    }
  });
});

describe('バックアップ通知（#383）', () => {
  test('onBackupStart のコールバックは引数なしで呼ばれる', () => {
    const seen = callbackArgsOf('onBackupStart', { at: '2026-07-30T00:00:00.000Z' });
    expect(seen[0]).toEqual([]);
  });

  test('onBackupDone のコールバックは結果だけを受け取る', () => {
    const result = { ok: true, at: '2026-07-30T00:00:00.000Z', written: 3 };
    const seen = callbackArgsOf('onBackupDone', result);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0]).toBe(result);
  });

  test('onIntegrityCheckDone のコールバックは status だけを受け取る', () => {
    const status = { dbOk: true, orphanCount: 0 };
    const seen = callbackArgsOf('onIntegrityCheckDone', status);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0]).toBe(status);
  });
});

describe('棚卸し＝公開されている on* すべて', () => {
  // Concrete proof that "not a single on* passes straight through to the raw ipcRenderer.on".
  // The moment a new notification API is added as a raw pass-through, this goes red (since
  // individual tests don't grow, only the scan catches it).
  test('どの on* も IpcRendererEvent をコールバックへ渡さない', () => {
    const keys = Object.keys(stub.exposed).filter((k) => k.startsWith('on'));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of keys) {
      const seen = callbackArgsOf(key, { probe: key });
      expect(seen[0], `${key} が生の IpcRendererEvent を転送している`).not.toContain(IPC_EVENT);
    }
  });

  test('どの on* のコールバックも、渡されるのは payload 1つ以内', () => {
    // Don't stop at just excluding the raw event = a variadic pass-through (`(...args) => cb(...args)`)
    // would also widen the boundary the day main adds a second argument in the future, so we
    // constrain even the number of arguments.
    for (const key of Object.keys(stub.exposed).filter((k) => k.startsWith('on'))) {
      const seen = callbackArgsOf(key, { probe: key });
      expect(seen[0].length, `${key} がコールバックへ複数の引数を渡している`).toBeLessThanOrEqual(1);
    }
  });
});

describe('リスナーの取り外し（onExportProgress だけが持つ契約）', () => {
  test('返り値を呼ぶと ipcRenderer のリスナーが外れる', () => {
    const off = (stub.exposed.onExportProgress as (cb: (p: unknown) => void) => () => void)(() => {});
    const before = stub.listeners.get('export-progress')?.length ?? 0;
    expect(before).toBeGreaterThan(0);
    off();
    expect(stub.listeners.get('export-progress')?.length ?? 0).toBe(before - 1);
  });
});
