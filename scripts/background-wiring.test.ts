// extension/utils/background.ts の chrome API 配線（メッセージ / ポート）のテスト。
// #127 が chrome.* に依存しない純関数を切り出し済みなので、ここが見るのは残りの配線——
//   - chrome.runtime.onMessage のルーティング（送信元ガード・型ごとの排他・非同期 sendResponse）
//   - bridgeSend / queryBridge が chrome.runtime.connectNative の返す Port とやりとりする
//     経路（タイムアウト・切断・エラー応答・正常応答）
//   - ホスト未到達時の診断ログのフォールバック（stashLogLocally のリングバッファと間引き）
// を、自前の chrome スタブで検証する。
//
// スタブ方針（#128 決定コメント）: ライブラリは使わない。connectNative を動く Port として
// モックできる既存ライブラリは無かった（fake-browser / jest-chrome / sinon-chrome 等いずれも
// 未実装）ため、ここは自前スタブのみで賄う。Port の参照実装は tab-stash の MockPort だが、
// このスイートはテストコード自身が常に「ホスト側」を演じる片側だけでよく、双方向ペアは組まない
// （postMessage が disconnect 後に throw する、という参照実装の性質だけは踏襲する）。
//
// bridgeSend/queryBridge は startBackground() の閉包内にあり外から直接は呼べないため、
// 実際に savePost / checkSaved メッセージを流して onMessage 経由で駆動する。fetchPostMetadata
// は実装（extension/utils/extractor/）をそのまま使うが、ネットワークに触れないよう
// postUrl にはどのプラットフォームの URL パターンにも一致しない文字列を使う
// （parsePostUrl が null を返し、fetchPostMetadata は fetch を呼ばず空レコードで即解決する）。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startBackground } from '../extension/utils/background';

// --- 自前 chrome スタブ ---------------------------------------------------------

function createPortController(onDisconnectSetLastError: (msg: string | undefined) => void) {
  const messageListeners: Array<(msg: any) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const sent: any[] = [];
  let disconnected = false;

  const port = {
    postMessage(msg: any) {
      if (disconnected) throw new Error('Attempting to postMessage on a disconnected port');
      sent.push(msg);
    },
    disconnect() {
      disconnected = true;
    },
    onMessage: { addListener: (fn: (msg: any) => void) => messageListeners.push(fn) },
    onDisconnect: { addListener: (fn: () => void) => disconnectListeners.push(fn) },
  };

  return {
    port,
    sent,
    isDisconnected: () => disconnected,
    emitMessage(msg: any) {
      for (const fn of messageListeners) fn(msg);
    },
    // lastErrorMessage: undefined ならホスト側が正常終了した切断（chrome.runtime.lastError は立たない）
    emitDisconnect(lastErrorMessage?: string) {
      disconnected = true;
      onDisconnectSetLastError(lastErrorMessage);
      for (const fn of disconnectListeners) fn();
      onDisconnectSetLastError(undefined);
    },
  };
}

function setupBackground() {
  const messageListeners: Array<(message: any, sender: any, sendResponse: (r: any) => void) => boolean> = [];
  const createdPorts: ReturnType<typeof createPortController>[] = [];
  const tabsSent: Array<{ tabId: number; message: any }> = [];
  const localStore = new Map<string, any>();
  const sessionStore = new Map<string, any>();
  let connectNativeImpl: (name: string) => any = () => {
    throw new Error('Specified native messaging host not found.');
  };

  const chromeStub: any = {
    runtime: {
      lastError: undefined as { message: string } | undefined,
      onMessage: { addListener: (fn: any) => messageListeners.push(fn) },
      connectNative: (name: string) => connectNativeImpl(name),
    },
    tabs: {
      sendMessage: (tabId: number, message: any) => {
        tabsSent.push({ tabId, message });
        return Promise.resolve();
      },
      query: async () => [],
      captureVisibleTab: async () => {
        throw new Error('captureVisibleTab is out of scope for this suite');
      },
    },
    scripting: { executeScript: async () => {} },
    action: { onClicked: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
    storage: {
      local: {
        get: (keys: any, cb: (r: any) => void) => {
          let result: Record<string, any>;
          if (keys == null) result = Object.fromEntries(localStore);
          else if (typeof keys === 'string') result = localStore.has(keys) ? { [keys]: localStore.get(keys) } : {};
          else result = Object.fromEntries((keys as string[]).filter((k) => localStore.has(k)).map((k) => [k, localStore.get(k)]));
          cb(result);
        },
        set: (items: Record<string, any>, cb?: () => void) => {
          for (const [k, v] of Object.entries(items)) localStore.set(k, v);
          cb?.();
        },
        remove: (keys: string | string[], cb?: () => void) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) localStore.delete(k);
          cb?.();
        },
      },
      session: {
        get: (key: string) => Promise.resolve(sessionStore.has(key) ? { [key]: sessionStore.get(key) } : {}),
        set: (items: Record<string, any>) => {
          for (const [k, v] of Object.entries(items)) sessionStore.set(k, v);
          return Promise.resolve();
        },
      },
    },
  };

  connectNativeImpl = () => {
    throw new Error('Specified native messaging host not found.');
  };

  (globalThis as any).chrome = chromeStub;
  startBackground();

  function dispatch(message: any, sender: any = {}) {
    // #519: 保存経路のメッセージは必ず saveId を運ぶ（ページが振る＝その保存の行を3つの
    // プロセス横断で結ぶ識別子）。テストごとに書かずに済むよう、明示が無ければ固定値を
    // 入れる — id が実際にホストまで渡ることを見る側はこの値で照合する。
    const isSave = message?.type === 'savePost' || message?.type === 'captureAndSend' || message?.type === 'imageDragged';
    const msg = isSave && message.saveId === undefined ? { ...message, saveId: 'trace-1' } : message;
    let respond!: (r: any) => void;
    const responseP = new Promise<any>((resolve) => {
      respond = resolve;
    });
    const returns = messageListeners.map((fn) => fn(msg, sender, respond));
    return { returns, responseP };
  }

  return {
    dispatch,
    tabsSent,
    localStore,
    connectAsUnavailable(message: string) {
      connectNativeImpl = () => {
        throw new Error(message);
      };
    },
    connectAsControllablePort() {
      connectNativeImpl = () => {
        const ctl = createPortController((msg) => {
          chromeStub.runtime.lastError = msg === undefined ? undefined : { message: msg };
        });
        createdPorts.push(ctl);
        return ctl.port;
      };
      return createdPorts;
    },
  };
}

// メッセージ本文に使う postUrl: どのプラットフォームの正規表現にも一致しない
// （parsePostUrl → null → fetchPostMetadata は fetch を呼ばず空レコードで即解決する）。
const UNPARSEABLE_POST_URL = 'https://misskey.example/not-a-known-post-shape';
const MISSKEY_SENDER = { tab: { id: 7, url: 'https://misskey.example/notes/1' } };

// #519 以降、保存は最初に「開始」の行を capture.log へ書く＝そのための接続が保存用の
// Port より先に開く。テストが動かしたいのは保存そのものの Port なので、作られた順番では
// なく**何を送ったか**で選ぶ（`createdPorts[0]` は今はログ用の接続）。
async function portThatSent(createdPorts: any[], type: string) {
  let found: any;
  await vi.waitFor(() => {
    found = createdPorts.find((p: any) => p.sent.some((m: any) => m.type === type));
    expect(found).toBeTruthy();
  });
  return found;
}

// capture.log 用に開かれた接続の数（保存用の Port と数え分けるため）。
const logPortCount = (createdPorts: any[]) => createdPorts.filter((p: any) => p.sent.some((m: any) => m.type === 'log')).length;

describe('chrome.runtime.onMessage ルーティング', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  test('未知の message.type には誰も応答しない', () => {
    const { returns } = env.dispatch({ type: 'notAMessageWeHandle' }, MISSKEY_SENDER);
    expect(returns.every((r) => r === false)).toBe(true);
  });

  test.each(['savePost', 'captureAndSend', 'imageDragged'])('%s: sender.tab が無ければ同期で ok:false（bridge に触れない）', (type) => {
    const { returns, responseP } = env.dispatch({ type, platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, {});
    expect(returns).toContain(false);
    expect(returns).not.toContain(true);
    return expect(responseP).resolves.toEqual({ ok: false, error: 'Missing tab context' });
  });

  test.each(['savePost', 'captureAndSend', 'imageDragged'])('%s: 送信元タブが platform と一致しなければ同期で ok:false', (type) => {
    const disallowedSender = { tab: { id: 1, url: 'https://evil.example/x.com' } };
    const { returns, responseP } = env.dispatch({ type, platform: 'x', postUrl: UNPARSEABLE_POST_URL }, disallowedSender);
    expect(returns).not.toContain(true);
    return expect(responseP).resolves.toEqual({ ok: false, error: 'Sender origin does not match platform' });
  });

  test('checkSaved: 全 URL がキャッシュ済みなら同期で応答し、ネイティブホストには繋がない', async () => {
    const createdPorts = env.connectAsControllablePort();

    // まず savePost を1件成功させ、markSaved 経由でキャッシュへ載せる。
    const save = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: true, captureId: 'saved-capture-id', file: 'saved-file-id.jpg', media: ['https://misskey.example/files/aaa.png'] });
    const saveResult = await save.responseP;
    expect(saveResult.ok).toBe(true);

    // 次に checkSaved で同じ URL を尋ねる — キャッシュヒットなので新しい Port は作られない。
    const { returns, responseP } = env.dispatch({ type: 'checkSaved', urls: [UNPARSEABLE_POST_URL] }, {});
    expect(returns).not.toContain(true); // 同期応答
    // 応答は投稿ごとに captureId ＋その投稿の保存済みの絵（#334）と、絵ごとの持ち主（#34）。
    // id is the ack's captureId, never its `file` — the badge only needs "some
    // id", but #34's "replace" reads it as the record to retire.
    await expect(responseP).resolves.toEqual({ ok: true, results: { [UNPARSEABLE_POST_URL]: { id: 'saved-capture-id', media: ['https://misskey.example/files/aaa.png'], owners: ['saved-capture-id'] } } });
    expect(createdPorts.some((p: any) => p.sent.some((m: any) => m.type === 'query'))).toBe(false); // queryBridge は呼ばれていない
  });
});

// #34 の重複保存の警告が拠って立つ照会。ここで見るのは「警告を出すか」の判定そのもの
// （2軸＝投稿 URL と絵の重なり）と、置換が名指しするレコード。UI（3択バナー）は
// capture.ts / drag.ts 側で、この答えを受け取るだけ。
describe('checkDuplicate — 重複保存の警告の判定', () => {
  let env: ReturnType<typeof setupBackground>;
  const X_SENDER = { tab: { id: 3, url: 'https://x.com/home' } };
  const POST = 'https://x.com/dave/status/444';
  const P0 = 'https://pbs.twimg.com/media/AAA?name=orig';
  const P1 = 'https://pbs.twimg.com/media/BBB?name=orig';

  beforeEach(() => {
    env = setupBackground();
  });

  // ホストの答えを1回分だけ用意する。checkDuplicate は保存前に1往復するだけなので、
  // Port を1つ作って results を返せばよい。
  async function answerQueryWith(entry: any) {
    const createdPorts = env.connectAsControllablePort();
    const asked = env.dispatch({ type: 'checkDuplicate', platform: 'x', url: POST, imageUrls: [P0] }, X_SENDER);
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    const sent = createdPorts[0].sent.find((m: any) => m.type === 'query');
    createdPorts[0].emitMessage({ id: sent.id, ok: true, results: { [POST]: entry } });
    return asked.responseP;
  }

  test('ライブラリに無い投稿は重複ではない', async () => {
    await expect(answerQueryWith(null)).resolves.toEqual({ ok: true, duplicate: false });
  });

  test('同じ絵が保存済みなら重複＝置換はその絵を持つレコードを名指しする', async () => {
    // 2枚目だけを別レコードで保存した状態。エントリの id（最初に鍵を取ったレコード）は
    // cap-a だが、いま保存しようとしている絵 P0 を持つのは cap-b。
    await expect(answerQueryWith({ id: 'cap-a', media: [P1, P0], owners: ['cap-a', 'cap-b'] })).resolves.toEqual({ ok: true, duplicate: true, captureId: 'cap-b' });
  });

  test('同じ投稿でも別の絵なら重複ではない（漫画の次のページ）', async () => {
    await expect(answerQueryWith({ id: 'cap-a', media: [P1], owners: ['cap-a'] })).resolves.toEqual({ ok: true, duplicate: false });
  });

  test('絵の分からない保存済み投稿は投稿 URL だけで警告する', async () => {
    await expect(answerQueryWith({ id: 'cap-a', media: [], owners: [] })).resolves.toEqual({ ok: true, duplicate: true, captureId: 'cap-a' });
  });

  test('owners を持たない古いスナップショット（v2）はエントリの id に落ちる', async () => {
    await expect(answerQueryWith({ id: 'cap-a', media: [P0] })).resolves.toEqual({ ok: true, duplicate: true, captureId: 'cap-a' });
  });

  test('URL の無い保存は照会せず、重複でもない＝保存を止めない', async () => {
    const createdPorts = env.connectAsControllablePort();
    const { responseP } = env.dispatch({ type: 'checkDuplicate', platform: 'x', url: '', imageUrls: [] }, X_SENDER);
    await expect(responseP).resolves.toEqual({ ok: true, duplicate: false });
    expect(createdPorts.length).toBe(0);
  });

  test('ホストへ繋がらないときは ok:false ＝呼び出し側はそのまま保存する', async () => {
    env.connectAsUnavailable('Specified native messaging host not found.');
    const { responseP } = env.dispatch({ type: 'checkDuplicate', platform: 'x', url: POST, imageUrls: [P0] }, X_SENDER);
    await expect(responseP).resolves.toEqual({ ok: false });
  });
});

describe('bridgeSend — 保存経路のネイティブホスト Port 配線', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  test('ホスト未導入（connectNative が同期 throw）→ host-missing で保存が失敗する', async () => {
    env.connectAsUnavailable('Specified native messaging host not found.');

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    const result = await responseP;

    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('host-missing');
    expect(result.error).toMatch(/Native host unavailable/);
  });

  test('ホストが応答なくタイムアウト（30秒）→ host-unavailable', async () => {
    vi.useFakeTimers();
    try {
      env.connectAsControllablePort();

      const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
      await vi.advanceTimersByTimeAsync(30_000);
      const result = await responseP;

      // metaReason は null＝ホストが落ちたのは投稿の事情ではない（#505）。
      // ここに理由が乗ると、取れない投稿の文面へ誤って倒れる。
      expect(result).toEqual({ ok: false, errorKind: 'host-unavailable', metaReason: null, error: 'Native host timed out' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('ホストが切断（chrome.runtime.lastError あり）→ その文言で分類される', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitDisconnect('Native host has exited.');
    const result = await responseP;

    expect(result).toEqual({ ok: false, errorKind: 'host-unavailable', metaReason: null, error: 'Native host has exited.' });
  });

  test('ホストがエラー応答（{ok:false}）→ msg.error の文言で分類される', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: false, error: 'Access to the specified native messaging host is forbidden by the manifest allowlist.' });
    const result = await responseP;

    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('origin-rejected');
  });

  test('ホストが正常応答 → ok:true で ack が返り、切断後の postMessage は throw する', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    const portCtl = await portThatSent(createdPorts, 'savePost');
    // #519: saveId も一緒にホストへ渡る＝ホストが書く行を拡張側の行と結べる。
    expect(portCtl.sent).toEqual([expect.objectContaining({ type: 'savePost', captureId: expect.any(String), saveId: 'trace-1' })]);

    portCtl.emitMessage({ ok: true, file: 'saved-file-id' });
    const result = await responseP;

    expect(result).toMatchObject({ ok: true, file: 'saved-file-id' });
    expect(portCtl.isDisconnected()).toBe(true); // finish() が port.disconnect() を呼ぶ
    expect(() => portCtl.port.postMessage({ type: 'late' })).toThrow();
    // markSaved がこの送信元タブへ savedUpdate を通知している。
    expect(env.tabsSent.some((s) => s.tabId === MISSKEY_SENDER.tab.id && s.message.type === 'savedUpdate')).toBe(true);
  });

  // #334: 通知が運ぶのは「保存された」だけでなく「どの絵が」＝ホストが実際に記録した
  // ものをそのまま渡す。これが欠けると、複数枚投稿の1枚を保存した直後だけ残りの絵の
  // 保存ボタンが消える（オーバーレイが投稿まるごと保存済みと読むため）。
  test('savedUpdate はホストが記録した絵の URL を運ぶ', async () => {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: true, file: 'saved-file-id', media: ['https://misskey.example/files/one.png'] });
    await responseP;

    const update = env.tabsSent.find((s) => s.message.type === 'savedUpdate');
    expect(update?.message.media).toEqual(['https://misskey.example/files/one.png']);
  });
});

describe('queryBridge — checkSaved の常駐 Port 配線', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  test('タイムアウト（8秒）→ ok:false でその URL は結果に含まれない', async () => {
    vi.useFakeTimers();
    try {
      env.connectAsControllablePort();

      const { responseP } = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1'] }, {});
      await vi.advanceTimersByTimeAsync(8_000);
      const result = await responseP;

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Native host timed out');
      expect(result.results).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  test('切断は保留中の問い合わせ全部を失敗させ、ポートは次回問い合わせで張り直される', async () => {
    const createdPorts = env.connectAsControllablePort();

    const first = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1', 'https://x.com/b/status/2'] }, {});
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    createdPorts[0].emitDisconnect('Native host has exited.');
    const firstResult = await first.responseP;
    expect(firstResult).toEqual({ ok: false, error: 'Native host has exited.', results: {} });

    // 次の問い合わせは新しい Port を張り直す（古い切断済み Port は再利用しない）。
    const second = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1'] }, {});
    await vi.waitFor(() => expect(createdPorts.length).toBe(2));
    // nextQueryId は張り直しても引き継がれる（1件目の失敗リクエストが使った id を再利用しない）ので、
    // 実際に送られた id を読み取って返す。
    const sentId = createdPorts[1].sent[0].id;
    createdPorts[1].emitMessage({ id: sentId, results: { 'https://x.com/a/status/1': { id: 'file-1', media: [] } } });
    await expect(second.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/a/status/1': { id: 'file-1', media: [] } } });
  });

  test('1本のポートで複数の問い合わせを id 突き合わせでさばく', async () => {
    const createdPorts = env.connectAsControllablePort();

    const first = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1'] }, {});
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    const second = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/b/status/2'] }, {});
    await vi.waitFor(() => expect(createdPorts[0].sent.length).toBe(2));

    expect(createdPorts.length).toBe(1); // 同じポートを使い回す

    // 応答順を入れ替えて返す — id で正しい呼び出し元へ届くことを確認する。
    const [reqA, reqB] = createdPorts[0].sent;
    createdPorts[0].emitMessage({ id: reqB.id, results: { 'https://x.com/b/status/2': { id: 'file-b', media: [] } } });
    createdPorts[0].emitMessage({ id: reqA.id, results: { 'https://x.com/a/status/1': { id: 'file-a', media: [] } } });

    await expect(first.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/a/status/1': { id: 'file-a', media: [] } } });
    await expect(second.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/b/status/2': { id: 'file-b', media: [] } } });
  });
});

// #519: 保存の一生を capture.log に残す。ここで見るのはサービスワーカー側の3点＝
// ①保存が**始まったことを名乗る**（これが無いと「起動しただけ」と区別できない）
// ②失敗の行が saveId ＋ captureId ＋ 到達した段を運ぶ（時刻の近さで結ばずに済む）
// ③段を通過するたびページへ報告する（ワーカーごと消えた時にページ側が名乗れる）。
// ページ側の受け取りと cancel の行は scripts/save-log.test.ts。
describe('保存の記録（#519）', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  // 上限に達する前・プロセスごと消えた場合にも残る唯一の行なので、待つ脚より
  // 先に出ていることが要件。ホストがまだ何も答えていない時点で見る。
  test('保存を受け付けた時点で「開始」の行が出る（どの待ちより先）', async () => {
    const createdPorts = env.connectAsControllablePort();

    env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);

    const logPort = await portThatSent(createdPorts, 'log');
    expect(logPort.sent[0].entry).toMatchObject({ stage: 'save', phase: 'begin', type: 'savePost', saveId: 'trace-1', url: UNPARSEABLE_POST_URL, captureId: expect.any(String) });
    // ログ用の接続は保存用とは別＝1保存につきホストのプロセスが1つ増える。
    // 「開始」を上限より先にディスクへ置くための代償で、意図した設計。
    expect(logPortCount(createdPorts)).toBe(1);
  });

  test('失敗の行は同じ保存の行として結べる（saveId・captureId・到達した段）', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitDisconnect('Native host has exited.');
    await responseP;

    const failLine = [...env.localStore.values()].find((e: any) => e.phase === 'fail');
    expect(failLine, `stashed: ${JSON.stringify([...env.localStore.values()])}`).toMatchObject({
      stage: 'bridge',
      phase: 'fail',
      saveId: 'trace-1',
      captureId: expect.any(String),
      // メタデータは通過してブリッジで落ちた＝どこまで進んだかが行に載る。
      reached: ['metadata'],
    });
  });

  test('段を通過するたびページへ報告する（ワーカーが消えてもページが名乗れるように）', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: true, file: 'saved-file-id' });
    await responseP;

    const progress = env.tabsSent.filter((s) => s.message.type === 'saveProgress').map((s) => s.message);
    expect(progress.map((m) => m.reached)).toEqual([['metadata'], ['metadata', 'bridge']]);
    expect(progress.every((m) => m.saveId === 'trace-1')).toBe(true);
  });
});

describe('診断ログのフォールバック（stashLogLocally のリングバッファと間引き）', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  test('phase:"fail" は即座にローカルへ退避される（ホストの生死を待たない）', () => {
    env.connectAsUnavailable('Specified native messaging host not found.');

    env.dispatch({ type: 'logCapture', entry: { stage: 'bridge', phase: 'fail', error: 'boom' } }, { tab: { url: 'https://x.com/a' } });

    const stashed = [...env.localStore.values()];
    expect(stashed).toHaveLength(1);
    expect(stashed[0]).toMatchObject({ stage: 'bridge', phase: 'fail', error: 'boom', host: 'x.com' });
  });

  test('phase 以外（正常系ログ）はホストへ届けば退避されない', async () => {
    const createdPorts = env.connectAsControllablePort();

    env.dispatch({ type: 'logCapture', entry: { stage: 'activate', phase: 'click' } }, { tab: { url: 'https://x.com/a' } });
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    createdPorts[0].emitMessage({ ok: true });
    await vi.waitFor(() => expect(createdPorts[0].isDisconnected()).toBe(true));

    expect(env.localStore.size).toBe(0);
  });

  test('phase 以外でもホストへ届かなければ退避される（切断）', async () => {
    const createdPorts = env.connectAsControllablePort();

    env.dispatch({ type: 'logCapture', entry: { stage: 'activate', phase: 'click' } }, { tab: { url: 'https://x.com/a' } });
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    createdPorts[0].emitDisconnect('Native host has exited.');
    await vi.waitFor(() => expect(env.localStore.size).toBe(1));
  });

  test('リングバッファは50件までで、超えた分は古い順に間引かれる', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T00:00:00.000Z'));
    try {
      env.connectAsUnavailable('Specified native messaging host not found.');

      for (let i = 0; i < 55; i++) {
        env.dispatch({ type: 'logCapture', entry: { stage: 'bridge', phase: 'fail', seq: i } }, { tab: { url: 'https://x.com/a' } });
        vi.advanceTimersByTime(1); // ts を1msずつ進め、間引き順の判定を決定的にする
      }

      const { responseP } = env.dispatch({ type: 'dumpLogs' }, {});
      const { entries } = await responseP;

      expect(entries).toHaveLength(50);
      expect(entries[0].seq).toBe(5); // 古い5件（seq 0-4）が間引かれた
      expect(entries[49].seq).toBe(54);
    } finally {
      vi.useRealTimers();
    }
  });
});

// #450: ページが動画投稿について渡せるのはポスターだけで、それ1枚を作品として保存しても
// ライブラリに置く意味が無い。動画・GIF 投稿は、プラットフォームが申告した原本を落とす
// 投稿保存の経路（#119 段1 で動画本体に対応済み）へ回す＝ここで見るのはその振り分け。
describe('imageDragged の振り分け（#450）', () => {
  const X_SENDER = { tab: { id: 3, url: 'https://x.com/alice/status/1' } };
  const X_POST_URL = 'https://x.com/alice/status/1';
  const POSTER = 'https://pbs.twimg.com/amplify_video_thumb/1/img/abc.jpg';

  function mockSyndication(mediaDetails: unknown[]) {
    vi.stubGlobal('fetch', async (url: unknown) => (String(url).includes('cdn.syndication.twimg.com') ? new Response(JSON.stringify({ text: 'hi', user: { screen_name: 'alice', id_str: '1' }, mediaDetails }), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 404 })));
  }

  afterEach(() => vi.unstubAllGlobals());

  async function dispatchDrag(mediaDetails: unknown[]) {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();
    mockSyndication(mediaDetails);

    const drag = env.dispatch({ type: 'imageDragged', platform: 'x', postUrl: X_POST_URL, imageUrls: [POSTER] }, X_SENDER);
    const portCtl = await portThatSent(createdPorts, 'savePost');
    const sentToHost = portCtl.sent[0];
    portCtl.emitMessage({ ok: true, file: 'saved-file-id' });
    await drag.responseP;
    return sentToHost;
  }

  test('動画投稿は投稿保存へ回り、動画の直リンクを記録に載せる', async () => {
    const sent = await dispatchDrag([
      {
        type: 'video',
        media_url_https: POSTER,
        video_info: { variants: [{ content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' }] },
      },
    ]);

    expect(sent.type).toBe('savePost');
    expect(sent.metadata.mediaType).toBe('video');
    expect(sent.metadata.media).toHaveLength(1);
    expect(sent.metadata.media[0]).toMatchObject({ type: 'video', url: 'https://video.twimg.com/high.mp4' });
  });

  test('GIF 投稿も同じ経路へ回る', async () => {
    const sent = await dispatchDrag([{ type: 'animated_gif', media_url_https: POSTER, video_info: { variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/g.mp4' }] } }]);

    expect(sent.type).toBe('savePost');
    expect(sent.metadata.mediaType).toBe('gif');
    expect(sent.metadata.media[0]).toMatchObject({ type: 'gif', url: 'https://video.twimg.com/g.mp4' });
  });

  // 静止画は従来どおり＝指した絵そのものが記録の主画像になる作品記録の形を崩さない。
  test('静止画の投稿は従来のドラッグ保存のまま', async () => {
    const stillUrl = 'https://pbs.twimg.com/media/AAA.jpg';
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();
    mockSyndication([{ type: 'photo', media_url_https: stillUrl }]);

    const drag = env.dispatch({ type: 'imageDragged', platform: 'x', postUrl: X_POST_URL, imageUrls: [stillUrl] }, X_SENDER);
    const portCtl = await portThatSent(createdPorts, 'saveDragged');
    const sent = portCtl.sent[0];
    portCtl.emitMessage({ ok: true, file: 'saved-file-id' });
    await drag.responseP;

    expect(sent.type).toBe('saveDragged');
    expect(sent.metadata.mediaType).toBe('image');
  });
});
