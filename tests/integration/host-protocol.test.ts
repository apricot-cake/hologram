// 拡張機能とネイティブホストの間のメッセージ契約 (#400＝native-host/protocol.mts)。
//
// 型検査だけでは片側しか守れない。拡張機能とホストは別々の TS プロジェクトで、
// `npm run typecheck` はそれぞれを別々に検査する。だから「同じ宣言を import している」
// ことは型検査に見えるが、「拡張機能が実際に通信路上へ載せた形」は見えない。
// ここで見ているのがそれ＝拡張機能のコードが実際に送ったメッセージを、ホストが実際に
// 使う parse へ通す。片側だけで欄が改名されたら、型検査が通ってもこの一式は落ちる。
//
// 送る側は startBackground() をそのまま走らせるだけ（bridgeSend / queryBridge は
// クロージャの中にいて外から呼べない）。chrome スタブの作りは
// extension/utils/background-wiring.test.ts に倣う＝ライブラリを使わず、Port を手で演じる。
// ネットワークに触らないよう、postUrl はどのプラットフォームにも一致しない文字列を
// 使う（fetchPostMetadata は fetch を呼ばず、空のレコードで即座に解決する）。

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { generateCaptureId, startBackground } from '../../extension/utils/background';
import { CAPTURE_ID_PATTERN, PROTOCOL_VERSION, hostExtBuild, hostProtocolVersion, isCaptureId, parseHostFrame, parseHostRequest, protocolSkewOf, readHostResponse, responseId, stampProtocol } from '../../native-host/protocol.mts';

const UNPARSABLE_POST_URL = 'https://x.com/not-a-known-post-shape';
const SENDER = { tab: { id: 7, windowId: 1, url: 'https://x.com/home' } };

// 送られたメッセージを1本の一覧へ集める chrome スタブ。ポートが（保存・ログ・バッジの
// ために）何本開いたかはここでの関心ではない。関心は通信路上に載ったものだけ。
function setup(initialStorage: Record<string, unknown> = {}, failRateStorage = false, delayRateGet = false) {
  const messageListeners: Array<(message: any, sender: any, sendResponse: (r: any) => void) => boolean> = [];
  const sent: any[] = [];
  // 送信はポートごとにも記録する。返信を「その要求を出したポート」へ返せるようにする
  // ため（保存・ログ・バッジはそれぞれ別のポートを開くので、宛先を間違えると返信は
  // 永遠に届かない）。
  const ports: Array<{ emitMessage(msg: any): void; sent: any[] }> = [];
  const storageGets: any[] = [];
  const storageSets: any[] = [];
  const storageRemoves: any[] = [];
  const storage = { ...initialStorage };
  let pendingRateGet: ((value: Record<string, unknown>) => void) | null = null;

  const chromeStub: any = {
    alarms: { create: async () => {}, onAlarm: { addListener: () => {} } },
    runtime: {
      lastError: undefined,
      onMessage: { addListener: (fn: any) => messageListeners.push(fn) },
      connectNative: () => {
        const listeners: Array<(msg: any) => void> = [];
        const portSent: any[] = [];
        const port = {
          postMessage: (msg: any) => {
            sent.push(msg);
            portSent.push(msg);
          },
          disconnect: () => {},
          onMessage: { addListener: (fn: (msg: any) => void) => listeners.push(fn) },
          onDisconnect: { addListener: () => {} },
        };
        ports.push({
          sent: portSent,
          emitMessage(msg: any) {
            for (const fn of listeners) fn(msg);
          },
        });
        return port;
      },
    },
    tabs: {
      sendMessage: () => Promise.resolve(undefined),
      query: async () => [{ id: SENDER.tab.id, windowId: SENDER.tab.windowId }],
      // クリックに応答が返らなかった時、ツールバー表示 (#269) が引っ掛ける待ち受けの
      // 差し口。ここで見るのは通信路上に載るものなので、これを発火させる経路は無い。
      // それでも無いと startBackground が落ちる。
      onUpdated: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
    },
    scripting: { executeScript: async () => {} },
    action: { onClicked: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
    storage: {
      local: {
        get: async (_k: any, cb?: (r: any) => void) => {
          storageGets.push(_k);
          const result = _k == null ? { ...storage } : typeof _k === 'string' && Object.hasOwn(storage, _k) ? { [_k]: storage[_k] } : {};
          if (delayRateGet && _k === 'captureLogRateState') {
            pendingRateGet = (value) => cb?.(value);
            return result;
          }
          cb?.(result);
          return result;
        },
        set: async (_i: any, cb?: () => void) => {
          storageSets.push(_i);
          if (failRateStorage && Object.hasOwn(_i, 'captureLogRateState')) {
            chromeStub.runtime.lastError = { message: 'rate state set failed' };
            cb?.();
            chromeStub.runtime.lastError = undefined;
            if (!cb) return Promise.reject(new Error('rate state set failed'));
            return;
          }
          Object.assign(storage, _i);
          cb?.();
        },
        remove: async (_k: any, cb?: () => void) => {
          storageRemoves.push(_k);
          if (failRateStorage && _k === 'captureLogRateState') {
            chromeStub.runtime.lastError = { message: 'rate state remove failed' };
            cb?.();
            chromeStub.runtime.lastError = undefined;
            if (!cb) return Promise.reject(new Error('rate state remove failed'));
            return;
          }
          for (const key of Array.isArray(_k) ? _k : [_k]) delete storage[key];
          cb?.();
        },
      },
      session: { get: async () => ({}), set: async () => {} },
    },
  };

  (globalThis as any).chrome = chromeStub;
  startBackground();

  return {
    sent,
    ports,
    storageGets,
    storageSets,
    storageRemoves,
    storage,
    resolveRateGet() {
      pendingRateGet?.(Object.hasOwn(storage, 'captureLogRateState') ? { captureLogRateState: storage.captureLogRateState } : {});
      pendingRateGet = null;
    },
    dispatch(message: any) {
      let respond!: (r: any) => void;
      const responseP = new Promise<any>((resolve) => {
        respond = resolve;
      });
      for (const fn of messageListeners) fn(message, SENDER, respond);
      return responseP;
    },
    // type ごとにメッセージを1件取り出し、共有の parse へ通した結果を返す。parse が拒めばここで落ちる。
    async parsedOf(type: string) {
      let raw: unknown;
      await vi.waitFor(() => {
        raw = sent.find((m) => m?.type === type);
        expect(raw, `${type} が送られていない`).toBeTruthy();
      });
      const parsed = parseHostRequest(raw);
      if (!parsed.ok) throw new Error(`${type} が契約の parse に拒まれた: ${parsed.failure.error}`);
      return parsed.request;
    },
    // その type を送ったポート。返信をそこへ流して初めて、拡張機能側の待ち受けに届く。
    async portThatSent(type: string) {
      let found: (typeof ports)[number] | undefined;
      await vi.waitFor(() => {
        found = ports.find((p) => p.sent.some((m) => m?.type === type));
        expect(found, `${type} を送ったポートが無い`).toBeTruthy();
      });
      return found as (typeof ports)[number];
    },
  };
}

describe('拡張が送るメッセージは、ホストが使う parse をそのまま通る', () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  test('savePost（一括取込の保存）', async () => {
    env.dispatch({ type: 'savePost', platform: 'x', postUrl: UNPARSABLE_POST_URL, saveId: 'trace-1' });
    const req = await env.parsedOf('savePost');
    expect(req.type).toBe('savePost');
    if (req.type !== 'savePost') return;
    // captureId は契約の形をしている（parse が拒む id は null になる）。ホストはこの値を
    // そのままファイル名の先頭に使うので、ここを null のまま通してはいけない。
    expect(req.captureId).toMatch(CAPTURE_ID_PATTERN);
    expect(req.saveId).toBe('trace-1'); // #519: 1回の保存を3プロセスにまたがって束ねる id
    expect(req.metadata.url).toBe(UNPARSABLE_POST_URL);
    expect(req.metaOk).toBe(false); // 空のレコード＝プラットフォームの API から何も返らなかった
  });

  test('saveMedia（右クリックした画像・動画の保存）', () => {
    const raw = {
      type: 'saveMedia',
      captureId: '1717500000000-abcd',
      saveId: 'trace-2',
      mediaUrl: 'https://x.com/files/a.png',
      mediaReferer: 'https://x.com/home',
      mediaAlt: '説明',
      mediaType: 'video',
      metadata: { url: UNPARSABLE_POST_URL, platform: 'x' },
    };
    const parsed = parseHostRequest(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.request.type !== 'saveMedia') return;
    expect(parsed.request.mediaUrl).toBe(raw.mediaUrl);
    expect(parsed.request.mediaReferer).toBe(raw.mediaReferer);
    expect(parsed.request.mediaAlt).toBe('説明');
    expect(parsed.request.mediaType).toBe('video');
  });

  test('旧版の saveMedia は mediaType を省くと画像になる', () => {
    const parsed = parseHostRequest({
      type: 'saveMedia',
      captureId: '1717500000000-abce',
      mediaUrl: 'https://x.com/files/a.png',
      metadata: {},
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.request.type !== 'saveMedia') return;
    expect(parsed.request.mediaType).toBe('image');
  });

  test('query（保存済みバッジの照会）は id を運ぶ＝1本のポートで多重化できる', async () => {
    env.dispatch({ type: 'checkSaved', urls: ['https://x.com/u/status/1'] });
    const req = await env.parsedOf('query');
    expect(req.type).toBe('query');
    if (req.type !== 'query') return;
    expect(req.urls).toEqual(['https://x.com/u/status/1']);
    expect(typeof req.id).toBe('number');
  });

  test('log（capture.log の中継）', async () => {
    env.dispatch({ type: 'logCapture', entry: { stage: 'metadata', phase: 'fail', saveId: 'trace-4' } });
    const req = await env.parsedOf('log');
    expect(req.type).toBe('log');
    if (req.type !== 'log') return;
    expect(req.entry.stage).toBe('metadata');
  });

  test('大量の失敗ログは永続予約後に200件まで受理し、全件走査を集約する', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      for (let i = 0; i < 500; i++) env.dispatch({ type: 'logCapture', entry: { stage: 'unknown', phase: 'fail', error: 'own-' + i } });
      await vi.advanceTimersByTimeAsync(0);
      const sets = env.storageSets.filter((value) => Object.hasOwn(value, 'captureLogRateState'));
      expect(sets.at(-1)).toHaveProperty('captureLogRateState.count', 200);
      expect(sets.at(-1)).toHaveProperty('captureLogRateState.suppressed', 300);
      const entries = Object.entries(env.storage).filter(([key]) => key.startsWith('diaglog_'));
      expect(entries).toHaveLength(200);
      expect(new Set(entries.map(([, entry]) => (entry as { error: string }).error)).size).toBe(200);
      expect(env.storageGets.filter((key) => key === null)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1000);
      expect(env.storageGets.filter((key) => key === null)).toHaveLength(1);
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('cold start 復元待ちにはログを送らず、保存済み飽和予算を引き継ぐ', async () => {
    vi.useFakeTimers();
    try {
      const delayed = setup({ captureLogRateState: { startedAt: Date.now(), count: 200, suppressed: 17 } }, false, true);
      for (let i = 0; i < 250; i++) delayed.dispatch({ type: 'logCapture', entry: { stage: 'unknown', phase: 'fail', error: 'cold-' + i } });
      expect(delayed.sent.filter((msg) => msg.type === 'log')).toHaveLength(0);
      expect(delayed.storageSets.filter((value) => Object.hasOwn(value, 'captureLogRateState'))).toHaveLength(0);
      delayed.resolveRateGet();
      await vi.advanceTimersByTimeAsync(0);
      expect(delayed.sent.filter((msg) => msg.type === 'log')).toHaveLength(0);
      expect(delayed.storage.captureLogRateState).toMatchObject({ count: 200, suppressed: 267 });
    } finally {
      vi.useRealTimers();
    }
  });

  test('期限切れ復元の summary と窓リセットは同じ書込みで永続化する', async () => {
    vi.useFakeTimers();
    try {
      const restored = setup({ captureLogRateState: { startedAt: Date.now() - 60_001, count: 200, suppressed: 17 } });
      await vi.advanceTimersByTimeAsync(0);
      const summarySets = restored.storageSets.filter((value) => Object.keys(value).some((key) => key.startsWith('diaglog_') && key.endsWith('_rate')));
      expect(summarySets).toHaveLength(1);
      expect(summarySets[0]).toHaveProperty('captureLogRateState.count', 0);
      expect(Object.values(summarySets[0])).toContainEqual(expect.objectContaining({ suppressed: 17, error: 'capture log rate limit' }));
    } finally {
      vi.useRealTimers();
    }
  });

  test('保存中に線へ載ったメッセージは、1件残らず契約の型に収まる', async () => {
    env.dispatch({ type: 'savePost', platform: 'x', postUrl: UNPARSABLE_POST_URL, saveId: 'trace-5' });
    await env.parsedOf('savePost');
    expect(env.sent.length).toBeGreaterThan(0);
    for (const message of env.sent) {
      const parsed = parseHostRequest(message);
      expect(parsed.ok, `契約に無いメッセージが送られた: ${JSON.stringify(message)?.slice(0, 120)}`).toBe(true);
    }
  });
});

// ping を送るのは診断ページ (extension/utils/diag.ts) だけ。DOM を丸ごと立ち上げずに
// 形だけを見る＝送る側は `satisfies HostRequest` により型検査で押さえてある。
describe('parseHostRequest — 型ごとの受理と、失敗の答え方', () => {
  test('ping', () => {
    const parsed = parseHostRequest({ type: 'ping' });
    expect(parsed.ok && parsed.request.type).toBe('ping');
  });

  test('未知の type は unknown-type ＝ホストは黙って捨てない', () => {
    const parsed = parseHostRequest({ id: 9, type: 'saveEverything' });
    expect(parsed).toEqual({ ok: false, id: 9, failure: { ok: false, code: 'unknown-type', error: 'Unknown message type' } });
  });

  test('type の無いメッセージ／オブジェクトでないものは malformed-request', () => {
    expect(parseHostRequest({ urls: [] })).toMatchObject({ ok: false, failure: { code: 'malformed-request' } });
    expect(parseHostRequest(42)).toMatchObject({ ok: false, failure: { code: 'malformed-request' } });
    expect(parseHostRequest(null)).toMatchObject({ ok: false, failure: { code: 'malformed-request' } });
  });

  test('JSON でないフレームは invalid-json ＝throw せず答えを返す', () => {
    expect(parseHostFrame('{')).toMatchObject({ ok: false, id: null, failure: { code: 'invalid-json', error: 'Invalid JSON message' } });
    expect(parseHostFrame(JSON.stringify({ type: 'ping', id: 3 }))).toMatchObject({ ok: true, request: { type: 'ping', id: 3 } });
  });

  test('必須フィールドの欠落は保存ハンドラへ渡さない', () => {
    expect(parseHostRequest({ type: 'saveMedia' })).toMatchObject({ ok: false, failure: { code: 'malformed-request' } });
  });

  test('病的に長いタグは正規化せず、保存成功にせず malformed-request で返す', () => {
    const pathological = '\u0300\uff9e'.repeat(30_000);
    const parsed = parseHostRequest({ type: 'savePost', captureId: '1717500000000-ab01', metadata: { tags: [pathological] } });
    expect(parsed).toMatchObject({ ok: false, failure: { code: 'malformed-request' } });
  });

  test('query の不正な urls は拒否する', () => {
    const parsed = parseHostRequest({ type: 'query', id: 1, urls: ['https://x.com/u/status/1', null, 42, ''] });
    expect(parsed).toMatchObject({ ok: false, failure: { code: 'malformed-request' } });
  });
  test.each([{ choices: Array.from({ length: 101 }, () => ({ text: '選択肢', votes: 0 })) }, { choices: [{ text: 'a'.repeat(1001), votes: 0 }] }])('過大な投票は保存要求として受け付けない: %#', ({ choices }) => {
    expect(parseHostRequest({ type: 'savePost', captureId: '1717500000000-ab01', metadata: { poll: { choices } } })).toMatchObject({ ok: false, failure: { code: 'malformed-request' } });
  });
  test('上限内の投票は保存要求で保持する', () => {
    const poll = { choices: [{ text: '通常', votes: 3 }], multiple: false };
    expect(parseHostRequest({ type: 'savePost', captureId: '1717500000000-ab01', metadata: { poll } })).toMatchObject({ ok: true, request: { metadata: { poll } } });
  });
});

describe('captureId は契約が持つ＝保存フォルダから出られない形だけを通す', () => {
  test('拡張が振る id は契約の形に合う', () => {
    for (let i = 0; i < 50; i++) expect(isCaptureId(generateCaptureId())).toBe(true);
  });

  test('旧短桁IDと32桁IDを同じ保存要求として受け付ける', () => {
    for (const captureId of ['1717500000000-a', `1717500000000-${'a'.repeat(32)}`]) {
      const parsed = parseHostRequest({ type: 'saveMedia', captureId, mediaUrl: 'https://example.com/a.jpg', metadata: {} });
      expect(parsed).toMatchObject({ ok: true, request: { captureId } });
    }
    expect(parseHostRequest({ type: 'saveMedia', captureId: `1717500000000-${'a'.repeat(33)}`, mediaUrl: 'https://example.com/a.jpg', metadata: {} }).ok).toBe(false);
  });

  test('パス区切りや .. を含む id は請求の時点で落ちる', () => {
    for (const bad of ['../../etc/passwd', '1717500000000-ab/cd', '1717500000000-ab\\cd', '..', '', 'nope']) {
      expect(isCaptureId(bad)).toBe(false);
      const parsed = parseHostRequest({ type: 'saveMedia', captureId: bad, mediaUrl: 'https://example.com/a.jpg' });
      expect(parsed.ok).toBe(false);
    }
  });
});

describe('readHostResponse / responseId — 返信の読み方も1か所', () => {
  test('ok:true は ack、それ以外は文言つきの失敗', () => {
    expect(readHostResponse({ ok: true, captureId: '1717500000000-ab', file: 'a.jpg', saveFolder: 'D:/x', media: [], mediaCount: 0 })).toMatchObject({ ok: true, ack: { file: 'a.jpg' } });
    expect(readHostResponse({ ok: false, error: 'Post unavailable: …', code: 'save-failed' })).toEqual({ ok: false, error: 'Post unavailable: …', code: 'save-failed', protocolVersion: null, extBuild: null });
  });

  // 最悪なのは、保存は実際に成功しているのに読み手が「失敗した」と言うこと。だから
  // 見覚えのない欄はそのまま通す。ホストと拡張機能は別々の経路で更新される（#205 が
  // 扱う版のずれ）。
  test('見覚えのないフィールドを持つ ack も ack のまま通る', () => {
    expect(readHostResponse({ ok: true, file: 'a.jpg', somethingNewer: 1 })).toMatchObject({ ok: true });
  });

  test('返信になっていないものは既定の文言で失敗にする', () => {
    expect(readHostResponse(undefined)).toEqual({ ok: false, error: 'Native host returned an error', code: null, protocolVersion: null, extBuild: null });
    expect(readHostResponse({ ok: false })).toEqual({ ok: false, error: 'Native host returned an error', code: null, protocolVersion: null, extBuild: null });
  });

  test('返信の id は、どの問い合わせの答えかを言う唯一の手段', () => {
    expect(responseId({ id: 12, ok: true })).toBe(12);
    expect(responseId({ ok: true })).toBeNull(); // 保存の返信。1往復で閉じるポートなので id は要らない
  });
});

test('PROTOCOL_VERSION は契約が変わった時だけ動く整数（#205 が比較する値）', () => {
  expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  expect(PROTOCOL_VERSION).toBeGreaterThan(0);
});

// 拡張機能とホストは別々の経路で更新される（拡張機能＝Chrome ウェブストア／ホスト＝
// アプリの自動更新）。だから「片側だけが新しい」のは事故ではなく普通の状態。ここで
// 見るのは、そのずれについて2つ。(1) 検出されること、(2) 検出しても保存を止めないこと。
describe('プロトコル版のハンドシェイク（#205）', () => {
  test('返信への刻印は1か所で付く＝2つ目の送り手が付け忘れられない', () => {
    expect(stampProtocol({ ok: true, pong: true })).toEqual({ ok: true, pong: true, protocolVersion: PROTOCOL_VERSION });
    // 失敗の返信にも付ける。保存を断るほど古いホストこそ、版を知りたい相手。
    expect(stampProtocol({ ok: false, error: 'boom', code: 'save-failed' })).toMatchObject({ protocolVersion: PROTOCOL_VERSION });
  });

  test('比較は整数比較だけ（版ごとの分岐は持たない）', () => {
    expect(protocolSkewOf(PROTOCOL_VERSION)).toBe('match');
    expect(protocolSkewOf(PROTOCOL_VERSION - 1)).toBe('host-old');
    expect(protocolSkewOf(PROTOCOL_VERSION + 1)).toBe('host-new');
  });

  test('版を名乗らない返信は「ホストが古い」＝配備し損ねた bridge.js を見つける道（#511）', () => {
    expect(hostProtocolVersion({ ok: true })).toBeNull();
    expect(protocolSkewOf(hostProtocolVersion({ ok: true }))).toBe('host-old');
    // 比較できない刻印は「無い」と同じ扱いにする＝3つ目の状態を作らない。
    expect(hostProtocolVersion({ ok: true, protocolVersion: '1' })).toBeNull();
    expect(hostProtocolVersion({ ok: true, protocolVersion: 1.5 })).toBeNull();
    expect(hostProtocolVersion({ ok: true, protocolVersion: 3 })).toBe(3);
  });

  test('版がずれていても保存は止まらず、結果に更新案内が乗る', async () => {
    const env = setup();
    const responseP = env.dispatch({ type: 'savePost', platform: 'x', postUrl: UNPARSABLE_POST_URL, saveId: 'skew-1' });
    const port = await env.portThatSent('savePost');
    // 版を名乗らない＝この契約より古いホスト。ack 自体は普通に返ってくる。
    port.emitMessage({ ok: true, captureId: '1717500000000-abcd', file: 'a.jpg', saveFolder: 'D:/x', media: [] });
    const res = await responseP;
    expect(res.ok).toBe(true); // ⚠️止めない＝データを捨てない（再送キュー #203 と同じ方針）
    expect(res.captureId).toBe('1717500000000-abcd'); // 保存の結果もそのまま届く
    expect(res.hostSkew).toBe('host-old');
  });

  // #650: ローカルビルドの印も同じ席に乗る。版と違って中身は一切読まない＝比較は
  // 一致か不一致かだけ。付くのは開発機だけで、配布ビルドには必ず無い。
  test('ローカルビルドの印は、言うことがある時だけ乗る（既定の返信は #650 以前と同一）', () => {
    expect(stampProtocol({ ok: true, pong: true })).toEqual({ ok: true, pong: true, protocolVersion: PROTOCOL_VERSION });
    expect(stampProtocol({ ok: true, pong: true }, null)).toEqual({ ok: true, pong: true, protocolVersion: PROTOCOL_VERSION });
    expect(stampProtocol({ ok: true, pong: true }, 'b-1')).toEqual({ ok: true, pong: true, protocolVersion: PROTOCOL_VERSION, extBuild: 'b-1' });
    // 失敗の返信にも乗せる。ビルドを焼いた直後にホストが失敗を返す瞬間こそ、新しい
    // ビルドの印が付いていてほしい場面。
    expect(stampProtocol({ ok: false, error: 'boom', code: 'save-failed' }, 'b-1')).toMatchObject({ extBuild: 'b-1' });
  });

  test('印を名乗らない返信・空文字は「無い」と同じ＝比較対象を作らない', () => {
    expect(hostExtBuild({ ok: true })).toBeNull();
    expect(hostExtBuild({ ok: true, extBuild: '' })).toBeNull();
    expect(hostExtBuild({ ok: true, extBuild: 7 })).toBeNull();
    expect(hostExtBuild({ ok: true, extBuild: 'b-1' })).toBe('b-1');
    // 成功の返信からも失敗の返信からも同じ経路で読める（ReadResponse の両方の枝に在る）。
    expect(readHostResponse({ ok: true, extBuild: 'b-1' }).extBuild).toBe('b-1');
    expect(readHostResponse({ ok: false, error: 'boom', extBuild: 'b-1' }).extBuild).toBe('b-1');
  });

  test('版が合っていれば案内は出ない', async () => {
    const env = setup();
    const responseP = env.dispatch({ type: 'savePost', platform: 'x', postUrl: UNPARSABLE_POST_URL, saveId: 'skew-2' });
    const port = await env.portThatSent('savePost');
    port.emitMessage({ ok: true, captureId: '1717500000000-abcd', file: 'a.jpg', saveFolder: 'D:/x', media: [], protocolVersion: PROTOCOL_VERSION });
    await expect(responseP).resolves.toMatchObject({ ok: true, hostSkew: null });
  });
});
