// app/src/preload/index.ts が contextBridge で公開する window.hologram の、境界そのものの
// 単体テスト (#383)。`electron` を丸ごと差し替えて preload を素の Node で読み込み、
// 「レンダラーへ渡すコールバックが Electron の生の IpcRendererEvent を受け取らない」
// ことだけを見る。
//
// このスイートがある理由＝この漏れは静かで、しかも動いてしまう。`ipcRenderer.on(ch, cb)`
// と書いても、レンダラー側は第1引数を `_e` として捨てるだけで正しく動く。だから型か
// テストで捕まえない限り、「イベントが漏れている」ことは誰の目にも見えない（#383 では
// 実際に3本漏れていた＝backup-start / backup-done / integrity-check-done）。逆に、包んだ形
// （`(_e, x) => cb(x)`）を1本ずつ目で確かめる手も効かない＝公開 API は増え続ける。
// そこで個別の契約に加えて、公開されている on* メソッドを全部走査する棚卸しのテストを足す。
import { beforeAll, describe, expect, test, vi } from 'vitest';

type IpcListener = (event: unknown, ...args: unknown[]) => void;

// vi.mock のファクトリはファイルの先頭へ巻き上げられる。だからその中から触る状態は、
// あらかじめ vi.hoisted で作っておく（素の let は初期化前アクセスで例外になる）。
const stub = vi.hoisted(() => ({
  // チャンネル → そのチャンネルに登録された ipcRenderer のリスナー（登録順）
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

// 本物の IpcRendererEvent の代役。見るのは同一性だけなので、一意の参照であれば足りる。
const IPC_EVENT = { sender: 'ipcRenderer', senderId: 0, ports: [], preventDefault() {} };

// register() を実行し、その中で新しく足された ipcRenderer のリスナーだけを返す。
// リスナーは溜まっていくので、前後のスナップショットを取って差分を出す。
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

// on* の API を1本呼び、その裏で登録されたリスナーを IPC_EVENT で発火させ、公開側の
// コールバックが実際に受け取った引数の一覧を返す。
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
  // 「どの on* も生の ipcRenderer.on を素通しにしていない」ことの具体的な証明。
  // 新しい通知の API が素通しで足された瞬間に赤くなる（個別のテストは増えないので、
  // 捕まえられるのはこの走査だけ）。
  test('どの on* も IpcRendererEvent をコールバックへ渡さない', () => {
    const keys = Object.keys(stub.exposed).filter((k) => k.startsWith('on'));
    expect(keys.length).toBeGreaterThanOrEqual(6);
    for (const key of keys) {
      const seen = callbackArgsOf(key, { probe: key });
      expect(seen[0], `${key} が生の IpcRendererEvent を転送している`).not.toContain(IPC_EVENT);
    }
  });

  test('どの on* のコールバックも、渡されるのは payload 1つ以内', () => {
    // 生のイベントを除くだけでは足りない。可変長の素通し（`(...args) => cb(...args)`）も、
    // いつか main が第2引数を足した日に境界を広げてしまう。だから引数の数まで縛る。
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
