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
  // Kept even though #124 removed the listener: an empty array is what the
  // "the action must not register onClicked" test below reads.
  const clickListeners: Array<(tab: any) => void> = [];
  const commandListeners: Array<(command: string) => Promise<void> | void> = [];
  // What chrome.tabs.query({active:true}) answers with — the tab both the
  // keyboard commands and the popup route act on.
  let activeTab: any = null;
  const tabUpdatedListeners: Array<(tabId: number, changeInfo: any) => void> = [];
  const tabRemovedListeners: Array<(tabId: number) => void> = [];
  let executeScriptImpl: (arg: any) => Promise<any> = async () => [];
  // What the RESIDENT content script would answer chrome.tabs.sendMessage
  // with (#793's popupCheckBulk gateway). Matches production's default for
  // every OTHER caller in this suite — none of them read the resolved value,
  // they fire-and-forget with .catch() — so leaving this unresolved-to-undefined
  // changes nothing for them.
  let tabsSendMessageImpl: (tabId: number, message: any) => Promise<any> = async () => undefined;
  let packageReadable = true;
  const recordAction = (call: string) => (arg: any) => {
    actionCalls.push({ call, arg });
    return Promise.resolve();
  };

  // #195: modeled here (unlike host-protocol.test.ts / background-unit.test.ts's
  // stubs, which don't) because this file is where the context-menu save route
  // gets its own coverage below. removeAll's callback fires synchronously —
  // real Chrome is async, but nothing here depends on the ordering, and a fake
  // microtask would only add noise.
  const contextMenuListeners: Array<(info: any, tab: any) => void> = [];
  const contextMenuCreateCalls: any[] = [];
  const chromeStub: any = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined as { message: string } | undefined,
      // removeListener (#239's readPageMeta registers a one-shot listener per
      // bookmark save and removes it once answered) — real Chrome has this on
      // every onMessage; every other listener registered against this stub is
      // permanent for the test's lifetime and never calls it. Replaced with a
      // no-op rather than spliced out: dispatch() below is mid-`.map()` over
      // this same array when a listener calls this (it removes ITSELF upon
      // matching), and splicing during that map would reindex and skip
      // whichever listener follows it.
      onMessage: {
        addListener: (fn: any) => messageListeners.push(fn),
        removeListener: (fn: any) => {
          const i = messageListeners.indexOf(fn);
          if (i >= 0) messageListeners[i] = () => false;
        },
      },
      connectNative: (name: string) => connectNativeImpl(name),
      getURL: (file: string) => `chrome-extension://test-extension-id/${file}`,
    },
    i18n: { getMessage: (key: string) => `msg:${key}` },
    contextMenus: {
      removeAll: (cb?: () => void) => cb?.(),
      create: (opts: any, cb?: () => void) => {
        contextMenuCreateCalls.push(opts);
        cb?.();
      },
      onClicked: { addListener: (fn: any) => contextMenuListeners.push(fn) },
    },
    tabs: {
      sendMessage: (tabId: number, message: any) => {
        tabsSent.push({ tabId, message });
        return tabsSendMessageImpl(tabId, message);
      },
      query: async () => (activeTab ? [activeTab] : []),
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
    commands: { onCommand: { addListener: (fn: any) => commandListeners.push(fn) } },
    storage: {
      // Both call shapes, because the code under test uses both: the older
      // readers pass a callback, and save-history.ts awaits the promise MV3
      // returns when none is given. A stub that only did callbacks would let
      // every history read silently answer "empty".
      local: {
        get: (keys: any, cb?: (r: any) => void) => {
          let result: Record<string, any>;
          if (keys == null) result = Object.fromEntries(localStore);
          else if (typeof keys === 'string') result = localStore.has(keys) ? { [keys]: localStore.get(keys) } : {};
          else result = Object.fromEntries((keys as string[]).filter((k) => localStore.has(k)).map((k) => [k, localStore.get(k)]));
          if (!cb) return Promise.resolve(result);
          cb(result);
          return undefined;
        },
        set: (items: Record<string, any>, cb?: () => void) => {
          for (const [k, v] of Object.entries(items)) localStore.set(k, v);
          if (!cb) return Promise.resolve();
          cb();
          return undefined;
        },
        remove: (keys: string | string[], cb?: () => void) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) localStore.delete(k);
          if (!cb) return Promise.resolve();
          cb();
          return undefined;
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
    // #195: the context-menu equivalent of dispatch/pressShortcut above — fires
    // the listener startBackground() registered via chrome.contextMenus.onClicked.
    contextMenuCreateCalls,
    clickBookmarkMenu(tab: any, infoOverrides: any = {}) {
      for (const fn of contextMenuListeners) fn({ menuItemId: 'hologram-bookmark', ...infoOverrides }, tab);
    },
    // The two ways an activation can now be asked for (#124 replaced the third,
    // chrome.action.onClicked, with the popup message below).
    //
    // Both find their own tab through chrome.tabs.query, so the test says which
    // tab is active rather than handing one in. **What we wait on is not a count
    // of synchronization points but the Promise the entry point itself returns**
    // = the injection, liveness measurement, and action calls are all inside it,
    // so it doesn't break even if one more await gets added along the way.
    onClickedListenerCount: () => clickListeners.length,
    pressShortcut: async (tab: any, auto = false) => {
      activeTab = tab;
      await Promise.all(commandListeners.map((fn) => fn(auto ? 'activate-auto' : 'activate')));
    },
    // The popup's save button. Answers with the {ok} / {reason} the panel reads
    // to decide what to say — the thing the toolbar had no way to tell anyone.
    popupSave: async (tab: any) => {
      activeTab = tab;
      const { responseP } = dispatch({ type: 'popupActivate' });
      return await responseP;
    },
    // The popup's "この一覧を取り込む" item (#793): asks background, which asks
    // the RESIDENT content script (chrome.tabs.sendMessage, not injection) —
    // setResidentBulkAnswer below stands in for that script's own answer.
    popupCheckBulk: async (tab: any) => {
      activeTab = tab;
      const { responseP } = dispatch({ type: 'popupCheckBulk' });
      return await responseP;
    },
    setResidentBulkAnswer(answer: { supported: boolean } | 'no-listener') {
      tabsSendMessageImpl = async (_tabId, message) => {
        if (message?.type !== 'checkBulkCapturePage') return undefined;
        if (answer === 'no-listener') throw new Error('Could not establish connection. Receiving end does not exist.');
        return answer;
      };
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
// Save-by-activation has the structure "background injects capture.js, and the injected script draws
// the banner," so **if injection fails, no surface on the page exists to report that failure** =
// the press becomes completely unresponsive. Since the page has no surface of its own, only the
// toolbar action remains as a display surface, and what this checks is that surface's wiring.
// Drag-to-save is unrelated since the resident script draws its own banner.
//
// ⚠️What separates "the extension is broken" from "the page refused it" is not Chrome's exception
// wording but **an actual measurement of whether the extension can read its own files**
// (fetch(chrome.runtime.getURL(...))). Wording is not a contract, so branching on it would flip the
// guidance the day Chrome's phrasing changes.
//
// Driven through the KEYBOARD route (#124): the icon no longer activates
// anything — it opens the popup — so Alt+S is where the escalation described
// here still lives. The popup's own route is the block after this one.
describe('注入が失敗した時のツールバー表示（#269）', () => {
  let env: ReturnType<typeof setupBackground>;
  const TAB = { id: 42, url: 'https://x.com/someone/status/1' };
  const badgeText = (calls: Array<{ call: string; arg: any }>) => calls.filter((c) => c.call === 'setBadgeText').map((c) => c.arg);
  const titles = (calls: Array<{ call: string; arg: any }>) => calls.filter((c) => c.call === 'setTitle').map((c) => c.arg);

  beforeEach(() => {
    env = setupBackground();
  });

  test('注入が通れば何も出さない（正常時にノイズを足さない）', async () => {
    await env.pressShortcut(TAB);
    expect(badgeText(env.actionCalls)).toEqual([{ text: '', tabId: 42 }]);
    expect(env.createdTabs).toEqual([]);
  });

  test('失敗したら押したタブにだけ `!` が点く（他タブへ漏れない）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    await env.pressShortcut(TAB);
    expect(badgeText(env.actionCalls)).toEqual([{ text: '!', tabId: 42 }]);
    // The color comes from a generated token = there's no color literal here (#270).
    expect(env.actionCalls.filter((c) => c.call === 'setBadgeBackgroundColor')).toHaveLength(1);
    expect(env.actionCalls.every((c) => c.arg.tabId === 42)).toBe(true);
  });

  test('拡張のファイルが読めないなら「再読み込みして」と言う', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    env.setPackageReadable(false);
    await env.pressShortcut(TAB);
    expect(titles(env.actionCalls)).toEqual([{ title: 'msg:actionInjectUnreadable', tabId: 42 }]);
  });

  test('拡張が健全ならページ側の事情として言う（直すものが無いのに再読み込みを勧めない）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.pressShortcut(TAB);
    expect(titles(env.actionCalls)).toEqual([{ title: 'msg:actionInjectRefused', tabId: 42 }]);
  });

  test('1回目はバッジだけ・同じタブで2回目に初めてページが開く', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([]);
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([{ url: 'chrome-extension://test-extension-id/diag.html?issue=inject' }]);
  });

  // Measured (2026-07-31, disposable Chromium): once the extension's unpacked directory is gone,
  // chrome-extension://<id>/diag.html can't be opened — it's ERR_FILE_NOT_FOUND = **the very failure
  // that caused this Issue means we can't escape to the diagnostic page**.
  // The only surface that can still be drawn is chrome://extensions, and its "reload" is the fix itself.
  test('拡張が読めない側の2回目は chrome://extensions（診断ページはそもそも開けない）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    env.setPackageReadable(false);
    await env.pressShortcut(TAB);
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([{ url: 'chrome://extensions/?id=test-extension-id' }]);
  });

  test('別タブの1回目は別に数える（1つのタブの失敗が他タブを飛ばさない）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.pressShortcut(TAB);
    await env.pressShortcut({ id: 43, url: 'https://x.com/other/status/2' });
    expect(env.createdTabs).toEqual([]);
  });

  test('ページが遷移したら数え直す（バッジはブラウザが消すので、こちらは記憶を捨てる）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.pressShortcut(TAB);
    env.navigateTab(42);
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([]);
  });

  test('タブが閉じたら数え直す', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.pressShortcut(TAB);
    env.closeTab(42);
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([]);
  });

  test('注入が通ったら印を消し、次の失敗はまた1回目から', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.pressShortcut(TAB);
    env.allowInjection();
    await env.pressShortcut(TAB);
    expect(badgeText(env.actionCalls).at(-1)).toEqual({ text: '', tabId: 42 });
    expect(titles(env.actionCalls).at(-1)).toEqual({ title: 'msg:actionTitle', tabId: 42 });
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([]);
  });

  test('http(s) でないタブは今までどおり黙って抜ける（失敗ではない）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    await env.pressShortcut({ id: 44, url: 'chrome://newtab/' });
    expect(env.actionCalls).toEqual([]);
    expect(env.createdTabs).toEqual([]);
  });

  test('無反応だった押下は退避ログにも残る（診断ページが読み戻せる唯一の記録）', async () => {
    env.failInjection("Could not load file: 'capture.js'.");
    await env.pressShortcut(TAB);
    const stashed = [...env.localStore.values()].filter((e: any) => e.stage === 'activate' && e.phase === 'fail');
    expect(stashed).toHaveLength(1);
    expect(stashed[0].error).toBe("Could not load file: 'capture.js'.");
  });
});

// === The popup's save button (#124) ==============================================
//
// Putting a panel on the toolbar action costs chrome.action.onClicked — Chrome
// does not deliver it to an action that has a popup — so the press that used to
// inject now arrives as a message. Two things have to hold: the injection is
// still ONE implementation (the popup does not grow its own), and the popup's
// press does NOT open a repair tab behind the panel the way #269's second press
// does, because the panel itself is the surface #269 never had.
describe('ポップアップからの保存（#124）', () => {
  let env: ReturnType<typeof setupBackground>;
  const TAB = { id: 42, url: 'https://x.com/someone/status/1' };
  const badgeText = (calls: Array<{ call: string; arg: any }>) => calls.filter((c) => c.call === 'setBadgeText').map((c) => c.arg);

  beforeEach(() => {
    env = setupBackground();
  });

  // The listener would never fire (Chrome: "This event will not fire if the
  // action has a popup"), so one left registered is not harmless — it is a
  // second, dead route that reads like a live one.
  test('chrome.action.onClicked は登録しない（発火しない登録を残さない）', () => {
    expect(env.onClickedListenerCount()).toBe(0);
  });

  test('アクティブタブへ注入して ok を返す', async () => {
    const res = await env.popupSave(TAB);
    expect(res).toEqual({ ok: true });
    expect(badgeText(env.actionCalls)).toEqual([{ text: '', tabId: 42 }]);
  });

  test('注入できなかった理由を返す（ポップアップが自分で言えるようにする）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    expect(await env.popupSave(TAB)).toEqual({ ok: false, reason: 'page-refused' });
    env.setPackageReadable(false);
    expect(await env.popupSave({ id: 43, url: 'https://x.com/other/status/2' })).toEqual({ ok: false, reason: 'package-unreadable' });
  });

  test('http(s) でないタブは押す前に理由が付く', async () => {
    expect(await env.popupSave({ id: 44, url: 'chrome://newtab/' })).toEqual({ ok: false, reason: 'not-http' });
    expect(env.actionCalls).toEqual([]);
  });

  test('アクティブタブが無ければ no-tab', async () => {
    expect(await env.popupSave(null)).toEqual({ ok: false, reason: 'no-tab' });
  });

  // The mark stays — it outlives the panel, which closes — but no tab opens:
  // the panel is open, being read, and offers the same page as a button.
  test('2回目でもタブを勝手に開かない（バッジは点く）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.popupSave(TAB);
    await env.popupSave(TAB);
    expect(env.createdTabs).toEqual([]);
    expect(badgeText(env.actionCalls)).toEqual([
      { text: '!', tabId: 42 },
      { text: '!', tabId: 42 },
    ]);
  });

  // The per-tab count is shared between the two routes on purpose: what the
  // popup changes is whether a tab is opened, not what counts as a failure.
  test('Alt+S 側の意味は変わらない（同じタブの2回目は今までどおり開く）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.popupSave(TAB);
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([{ url: 'chrome-extension://test-extension-id/diag.html?issue=inject' }]);
  });
});

// === The popup's bulk-import item (#793) ==========================================
//
// Unlike the save button, this route never injects to answer — it asks the
// RESIDENT content script (already on the page for every matched site) via
// chrome.tabs.sendMessage, so a page with nothing listening (chrome://, an
// unmatched site) is read the same way as the site's own extractor saying no:
// both come back as {supported: false}, never a thrown error the panel would
// have to handle specially.
describe('ポップアップの一括取込判定（#793）', () => {
  let env: ReturnType<typeof setupBackground>;
  const TAB = { id: 42, url: 'https://x.com/i/bookmarks' };

  beforeEach(() => {
    env = setupBackground();
  });

  test('常駐スクリプトが対応ページだと答えたら supported:true', async () => {
    env.setResidentBulkAnswer({ supported: true });
    expect(await env.popupCheckBulk(TAB)).toEqual({ supported: true });
  });

  test('常駐スクリプトが非対応だと答えたら supported:false', async () => {
    env.setResidentBulkAnswer({ supported: false });
    expect(await env.popupCheckBulk(TAB)).toEqual({ supported: false });
  });

  // chrome://, 拡張の管理ページ等 — マッチする常駐スクリプトが無いタブ。
  test('待ち受けが無いタブ（chrome:// 等）は supported:false', async () => {
    env.setResidentBulkAnswer('no-listener');
    expect(await env.popupCheckBulk(TAB)).toEqual({ supported: false });
  });

  test('http(s) でないタブは常駐スクリプトへ聞きに行かず supported:false', async () => {
    env.setResidentBulkAnswer({ supported: true }); // still configured — must not be reached
    expect(await env.popupCheckBulk({ id: 44, url: 'chrome://newtab/' })).toEqual({ supported: false });
    expect(env.tabsSent.some((s) => s.message?.type === 'checkBulkCapturePage')).toBe(false);
  });

  test('アクティブタブが無ければ supported:false', async () => {
    expect(await env.popupCheckBulk(null)).toEqual({ supported: false });
  });
});

// === What the popup reads (#124) =================================================
//
// The panel shows two things the worker has to write for it, and both are
// written from the one funnel every save route passes through (admitSave):
// the ring of recent saves, and — for the version note — the fact that the
// banner has already said it once this browser session.
describe('保存履歴と版ずれ通知（#124）', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  const history = () => env.localStore.get('saveHistory.v1') as any[] | undefined;

  // Selects the nth save Port by WHAT IT SENT, like portThatSent, but the nth
  // rather than the first: this suite drives two saves in a row.
  async function answerSave(createdPorts: any[], index: number, ack: any) {
    let port: any;
    await vi.waitFor(() => {
      const found = createdPorts.filter((p: any) => p.sent.some((m: any) => m.type === 'savePost'));
      expect(found.length).toBeGreaterThan(index);
      port = found[index];
    });
    port.emitMessage(ack);
  }

  test('保存が済んだら1行残る（ホストが名乗った captureId ごと）', async () => {
    const createdPorts = env.connectAsControllablePort();
    const save = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    await answerSave(createdPorts, 0, { ok: true, captureId: 'cap-1' });
    await save.responseP;
    await vi.waitFor(() => expect(history()?.[0]).toMatchObject({ ok: true, type: 'savePost', url: UNPARSEABLE_POST_URL, captureId: 'cap-1' }));
  });

  // The list is read to answer "did it go in", so the answer "no" has to be in it.
  test('入らなかった保存も1行残る', async () => {
    env.connectAsUnavailable('Specified native messaging host not found.');
    const save = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    await save.responseP;
    await vi.waitFor(() => expect(history()?.[0]).toMatchObject({ ok: false, type: 'savePost' }));
    expect(history()?.[0].error).toBeTruthy();
  });

  // The standing place to read a skew is the popup now. The banner keeps one
  // shot per browser session so someone who never opens the popup still learns
  // of it — and exactly one, so it stops being noise on every save.
  test('版ずれの通知はブラウザセッション中1回だけ', async () => {
    const createdPorts = env.connectAsControllablePort();
    const first = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    await answerSave(createdPorts, 0, { ok: true, captureId: 'cap-1', protocolVersion: 2 });
    expect((await first.responseP).hostSkew).toBe('host-new');

    const second = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: `${UNPARSEABLE_POST_URL}-2` }, MISSKEY_SENDER);
    await answerSave(createdPorts, 1, { ok: true, captureId: 'cap-2', protocolVersion: 2 });
    expect((await second.responseP).hostSkew).toBeNull();
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

// #580: which console a failed save lands in. console.error piles up in the
// chrome://extensions error console, so the refusals that are outcomes of a
// save (an unobtainable post) must go to console.warn, while everything
// actually broken must keep reaching console.error.
describe('保存失敗の console 振り分け（#580）', () => {
  let env: ReturnType<typeof setupBackground>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    env = setupBackground();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  test('post-unavailable（直しようのない拒否）は console.warn 止まり', async () => {
    const createdPorts = env.connectAsControllablePort();
    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: false, error: 'Post unavailable: nothing was obtained for it (ageRestricted, no media)' });

    const res = await responseP;
    expect(res).toMatchObject({ ok: false, errorKind: 'post-unavailable' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test('host-missing（本当に壊れている失敗）は従来どおり console.error', async () => {
    env.connectAsUnavailable('Specified native messaging host not found.');
    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);

    const res = await responseP;
    expect(res).toMatchObject({ ok: false, errorKind: 'host-missing' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// URL bookmark intake (#195, metadata extraction absorbed by #239): the page
// right-click item. web-meta.test.ts covers chooseWebMeta/buildWebMeta
// directly, and read-meta-bundle.test.ts covers the built entrypoint against
// the real parser; what this suite adds is the wiring only those can't
// exercise — registration, the files:-injection + pageMetaExtracted-message
// round trip, and what actually reaches the native-messaging wire.
describe('URL ブックマーク保存（#195、メタデータ抽出は#239へ吸収）', () => {
  let env: ReturnType<typeof setupBackground>;
  const TAB = { id: 42, url: 'https://news.example/articles/hello' };

  beforeEach(() => {
    env = setupBackground();
  });

  test('startBackground() 起動時に contextMenus へ1件だけ登録する（page/selection/video/audio・linkとimageは含まない）', () => {
    expect(env.contextMenuCreateCalls).toEqual([{ id: 'hologram-bookmark', title: 'msg:ctxBookmark', contexts: ['page', 'selection', 'video', 'audio'] }]);
  });

  test('別のメニュー項目のクリックや http(s) でないタブは無視する', () => {
    const createdPorts = env.connectAsControllablePort();
    env.clickBookmarkMenu(TAB, { menuItemId: 'someone-elses-menu-item' });
    env.clickBookmarkMenu({ id: 43, url: 'chrome://extensions' });
    expect(createdPorts).toHaveLength(0);
  });

  test('og:image あり＝メディア1件を announced media として送り、source:bookmark・platform:null で乗る', async () => {
    const createdPorts = env.connectAsControllablePort();
    env.clickBookmarkMenu(TAB);
    // read-meta.js's report — dispatched AFTER clicking, not before: doSaveBookmark
    // registers its onMessage listener synchronously inside readPageMeta's Promise
    // executor, which runs (still synchronously) before doSaveBookmark's own first
    // await, so the listener is already live by the time clickBookmarkMenu returns.
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Hello World', description: 'A short description', author: null, published: null, siteName: 'Example Times', image: 'https://cdn.example.com/hello.jpg', url: 'https://news.example/articles/hello', metaSource: {} } }, { tab: TAB });

    const port = await portThatSent(createdPorts, 'savePost');
    expect(port.sent).toEqual([
      expect.objectContaining({
        type: 'savePost',
        captureId: expect.any(String),
        metaOk: true,
        metadata: expect.objectContaining({
          url: 'https://news.example/articles/hello',
          platform: null,
          title: 'Hello World',
          text: 'A short description',
          displayName: 'Example Times',
          source: 'bookmark',
          mediaType: 'image',
          media: [{ url: 'https://cdn.example.com/hello.jpg', alt: null, width: null, height: null }],
        }),
      }),
    ]);
  });

  test('og:image 無し＝メディア0件でも保存する（recordHoldsContent は title で通る前提— native-host 側は別スイート）', async () => {
    const createdPorts = env.connectAsControllablePort();
    env.clickBookmarkMenu(TAB);
    env.dispatch({ type: 'pageMetaExtracted', result: { title: null, description: null, author: null, published: null, siteName: null, image: null, url: null, metaSource: {} } }, { tab: TAB });

    const port = await portThatSent(createdPorts, 'savePost');
    const sent = port.sent[0];
    expect(sent.metadata.media).toEqual([]);
    expect(sent.metadata.mediaType).toBe(null);
    // メタデータがまるごと空でも URL 自体が title/displayName に落ちる（web-meta.ts の buildWebMeta）。
    expect(sent.metadata.title).toBe(TAB.url);
    expect(sent.metadata.displayName).toBe('news.example');
  });

  test('著者が取れた＝displayName が著者名になる（#239 の #195 改訂）', async () => {
    const createdPorts = env.connectAsControllablePort();
    env.clickBookmarkMenu(TAB);
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'An Article', description: null, author: { name: 'Jane Author', url: 'https://news.example/authors/jane' }, published: '2025-07-03T00:00:00Z', siteName: 'Example Times', image: null, url: TAB.url, metaSource: { author: 'jsonld' } } }, { tab: TAB });

    const port = await portThatSent(createdPorts, 'savePost');
    expect(port.sent[0].metadata).toEqual(
      expect.objectContaining({
        displayName: 'Jane Author',
        userId: 'https://news.example/authors/jane',
        screenName: null,
        date: '2025-07-03T00:00:00Z',
        metaSource: { author: 'jsonld' },
      }),
    );
  });

  test('保存成功で markSaved が走る（TL バッジ相当）＝以後 checkDuplicate が拾える', async () => {
    const createdPorts = env.connectAsControllablePort();
    env.clickBookmarkMenu(TAB);
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Hello', description: null, author: null, published: null, siteName: null, image: null, url: TAB.url, metaSource: {} } }, { tab: TAB });
    const port = await portThatSent(createdPorts, 'savePost');
    port.emitMessage({ ok: true, captureId: 'bm-capture-id', file: 'bm-capture-id.jpg', media: [] });

    // markSaved runs a few microtask hops after emitMessage (inside
    // doSaveBookmark's own await chain, past bumpRecentSave's storage.session
    // round trip) — one macrotask tick flushes all of them, so this yields to the
    // event loop rather than waiting for real time to pass. It is not vi.waitFor
    // because there is nothing to retry: a premature dispatch would fall through
    // to queryBridge on a cache miss and open a SECOND native connection this
    // test never answers, hanging rather than merely polling again.
    // biome-ignore lint/plugin: 0ms = yield one macrotask, not a timed wait
    await new Promise((r) => setTimeout(r, 0));
    const { responseP } = env.dispatch({ type: 'checkDuplicate', url: TAB.url, platform: null, imageUrls: [] });
    await expect(responseP).resolves.toMatchObject({ ok: true, duplicate: true, captureId: 'bm-capture-id' });
  });
});

// #203: the retry queue. save-queue.ts's own suite (scripts/save-queue.test.ts)
// covers stash/eviction/degrade/idempotency/serial-stop directly; what this
// block checks is the WIRING — that background.ts's bridgeSend actually tags
// an unreachable rejection, that the stash lands in chrome.storage.local
// through the real imageDragged route, and that a resend genuinely happens
// end-to-end through one of the four triggers (the checkSaved badge query).
describe('退避キュー（#203）', () => {
  let env: ReturnType<typeof setupBackground>;
  const DRAG = { type: 'imageDragged', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, imageUrls: ['https://misskey.example/files/a.png'] };

  beforeEach(() => {
    env = setupBackground();
  });

  test('imageDragged: ホスト未導入（connectNative 同期 throw）→ queued:true でキューに1件積まれる', async () => {
    env.connectAsUnavailable('Specified native messaging host not found.');

    const { responseP } = env.dispatch(DRAG, MISSKEY_SENDER);
    const result = await responseP;

    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe('host-missing');
    expect(result.queued).toBe(true);
    expect([...env.localStore.keys()].filter((k) => k.startsWith('savequeue_'))).toHaveLength(1);
  });

  test('ホストが答えた上での拒否（post unavailable）は queued が付かない（退避しない）', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch(DRAG, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'saveDragged')).emitMessage({ ok: false, error: 'Post unavailable: deleted' });
    const result = await responseP;

    expect(result.errorKind).toBe('post-unavailable');
    expect(result.queued).toBeUndefined();
    expect([...env.localStore.keys()].filter((k) => k.startsWith('savequeue_'))).toHaveLength(0);
  });

  // The end-to-end shape of trigger 4 (#203 design comment #4): the saved-badge's
  // own query port answering is what wakes the sweep, without any dedicated
  // polling of its own. Exercises stash → idempotency pre-check → resend →
  // dequeue through the SAME background.ts wiring a real Chrome session uses.
  test('checkSaved のクエリ成功が引き金になり、退避済みの保存が再送されて消える', async () => {
    // 1) A save fails while the host cannot be reached at all, and is stashed.
    env.connectAsUnavailable('Specified native messaging host not found.');
    const failed = env.dispatch(DRAG, MISSKEY_SENDER);
    const failResult = await failed.responseP;
    expect(failResult.queued).toBe(true);
    expect([...env.localStore.keys()].some((k) => k.startsWith('savequeue_'))).toBe(true);

    // 2) The host becomes reachable.
    const createdPorts = env.connectAsControllablePort();

    // 3) The timeline's badge asks about an unrelated post — its query port
    //    answering is trigger 4.
    const check = env.dispatch({ type: 'checkSaved', urls: ['https://misskey.example/notes/other'] }, {});
    const queryPort = await portThatSent(createdPorts, 'query');
    const badgeReq = queryPort.sent.find((m: any) => m.type === 'query');
    queryPort.emitMessage({ id: badgeReq.id, ok: true, results: {} });
    await check.responseP;

    // 4) The sweep's own idempotency pre-check (#34) reuses the SAME
    //    persistent query port with a second 'query' message.
    await vi.waitFor(() => expect(queryPort.sent.filter((m: any) => m.type === 'query').length).toBe(2));
    const idempotencyReq = queryPort.sent.filter((m: any) => m.type === 'query')[1];
    queryPort.emitMessage({ id: idempotencyReq.id, ok: true, results: {} }); // not landed yet

    // 5) Only now does the resend open its own one-shot port and succeed.
    const resendPort = await portThatSent(createdPorts, 'saveDragged');
    resendPort.emitMessage({ ok: true, file: 'resent.jpg', media: [] });

    await vi.waitFor(() => expect([...env.localStore.keys()].some((k) => k.startsWith('savequeue_'))).toBe(false));
  });
});
