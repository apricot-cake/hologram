// Tests for the chrome API wiring (messages / ports) in extension/utils/background.ts.
// #127 already extracted the pure functions that don't depend on chrome.*, so what this file
// covers is the remaining wiring——
//   - chrome.runtime.onMessage routing (sender guard, per-type exclusivity, async sendResponse)
//   - the path bridgeSend / queryBridge use to talk to the Port returned by
//     chrome.runtime.connectNative (timeout, disconnect, error response, normal response)
//   - the diagnostic-log fallback when the host is unreachable (stashLogLocally's ring buffer and thinning)
// verified against our own chrome stub.
//
// Stub policy (#128 decision comment): no library. There was no existing library
// (fake-browser / jest-chrome / sinon-chrome, etc.) that could mock connectNative as a working
// Port (none of them implement it), so this file relies solely on a hand-rolled stub. The reference
// implementation for Port is tab-stash's MockPort, but this suite only ever needs the test code
// itself to play the "host side," a single side — it never wires up a bidirectional pair
// (the only trait carried over from the reference implementation is that postMessage throws after disconnect).
//
// bridgeSend/queryBridge live inside startBackground()'s closure and can't be called directly from
// outside, so they're driven by actually sending savePost / checkSaved messages through onMessage.
// fetchPostMetadata uses the real implementation (extension/utils/extractor/) as-is, but to avoid
// touching the network, postUrl uses a string that doesn't match any platform's URL pattern
// (parsePostUrl returns null, so fetchPostMetadata resolves immediately with an empty record without calling fetch).

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startBackground } from '../extension/utils/background';

// --- hand-rolled chrome stub ---------------------------------------------------------

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
    // lastErrorMessage: undefined means the host side disconnected normally (chrome.runtime.lastError is not set)
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
  // The #269 surface (toolbar action, injection, tab lifecycle). The default is "injection
  // succeeds / the extension's files are readable" = only tests that override this go down the failure path.
  const actionCalls: Array<{ call: string; arg: any }> = [];
  const createdTabs: Array<{ url: string }> = [];
  const clickListeners: Array<(tab: any) => void> = [];
  const tabUpdatedListeners: Array<(tabId: number, changeInfo: any) => void> = [];
  const tabRemovedListeners: Array<(tabId: number) => void> = [];
  let executeScriptImpl: (arg: any) => Promise<any> = async () => [];
  let packageReadable = true;
  const recordAction = (call: string) => (arg: any) => {
    actionCalls.push({ call, arg });
    return Promise.resolve();
  };

  const chromeStub: any = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined as { message: string } | undefined,
      onMessage: { addListener: (fn: any) => messageListeners.push(fn) },
      connectNative: (name: string) => connectNativeImpl(name),
      getURL: (file: string) => `chrome-extension://test-extension-id/${file}`,
    },
    i18n: { getMessage: (key: string) => `msg:${key}` },
    tabs: {
      sendMessage: (tabId: number, message: any) => {
        tabsSent.push({ tabId, message });
        return Promise.resolve();
      },
      query: async () => [],
      create: async (arg: any) => {
        createdTabs.push(arg);
        return { id: 999 };
      },
      captureVisibleTab: async () => {
        throw new Error('captureVisibleTab is out of scope for this suite');
      },
      onUpdated: { addListener: (fn: any) => tabUpdatedListeners.push(fn) },
      onRemoved: { addListener: (fn: any) => tabRemovedListeners.push(fn) },
    },
    scripting: { executeScript: (arg: any) => executeScriptImpl(arg) },
    action: {
      onClicked: { addListener: (fn: any) => clickListeners.push(fn) },
      setBadgeText: recordAction('setBadgeText'),
      setBadgeBackgroundColor: recordAction('setBadgeBackgroundColor'),
      setBadgeTextColor: recordAction('setBadgeTextColor'),
      setTitle: recordAction('setTitle'),
    },
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
  // A real measurement of whether the extension can read its own files (#269 / inject-failure.ts).
  // We replace fetch itself here rather than faking it = in production too, this single response
  // is what decides "is the extension broken, or did the page refuse it."
  (globalThis as any).fetch = async (url: string) => {
    if (!String(url).startsWith('chrome-extension://')) throw new Error(`unexpected fetch in this suite: ${url}`);
    if (!packageReadable) throw new Error('Failed to fetch');
    return { ok: true, status: 200 };
  };
  startBackground();

  function dispatch(message: any, sender: any = {}) {
    // #519: messages on the save path always carry a saveId (assigned by the page = the identifier
    // that ties that save's log lines together across the three processes). So we don't have to write
    // it in every test, we fill in a fixed value when none is given — tests that check the id actually
    // reaches the host verify against this value.
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
    actionCalls,
    createdTabs,
    // Click the toolbar icon (#269). onClicked passes the tab through as-is, so the test side
    // also passes a minimal tab with just id and url. **What we wait on is not a count of
    // synchronization points but the Promise the listener itself returns** = the injection,
    // liveness measurement, and action calls are all inside it, so it doesn't break even if
    // one more await gets added along the way.
    clickAction: async (tab: any) => {
      await Promise.all(clickListeners.map((fn) => fn(tab)));
    },
    navigateTab(tabId: number) {
      for (const fn of tabUpdatedListeners) fn(tabId, { status: 'loading' });
    },
    closeTab(tabId: number) {
      for (const fn of tabRemovedListeners) fn(tabId);
    },
    failInjection(message: string) {
      executeScriptImpl = async () => {
        throw new Error(message);
      };
    },
    allowInjection() {
      executeScriptImpl = async () => [];
    },
    setPackageReadable(readable: boolean) {
      packageReadable = readable;
    },
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

// postUrl used in the message body: doesn't match any platform's regex
// (parsePostUrl → null → fetchPostMetadata resolves immediately with an empty record without calling fetch).
const UNPARSEABLE_POST_URL = 'https://misskey.example/not-a-known-post-shape';
const MISSKEY_SENDER = { tab: { id: 7, url: 'https://misskey.example/notes/1' } };

// Since #519, a save writes the "started" line to capture.log first = the connection for that
// opens before the save's own Port. What the test wants to drive is the save's own Port, so we
// select it **by what it sent**, not by creation order (`createdPorts[0]` is now the log connection).
async function portThatSent(createdPorts: any[], type: string) {
  let found: any;
  await vi.waitFor(() => {
    found = createdPorts.find((p: any) => p.sent.some((m: any) => m.type === type));
    expect(found).toBeTruthy();
  });
  return found;
}

// Number of connections opened for capture.log (kept separate from the save Port's count).
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

    // First, succeed one savePost so it lands in the cache via markSaved.
    const save = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: true, captureId: 'saved-capture-id', file: 'saved-file-id.jpg', media: ['https://misskey.example/files/aaa.png'] });
    const saveResult = await save.responseP;
    expect(saveResult.ok).toBe(true);

    // Next, ask checkSaved for the same URL — it's a cache hit, so no new Port is created.
    const { returns, responseP } = env.dispatch({ type: 'checkSaved', urls: [UNPARSEABLE_POST_URL] }, {});
    expect(returns).not.toContain(true); // synchronous response
    // The response carries, per post, captureId + that post's saved image (#334), and the owner per image (#34).
    // id is the ack's captureId, never its `file` — the badge only needs "some
    // id", but #34's "replace" reads it as the record to retire.
    await expect(responseP).resolves.toEqual({ ok: true, results: { [UNPARSEABLE_POST_URL]: { id: 'saved-capture-id', media: ['https://misskey.example/files/aaa.png'], owners: ['saved-capture-id'] } } });
    expect(createdPorts.some((p: any) => p.sent.some((m: any) => m.type === 'query'))).toBe(false); // queryBridge was not called
  });
});

// The query that #34's duplicate-save warning stands on. What this checks is the "whether to
// show a warning" decision itself (two axes = post URL and image overlap) and the record that a
// replace names. The UI (the 3-way banner) is on the capture.ts / drag.ts side and just receives this answer.
describe('checkDuplicate — 重複保存の警告の判定', () => {
  let env: ReturnType<typeof setupBackground>;
  const X_SENDER = { tab: { id: 3, url: 'https://x.com/home' } };
  const POST = 'https://x.com/dave/status/444';
  const P0 = 'https://pbs.twimg.com/media/AAA?name=orig';
  const P1 = 'https://pbs.twimg.com/media/BBB?name=orig';

  beforeEach(() => {
    env = setupBackground();
  });

  // Prepare a single round of the host's answer. checkDuplicate does only one round-trip
  // before saving, so it's enough to create one Port and return results.
  async function answerQueryWith(entry: any, trashed?: any) {
    const createdPorts = env.connectAsControllablePort();
    const asked = env.dispatch({ type: 'checkDuplicate', platform: 'x', url: POST, imageUrls: [P0] }, X_SENDER);
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    const sent = createdPorts[0].sent.find((m: any) => m.type === 'query');
    // A call that doesn't pass trashed = a pre-#158 host (one that doesn't send that field).
    createdPorts[0].emitMessage({ id: sent.id, ok: true, results: { [POST]: entry }, ...(trashed === undefined ? {} : { trashed: { [POST]: trashed } }) });
    return asked.responseP;
  }

  test('ライブラリに無い投稿は重複ではない', async () => {
    await expect(answerQueryWith(null)).resolves.toEqual({ ok: true, duplicate: false });
  });

  test('同じ絵が保存済みなら重複＝置換はその絵を持つレコードを名指しする', async () => {
    // A state where only the 2nd image was saved as a separate record. The entry's id (the
    // record that first grabbed the key) is cap-a, but it's cap-b that holds the P0 image being saved now.
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

  // #158: a post that isn't in the library, but whose actual file remains in the trash. It's not
  // a duplicate (there's no counterpart to replace), so duplicate stays false, and only the notice comes back in a separate field.
  test('ゴミ箱に在る投稿は duplicate:false のまま告知を返す', async () => {
    await expect(answerQueryWith(null, { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' })).resolves.toEqual({
      ok: true,
      duplicate: false,
      trashed: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' },
    });
  });

  // The host side already decides that "saved" wins (it never carries both), but this pins down
  // that the judgment doesn't lean on that assumption = if a notice got mixed into the duplicate answer, the banner would hide the replace.
  test('保存済みなら告知は返さない（重複の答えが勝つ）', async () => {
    await expect(answerQueryWith({ id: 'cap-a', media: [P0], owners: ['cap-a'] }, { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' })).resolves.toEqual({
      ok: true,
      duplicate: true,
      captureId: 'cap-a',
    });
  });

  test('同じ投稿の別の絵なら、ゴミ箱の告知も出ない（漫画の次のページ）', async () => {
    await expect(answerQueryWith({ id: 'cap-a', media: [P1], owners: ['cap-a'] }, { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' })).resolves.toEqual({ ok: true, duplicate: false });
  });

  test('trashed を送らないホスト（#158 より前）でも判定は変わらない', async () => {
    await expect(answerQueryWith(null)).resolves.toEqual({ ok: true, duplicate: false });
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

      // metaReason is null = the host going down is not the post's fault (#505).
      // If a reason rides along here, it wrongly falls into the "post couldn't be fetched" wording.
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
    // #519: saveId is passed to the host along with it = so the line the host writes can be tied to the extension side's line.
    expect(portCtl.sent).toEqual([expect.objectContaining({ type: 'savePost', captureId: expect.any(String), saveId: 'trace-1' })]);

    portCtl.emitMessage({ ok: true, file: 'saved-file-id' });
    const result = await responseP;

    expect(result).toMatchObject({ ok: true, file: 'saved-file-id' });
    expect(portCtl.isDisconnected()).toBe(true); // finish() calls port.disconnect()
    expect(() => portCtl.port.postMessage({ type: 'late' })).toThrow();
    // markSaved has notified this sender tab with savedUpdate.
    expect(env.tabsSent.some((s) => s.tabId === MISSKEY_SENDER.tab.id && s.message.type === 'savedUpdate')).toBe(true);
  });

  // #334: what the notification carries is not just "saved" but "which image" = it passes through
  // exactly what the host actually recorded. If this is missing, right after saving one image of a
  // multi-image post, the save buttons for the remaining images disappear (because the overlay reads the whole post as saved).
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

    // The next query re-establishes a new Port (the old disconnected Port is not reused).
    const second = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1'] }, {});
    await vi.waitFor(() => expect(createdPorts.length).toBe(2));
    // nextQueryId carries over even across a re-establish (it won't reuse the id the first,
    // failed request used), so we read the id that was actually sent and return that.
    const sentId = createdPorts[1].sent[0].id;
    createdPorts[1].emitMessage({ id: sentId, ok: true, results: { 'https://x.com/a/status/1': { id: 'file-1', media: [] } } });
    await expect(second.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/a/status/1': { id: 'file-1', media: [] } } });
  });

  test('1本のポートで複数の問い合わせを id 突き合わせでさばく', async () => {
    const createdPorts = env.connectAsControllablePort();

    const first = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1'] }, {});
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    const second = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/b/status/2'] }, {});
    await vi.waitFor(() => expect(createdPorts[0].sent.length).toBe(2));

    expect(createdPorts.length).toBe(1); // reuses the same port

    // Return the responses out of order — confirm they reach the correct caller by id.
    const [reqA, reqB] = createdPorts[0].sent;
    createdPorts[0].emitMessage({ id: reqB.id, ok: true, results: { 'https://x.com/b/status/2': { id: 'file-b', media: [] } } });
    createdPorts[0].emitMessage({ id: reqA.id, ok: true, results: { 'https://x.com/a/status/1': { id: 'file-a', media: [] } } });

    await expect(first.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/a/status/1': { id: 'file-a', media: [] } } });
    await expect(second.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/b/status/2': { id: 'file-b', media: [] } } });
  });
});

// #519: leave a save's whole life in capture.log. What this checks is 3 things on the service
// worker side =
// ① a save **declares that it started** (without this, "it merely started up" can't be told apart)
// ② a failure line carries saveId + captureId + the stage it reached (so lines don't have to be tied together by close timestamps)
// ③ each stage passed reports to the page (so the page side can speak up even if the worker itself disappears).
// The page side's receiving and the cancel lines are in scripts/save-log.test.ts.
describe('保存の記録（#519）', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  // The one line that remains even before hitting the cap, and even if the whole process
  // disappears, so the requirement is that it comes out before any waiting leg. This checks the
  // point where the host hasn't answered anything yet.
  // Checks all 3 paths. `imageDragged` is the only save path used by **the resident-script surface**
  // (the hover save button and drop zone), and that surface doesn't emit an `activate` line = without
  // the "started" line, a save on that surface never appears in the record at all. Since that's the
  // surface where the user actually hit the freeze, missing this defeats #519's whole purpose.
  test.each([
    ['savePost', { type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }],
    ['save', { type: 'captureAndSend', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, rect: { x: 0, y: 0, width: 10, height: 10 } }],
    ['saveDragged', { type: 'imageDragged', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, imageUrls: ['https://misskey.example/files/a.png'] }],
  ])('%s: 保存を受け付けた時点で「開始」の行が出る（どの待ちより先）', async (type, message) => {
    const createdPorts = env.connectAsControllablePort();

    env.dispatch(message, MISSKEY_SENDER);

    const logPort = await portThatSent(createdPorts, 'log');
    expect(logPort.sent[0].entry).toMatchObject({ stage: 'save', phase: 'begin', type, saveId: 'trace-1', url: UNPARSEABLE_POST_URL, captureId: expect.any(String) });
    // The log connection is separate from the save connection = one host process for each save.
    // This is the tradeoff for getting "started" onto disk before the cap — it's the intended design.
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
      // The metadata stage passed and it fell at the bridge = how far it got rides on the line.
      reached: ['metadata'],
    });
  });

  test('段を通過するたびページへ報告する（ワーカーが消えてもページが名乗れるように）', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: true, file: 'saved-file-id' });
    await responseP;

    const progress = env.tabsSent.filter((s) => s.message.type === 'saveProgress').map((s) => s.message);
    // The leading empty array is the "received" signal = no stage has passed yet. Until this
    // arrives, the page side's deadline measures "is it even running at all," and once it has
    // arrived, "has it gone silent" (save-deadline.ts), so it needs one to come first over the same path as the stage reports.
    expect(progress.map((m) => m.reached)).toEqual([[], ['metadata'], ['metadata', 'bridge']]);
    expect(progress.every((m) => m.saveId === 'trace-1')).toBe(true);
  });

  test('保存を受け取った時点で、まだ何も通っていなくても1本押す（居るかどうかが先に分かる）', async () => {
    const createdPorts = env.connectAsControllablePort();

    // Let the port answer nothing = a save that stopped just short of the host. Even so, the
    // receipt alone has already arrived first — that's this signal's job.
    env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    await portThatSent(createdPorts, 'savePost');

    const first = env.tabsSent.filter((s) => s.message.type === 'saveProgress').map((s) => s.message)[0];
    expect(first, `tabsSent: ${JSON.stringify(env.tabsSent)}`).toMatchObject({ saveId: 'trace-1', reached: [] });
  });
});

// === When injection itself fails (#269) =========================================
//
// Click-to-save has the structure "background injects capture.js, and the injected script draws
// the banner," so **if injection fails, no surface on the page exists to report that failure** =
// clicking becomes completely unresponsive. Since the page has no surface of its own, only the
// toolbar action remains as a display surface, and what this checks is that surface's wiring.
// Drag-to-save is unrelated since the resident script draws its own banner.
//
// ⚠️What separates "the extension is broken" from "the page refused it" is not Chrome's exception
// wording but **an actual measurement of whether the extension can read its own files**
// (fetch(chrome.runtime.getURL(...))). Wording is not a contract, so branching on it would flip the
// guidance the day Chrome's phrasing changes.
describe('注入が失敗した時のツールバー表示（#269）', () => {
  let env: ReturnType<typeof setupBackground>;
  const TAB = { id: 42, url: 'https://x.com/someone/status/1' };
  const badgeText = (calls: Array<{ call: string; arg: any }>) => calls.filter((c) => c.call === 'setBadgeText').map((c) => c.arg);
  const titles = (calls: Array<{ call: string; arg: any }>) => calls.filter((c) => c.call === 'setTitle').map((c) => c.arg);

  beforeEach(() => {
    env = setupBackground();
  });

  test('注入が通れば何も出さない（正常時にノイズを足さない）', async () => {
    await env.clickAction(TAB);
    expect(badgeText(env.actionCalls)).toEqual([{ text: '', tabId: 42 }]);
    expect(env.createdTabs).toEqual([]);
  });

  test('失敗したら押したタブにだけ `!` が点く（他タブへ漏れない）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    await env.clickAction(TAB);
    expect(badgeText(env.actionCalls)).toEqual([{ text: '!', tabId: 42 }]);
    // The color comes from a generated token = there's no color literal here (#270).
    expect(env.actionCalls.filter((c) => c.call === 'setBadgeBackgroundColor')).toHaveLength(1);
    expect(env.actionCalls.every((c) => c.arg.tabId === 42)).toBe(true);
  });

  test('拡張のファイルが読めないなら「再読み込みして」と言う', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    env.setPackageReadable(false);
    await env.clickAction(TAB);
    expect(titles(env.actionCalls)).toEqual([{ title: 'msg:actionInjectUnreadable', tabId: 42 }]);
  });

  test('拡張が健全ならページ側の事情として言う（直すものが無いのに再読み込みを勧めない）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.clickAction(TAB);
    expect(titles(env.actionCalls)).toEqual([{ title: 'msg:actionInjectRefused', tabId: 42 }]);
  });

  test('1回目はバッジだけ・同じタブで2回目に初めてページが開く', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.clickAction(TAB);
    expect(env.createdTabs).toEqual([]);
    await env.clickAction(TAB);
    expect(env.createdTabs).toEqual([{ url: 'chrome-extension://test-extension-id/diag.html?issue=inject' }]);
  });

  // Measured (2026-07-31, disposable Chromium): once the extension's unpacked directory is gone,
  // chrome-extension://<id>/diag.html can't be opened — it's ERR_FILE_NOT_FOUND = **the very failure
  // that caused this Issue means we can't escape to the diagnostic page**.
  // The only surface that can still be drawn is chrome://extensions, and its "reload" is the fix itself.
  test('拡張が読めない側の2回目は chrome://extensions（診断ページはそもそも開けない）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    env.setPackageReadable(false);
    await env.clickAction(TAB);
    await env.clickAction(TAB);
    expect(env.createdTabs).toEqual([{ url: 'chrome://extensions/?id=test-extension-id' }]);
  });

  test('別タブの1回目は別に数える（1つのタブの失敗が他タブを飛ばさない）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.clickAction(TAB);
    await env.clickAction({ id: 43, url: 'https://x.com/other/status/2' });
    expect(env.createdTabs).toEqual([]);
  });

  test('ページが遷移したら数え直す（バッジはブラウザが消すので、こちらは記憶を捨てる）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.clickAction(TAB);
    env.navigateTab(42);
    await env.clickAction(TAB);
    expect(env.createdTabs).toEqual([]);
  });

  test('タブが閉じたら数え直す', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.clickAction(TAB);
    env.closeTab(42);
    await env.clickAction(TAB);
    expect(env.createdTabs).toEqual([]);
  });

  test('注入が通ったら印を消し、次の失敗はまた1回目から', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.clickAction(TAB);
    env.allowInjection();
    await env.clickAction(TAB);
    expect(badgeText(env.actionCalls).at(-1)).toEqual({ text: '', tabId: 42 });
    expect(titles(env.actionCalls).at(-1)).toEqual({ title: 'msg:actionTitle', tabId: 42 });
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.clickAction(TAB);
    expect(env.createdTabs).toEqual([]);
  });

  test('http(s) でないタブは今までどおり黙って抜ける（失敗ではない）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    await env.clickAction({ id: 44, url: 'chrome://newtab/' });
    expect(env.actionCalls).toEqual([]);
    expect(env.createdTabs).toEqual([]);
  });

  test('無反応だった押下は退避ログにも残る（診断ページが読み戻せる唯一の記録）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    await env.clickAction(TAB);
    const stashed = [...env.localStore.values()].filter((e: any) => e.stage === 'activate' && e.phase === 'fail');
    expect(stashed).toHaveLength(1);
    expect(stashed[0].error).toBe("Could not load file: 'capture.js'.");
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
        vi.advanceTimersByTime(1); // advance ts by 1ms each time to make the thinning-order judgment deterministic
      }

      const { responseP } = env.dispatch({ type: 'dumpLogs' }, {});
      const { entries } = await responseP;

      expect(entries).toHaveLength(50);
      expect(entries[0].seq).toBe(5); // the 5 oldest (seq 0-4) were thinned out
      expect(entries[49].seq).toBe(54);
    } finally {
      vi.useRealTimers();
    }
  });
});

// #450: for a video post, all the page can hand over is the poster, and saving just that single
// image as a work has no point putting it in the library. Video/GIF posts are routed to the post-save
// path that downloads the original the platform declared (support for the video itself landed at
// #119 stage 1) = what this checks is that routing.
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

  // A still image works as before = doesn't disturb the shape of a work record where the image pointed to itself becomes the record's main image.
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

// The latter half of #323. Since the page-side guard (isTrusted) only blocks "the path that
// exists today," we also put a cap on the side that spawns the host process. Each connectNative
// starts one host process (by design = this is why saving works even while the app is closed),
// so "how many can be opened" becomes exactly "how many processes can be spawned."
describe('ネイティブホストの起動を有界にする（#323）', () => {
  const MISSKEY_TAB = { tab: { id: 7, url: 'https://misskey.example/notes/1' } };
  const postUrl = (n: number) => `https://misskey.example/not-a-known-post-shape-${n}`;
  const savePorts = (createdPorts: any[]) => createdPorts.filter((p: any) => p.sent.some((m: any) => m.type === 'savePost'));

  test('同じ保存の連打は1本にまとまり、両方に同じ結果を返す', async () => {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();

    const first = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(1), saveId: 'a' }, MISSKEY_TAB);
    const second = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(1), saveId: 'b' }, MISSKEY_TAB);

    const portCtl = await portThatSent(createdPorts, 'savePost');
    portCtl.emitMessage({ ok: true, captureId: 'cap-1', file: 'one.jpg' });

    // Even with different saveIds, "the same post from the same tab" = the same save. No 2nd host connection is opened.
    expect(savePorts(createdPorts)).toHaveLength(1);
    await expect(first.responseP).resolves.toMatchObject({ ok: true, captureId: 'cap-1' });
    await expect(second.responseP).resolves.toMatchObject({ ok: true, captureId: 'cap-1' });
  });

  test('同時に走らせられる保存には上限があり、超えた分は接続を開かずに断る', async () => {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();

    // None of them answer = they all hold onto their slot. A count no human operation could reach (the cap is 8).
    for (let i = 0; i < 8; i++) env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(i), saveId: `s${i}` }, MISSKEY_TAB);
    await vi.waitFor(() => expect(savePorts(createdPorts)).toHaveLength(8));

    const refused = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(99), saveId: 's99' }, MISSKEY_TAB);

    // The refusal returns synchronously = the host was never touched.
    expect(refused.returns).not.toContain(true);
    await expect(refused.responseP).resolves.toMatchObject({ ok: false, errorKind: 'busy' });
    expect(savePorts(createdPorts)).toHaveLength(8);
  });

  test('正常に終われば枠は戻る（断りが焼き付かない）', async () => {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();

    const running = [];
    for (let i = 0; i < 8; i++) running.push(env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(i), saveId: `s${i}` }, MISSKEY_TAB));
    await vi.waitFor(() => expect(savePorts(createdPorts)).toHaveLength(8));
    savePorts(createdPorts)[0].emitMessage({ ok: true, captureId: 'cap-0', file: 'zero.jpg' });
    // The slot has already been returned by the time the response comes back (releasing the slot runs before sendResponse).
    await expect(running[0].responseP).resolves.toMatchObject({ ok: true });

    const next = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(100), saveId: 's100' }, MISSKEY_TAB);
    await vi.waitFor(() => expect(savePorts(createdPorts)).toHaveLength(9));
    expect(next.returns).toContain(true); // accepted as a real save, not busy
  });

  // The very origin of this Issue = a click that doesn't resolve to a post emits a diagnostic log
  // line one at a time, and a connection was being opened for each one of those lines. Lines
  // aren't dropped, only the connections get batched together.
  //
  // Don't make the first line wait (emit it at the front) = #519's "save started" line needs to
  // get onto disk before any subsequent waiting gets backed up. What gets batched is what
  // accumulated while that one connection was open, so even with 20 lines, only 2 connections are opened = it doesn't scale with the line count.
  test('失敗ログが連続しても、接続は行数に比例しない（開いている1本にまとめる）', async () => {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();
    // Count connections by "did it carry any of these 20 lines." A timer from a worker the
    // previous test spun up can leak into this stub (only happens in the test environment = in reality there's just one worker).
    const ourLines = (port: any) => port.sent.filter((m: any) => m.type === 'log' && typeof m.entry?.seq === 'number');
    const ourPorts = () => createdPorts.filter((p: any) => ourLines(p).length);

    for (let i = 0; i < 20; i++) {
      env.dispatch({ type: 'logCapture', entry: { stage: 'select', phase: 'fail', seq: i } }, { tab: { url: 'https://x.com/a' } });
    }

    await vi.waitFor(() => expect(ourPorts()).toHaveLength(1));
    expect(ourLines(ourPorts()[0])).toHaveLength(1); // the first line comes out right away = connections don't increase for the remaining 19 lines

    ourPorts()[0].emitMessage({ ok: true }); // this connection is now spent = what piled up comes out in the next single connection
    await vi.waitFor(() => expect(ourPorts()).toHaveLength(2), { timeout: 3000 });
    expect(ourLines(ourPorts()[1])).toHaveLength(19); // no line was dropped
    expect(ourPorts()).toHaveLength(2); // 2 connections for 20 lines
  });
});
