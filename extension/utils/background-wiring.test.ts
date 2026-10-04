// extension/utils/background.ts の Chrome API 配線を、現在残る入口だけで検証する。
// 対象は投稿保存、保存済み照会、右クリックからの一括取り込みと画像保存、
// native host へ届かなかった右クリック保存の退避である。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startBackground } from './background';
import { VERIFICATION_TAB_CAPABILITY, VERIFICATION_TAB_CAPABILITY_KEY } from './verification-tabs.ts';

vi.mock('./local-build-reload.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./local-build-reload.ts')>()),
  EXT_BUILD_ID: 'background-wiring-build',
}));

function createPortController(setLastError: (message?: string) => void, onPost?: (message: any) => void) {
  const messageListeners: Array<(message: any) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const sent: any[] = [];
  let disconnected = false;
  const port = {
    postMessage(message: any) {
      if (disconnected) throw new Error('Attempting to postMessage on a disconnected port');
      sent.push(message);
      onPost?.(message);
    },
    disconnect() {
      disconnected = true;
    },
    onMessage: { addListener: (listener: (message: any) => void) => messageListeners.push(listener) },
    onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
  };
  return {
    port,
    sent,
    emitMessage(message: any) {
      for (const listener of messageListeners) listener(message);
    },
    emitDisconnect(message?: string) {
      disconnected = true;
      setLastError(message);
      for (const listener of disconnectListeners) listener();
      setLastError(undefined);
    },
  };
}

function setupBackground(failRegistration = false) {
  const capabilityDuringRegistration: unknown[] = [];
  const messageListeners: Array<(message: any, sender: any, sendResponse: (response: any) => void) => boolean> = [];
  const commandListeners: Array<(command: string) => Promise<void> | void> = [];
  const contextMenuListeners: Array<(info: any, tab: any) => void> = [];
  const contextMenuCreateCalls: any[] = [];
  const contextMenuUpdateCalls: any[] = [];
  const actionClickListeners: Array<(tab: any) => void> = [];
  const tabActivatedListeners: Array<(info: { tabId: number; windowId: number }) => void> = [];
  const tabUpdatedListeners: Array<(id: number, change: any, tab: any) => void> = [];
  const windowFocusListeners: Array<() => void> = [];
  const ports: ReturnType<typeof createPortController>[] = [];
  const tabsSent: Array<{ tabId: number; message: any }> = [];
  const executed: any[] = [];
  const actionCalls: Array<{ method: string; details: any }> = [];
  const localStore = new Map<string, any>();
  const sessionStore = new Map<string, any>();
  let activeTab: any = null;
  let selectedMediaContext: any = null;
  let fileScriptError: Error | null = null;
  let runFileScript: ((details: any) => Promise<void> | void) | null = null;
  let reloadCalls = 0;
  let tabMessage: (tabId: number, message: any) => Promise<any> = async () => undefined;
  const executeScript: (details: any) => Promise<any> = async (details) => {
    executed.push(details);
    if (details.files && fileScriptError) throw fileScriptError;
    if (details.files) await runFileScript?.(details);
    return details.func ? [{ result: selectedMediaContext }] : [];
  };
  let connectNative: () => any = () => {
    throw new Error('Specified native messaging host not found.');
  };
  let failNextStorageGet = false;

  const chromeStub: any = {
    alarms: { create: async () => {}, onAlarm: { addListener: () => {} } },
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      onMessage: {
        addListener(listener: any) {
          capabilityDuringRegistration.push((globalThis as any)[VERIFICATION_TAB_CAPABILITY_KEY]);
          if (failRegistration) throw new Error('registration failed');
          messageListeners.push(listener);
        },
        removeListener(listener: any) {
          const index = messageListeners.indexOf(listener);
          if (index >= 0) messageListeners[index] = () => false;
        },
      },
      connectNative: () => connectNative(),
      getURL: (file: string) => `chrome-extension://test-extension-id/${file}`,
      reload: () => reloadCalls++,
    },
    i18n: { getMessage: (key: string) => `msg:${key}` },
    contextMenus: {
      removeAll: (callback?: () => void) => callback?.(),
      create: (details: any, callback?: () => void) => {
        contextMenuCreateCalls.push(details);
        callback?.();
      },
      update: (_id: string, details: any, callback?: () => void) => {
        contextMenuUpdateCalls.push(details);
        callback?.();
      },
      onClicked: { addListener: (listener: any) => contextMenuListeners.push(listener) },
    },
    tabs: {
      sendMessage: (tabId: number, message: any) => {
        tabsSent.push({ tabId, message });
        return tabMessage(tabId, message);
      },
      get: async () => activeTab,
      query: async () => (activeTab ? [activeTab] : []),
      create: async () => ({ id: 999 }),
      onActivated: { addListener: (listener: any) => tabActivatedListeners.push(listener) },
      onUpdated: { addListener: (listener: any) => tabUpdatedListeners.push(listener) },
      onRemoved: { addListener: () => {} },
    },
    windows: { onFocusChanged: { addListener: (listener: any) => windowFocusListeners.push(listener) } },
    scripting: { executeScript: (details: any) => executeScript(details) },
    action: {
      onClicked: { addListener: (listener: any) => actionClickListeners.push(listener) },
      setBadgeText: async (details: any) => actionCalls.push({ method: 'setBadgeText', details }),
      setBadgeBackgroundColor: async (details: any) => actionCalls.push({ method: 'setBadgeBackgroundColor', details }),
      setBadgeTextColor: async (details: any) => actionCalls.push({ method: 'setBadgeTextColor', details }),
      setTitle: async (details: any) => actionCalls.push({ method: 'setTitle', details }),
    },
    commands: { onCommand: { addListener: (listener: any) => commandListeners.push(listener) } },
    storage: {
      local: {
        get(keys: any, callback?: (result: any) => void) {
          let result: Record<string, unknown>;
          if (keys == null) result = Object.fromEntries(localStore);
          else if (typeof keys === 'string') result = localStore.has(keys) ? { [keys]: localStore.get(keys) } : {};
          else result = Object.fromEntries((keys as string[]).filter((key) => localStore.has(key)).map((key) => [key, localStore.get(key)]));
          if (callback) {
            if (failNextStorageGet) chromeStub.runtime.lastError = { message: 'storage unavailable' };
            callback(result);
            chromeStub.runtime.lastError = undefined;
            failNextStorageGet = false;
          } else return Promise.resolve(result);
        },
        set(items: Record<string, unknown>, callback?: () => void) {
          for (const [key, value] of Object.entries(items)) localStore.set(key, value);
          if (callback) callback();
          else return Promise.resolve();
        },
        remove(keys: string | string[], callback?: () => void) {
          for (const key of Array.isArray(keys) ? keys : [keys]) localStore.delete(key);
          if (callback) callback();
          else return Promise.resolve();
        },
      },
      session: {
        get: async (key: string) => (sessionStore.has(key) ? { [key]: sessionStore.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) sessionStore.set(key, value);
        },
      },
    },
  };

  (globalThis as any).chrome = chromeStub;
  startBackground();

  function dispatch(message: any, sender: any = {}) {
    const current = message?.type === 'savePost' && message.saveId === undefined ? { ...message, saveId: 'trace-1' } : message;
    let respond!: (response: any) => void;
    const responseP = new Promise<any>((resolve) => {
      respond = resolve;
    });
    const returns = messageListeners.map((listener) => listener(current, sender, respond));
    return { returns, responseP };
  }

  return {
    capabilityDuringRegistration,
    actionClickListeners,
    actionCalls,
    commandListeners,
    contextMenuCreateCalls,
    contextMenuUpdateCalls,
    dispatch,
    executed,
    localStore,
    ports,
    get reloadCalls() {
      return reloadCalls;
    },
    tabsSent,
    clickMedia(tab: any, srcUrl: string, menuItemId = 'hologram-save', mediaType: 'image' | 'video' = 'image') {
      for (const listener of contextMenuListeners) listener({ menuItemId, srcUrl, mediaType }, tab);
    },
    clickMenu(tab: any, menuItemId: string) {
      for (const listener of contextMenuListeners) listener({ menuItemId }, tab);
    },
    async command(command: string, tab: any) {
      activeTab = tab;
      await Promise.all(commandListeners.map((listener) => listener(command)));
    },
    activateTab(tab: any) {
      activeTab = tab;
      for (const listener of tabActivatedListeners) listener({ tabId: tab.id, windowId: 1 });
    },
    updateTab(tab: any) {
      for (const listener of tabUpdatedListeners) listener(tab.id, { url: tab.url }, tab);
    },
    focusWindow(tab: any) {
      activeTab = tab;
      for (const listener of windowFocusListeners) listener();
    },
    setTabMessage(handler: (tabId: number, message: any) => Promise<any>) {
      tabMessage = handler;
    },
    setSelectedMediaContext(context: any) {
      selectedMediaContext = context;
    },
    failFileScript(error: Error) {
      fileScriptError = error;
    },
    setFileScript(handler: (details: any) => Promise<void> | void) {
      runFileScript = handler;
    },
    failNextLocalGet() {
      failNextStorageGet = true;
    },
    connectAsUnavailable(message = 'Specified native messaging host not found.') {
      connectNative = () => {
        throw new Error(message);
      };
    },
    connectAsControllablePort(response: Record<string, unknown> | null = { ok: true }, onLog?: (entry: any) => void) {
      connectNative = () => {
        let controller!: ReturnType<typeof createPortController>;
        controller = createPortController(
          (message) => {
            chromeStub.runtime.lastError = message ? { message } : undefined;
          },
          (message) => {
            if (message?.type === 'query' && message.requestIds?.length) queueMicrotask(() => controller.emitMessage({ ok: true, id: message.id, protocolVersion: 6, saveFolder: 'C:/library', results: {}, requests: {} }));
            if (message?.type === 'log') {
              onLog?.(message.entry);
              if (response) queueMicrotask(() => controller.emitMessage(response));
            }
          },
        );
        ports.push(controller);
        return controller.port;
      };
      return ports;
    },
  };
}

const POST_URL = 'https://x.com/not-a-known-post-shape';
const X_SENDER = { tab: { id: 7, url: 'https://x.com/home' } };

test('保存ルーティングの全 listener 登録が終わるまで検証能力の印を出さない', () => {
  const env = setupBackground();
  expect(env.capabilityDuringRegistration.length).toBeGreaterThan(0);
  expect(env.capabilityDuringRegistration.every((value) => value === undefined)).toBe(true);
  expect((globalThis as any)[VERIFICATION_TAB_CAPABILITY_KEY]).toBe(VERIFICATION_TAB_CAPABILITY);
});

test('listener 登録の失敗では以前の能力の印も残さない', () => {
  (globalThis as any)[VERIFICATION_TAB_CAPABILITY_KEY] = VERIFICATION_TAB_CAPABILITY;
  expect(() => setupBackground(true)).toThrow('registration failed');
  expect((globalThis as any)[VERIFICATION_TAB_CAPABILITY_KEY]).toBeUndefined();
});

async function portThatSent(ports: ReturnType<typeof createPortController>[], type: string) {
  let found: ReturnType<typeof createPortController> | undefined;
  await vi.waitFor(() => {
    found = ports.find((port) => port.sent.some((message) => message?.type === type));
    expect(found).toBeTruthy();
  });
  return found!;
}

async function loggedEntry(ports: ReturnType<typeof createPortController>[], predicate: (entry: any) => boolean) {
  let found: any;
  await vi.waitFor(
    () => {
      found = ports
        .flatMap((port) => port.sent)
        .filter((message) => message?.type === 'log')
        .map((message) => message.entry)
        .find(predicate);
      expect(found).toBeTruthy();
    },
    { timeout: 2500 },
  );
  return found;
}

describe('残した起動経路', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  test('先行診断がtimeout中でも注入を待たせずactivateとbulkのFIFO順を保つ', async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      env.connectAsControllablePort(null, (entry) => order.push(`${entry.stage}/${entry.phase}`));
      env.dispatch({ type: 'logCapture', entry: { stage: 'unknown', phase: 'begin' } });
      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual(['unknown/begin']);

      env.setFileScript(() => {
        env.dispatch({ type: 'logCapture', entry: { stage: 'bulk', phase: 'begin', platform: 'x', site: 'x.com', category: 'bulk-capture', message: 'Bulk capture started' } }, { tab: { id: 42, url: 'https://x.com/i/bookmarks?token=token0#token0' }, frameId: 0 });
      });
      env.clickMenu({ id: 42, url: 'https://x.com/i/bookmarks?token=token0#token0' }, 'hologram-save');
      await vi.advanceTimersByTimeAsync(0);

      // 先行 batch は無応答のままだが、executeScript は timeout を待たない。
      expect(env.executed).toEqual([{ target: { tabId: 42 }, files: ['bulk.js'] }]);
      expect(order).toEqual(['unknown/begin']);

      await vi.advanceTimersByTimeAsync(5000);
      expect(order).toEqual(['unknown/begin', 'activate/begin', 'bulk/begin']);
    } finally {
      vi.useRealTimers();
    }
  });

  test('ツールバーとキー操作を登録せず、保存済み一覧の右クリックから bulk.js を注入する', async () => {
    expect(env.actionClickListeners).toHaveLength(0);
    expect(env.commandListeners).toHaveLength(0);
    env.setTabMessage(async () => ({ hoverSave: true }));
    env.activateTab({ id: 42 });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)?.contexts).toEqual(['all']));
    expect(env.contextMenuUpdateCalls).toContainEqual({
      title: 'msg:ctxImportSaved',
      contexts: ['all'],
      documentUrlPatterns: [
        'https://x.com/i/bookmarks*',
        'https://x.com/i/history',
        'https://x.com/i/history/',
        'https://twitter.com/i/bookmarks*',
        'https://twitter.com/i/history',
        'https://twitter.com/i/history/',
        'https://bsky.app/saved*',
        'https://www.pixiv.net/users/*/bookmarks/artworks*',
        'https://www.pixiv.net/*/users/*/bookmarks/artworks*',
        'https://pixiv.net/users/*/bookmarks/artworks*',
        'https://pixiv.net/*/users/*/bookmarks/artworks*',
      ],
    });
    env.clickMenu({ id: 42, url: 'https://x.com/i/history' }, 'hologram-save');
    await vi.waitFor(() => expect(env.executed).toEqual([{ target: { tabId: 42 }, files: ['bulk.js'] }]));
  });

  test('activate入口を注入先のbulk beginより先に記録し、build通知でも注入中はreloadしない', async () => {
    const order: string[] = [];
    env.connectAsControllablePort({ ok: true, extBuild: 'next-build' }, (entry) => order.push(`${entry.stage}/${entry.phase}`));
    env.setFileScript(() => {
      env.dispatch({ type: 'logCapture', entry: { stage: 'bulk', phase: 'begin', platform: 'x', site: 'x.com', category: 'bulk-capture', message: 'Bulk capture started' } }, { tab: { id: 42, url: 'https://x.com/i/bookmarks?token=token0#token0' }, frameId: 0 });
      order.push('fixture-ran');
    });

    env.clickMenu({ id: 42, url: 'https://x.com/i/bookmarks?token=token0#token0' }, 'hologram-save');

    await vi.waitFor(() => expect(order).toContain('fixture-ran'));
    const bulkEntry = await loggedEntry(env.ports, (entry) => entry.stage === 'bulk' && entry.phase === 'begin');
    expect(order.filter((event) => event.includes('/')).slice(0, 2)).toEqual(['activate/begin', 'bulk/begin']);
    expect(JSON.stringify(bulkEntry)).not.toContain('token0');
    expect(bulkEntry).not.toHaveProperty('url');
    expect(env.reloadCalls).toBe(0);
    expect(env.executed).toEqual([{ target: { tabId: 42 }, files: ['bulk.js'] }]);
  });

  test('bulk beginのlocal診断にも送信元URLの秘密を残さない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    env.connectAsUnavailable();

    env.dispatch({ type: 'logCapture', entry: { stage: 'bulk', phase: 'begin', platform: 'x', site: 'x.com', category: 'bulk-capture', message: 'Bulk capture started' } }, { tab: { id: 42, url: 'https://alice:token0@x.com/i/bookmarks?token=token0#token0' }, frameId: 0 });

    await vi.waitFor(() => expect([...env.localStore.keys()].some((key) => key.startsWith('diaglog_'))).toBe(true));
    const localEntry = env.localStore.get([...env.localStore.keys()].find((key) => key.startsWith('diaglog_'))!);
    expect(localEntry).toMatchObject({ stage: 'bulk', phase: 'begin', platform: 'x', site: 'x.com', category: 'bulk-capture', message: 'Bulk capture started' });
    expect(JSON.stringify(localEntry)).not.toContain('token0');
    expect(localEntry).not.toHaveProperty('url');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('注入失敗の診断はURL由来の秘密をnativeとlocalのどちらにも残さない', async () => {
    const secret = 'token0';
    const pageUrl = `https://alice:${secret}@x.com/i/bookmarks?access_token=${secret}#${secret}`;
    const quotedFailure = new Error(`Cannot access contents of url "${pageUrl}". Extension manifest must request permission.`);
    const ports = env.connectAsControllablePort({ ok: true, extBuild: 'next-build' });
    env.failFileScript(quotedFailure);

    env.clickMenu({ id: 42, url: pageUrl }, 'hologram-save');

    const nativeEntry = await loggedEntry(ports, (entry) => entry.stage === 'activate' && entry.phase === 'fail');
    await vi.waitFor(() => expect([...env.localStore.keys()].some((key) => key.startsWith('diaglog_'))).toBe(true));
    const localEntry = env.localStore.get([...env.localStore.keys()].find((key) => key.startsWith('diaglog_'))!);
    const expected = {
      stage: 'activate',
      phase: 'fail',
      site: 'x.com',
      category: 'bulk-injection',
      message: 'Content script injection failed',
    };

    expect(nativeEntry).toMatchObject(expected);
    expect(localEntry).toMatchObject(expected);
    expect(JSON.stringify(nativeEntry)).not.toContain(secret);
    expect(JSON.stringify(localEntry)).not.toContain(secret);
    expect(nativeEntry).not.toHaveProperty('url');
    expect(nativeEntry).not.toHaveProperty('error');
    expect(localEntry).not.toHaveProperty('url');
    expect(localEntry).not.toHaveProperty('error');
    await vi.waitFor(() => expect(env.actionCalls).toContainEqual({ method: 'setBadgeText', details: { text: '!', tabId: 42 } }));
    // build 通知を受けても注入中には reload せず、失敗処理が capture gate を
    // 解放した後の静穏期間にだけ追従する。
    await vi.waitFor(() => expect(env.reloadCalls).toBe(1), { timeout: 5000 });
  });
});

describe('投稿保存と保存済み照会', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  test('投稿保存は送信元タブを必須にする', async () => {
    const { returns, responseP } = env.dispatch({ type: 'savePost', platform: 'x', postUrl: POST_URL });
    expect(returns).not.toContain(true);
    await expect(responseP).resolves.toEqual({ ok: false, error: 'Missing tab context' });
  });

  test('投稿保存を savePost として native host へ送り、応答を返す', async () => {
    const ports = env.connectAsControllablePort();
    const save = env.dispatch({ type: 'savePost', platform: 'x', postUrl: POST_URL, domMeta: { text: 'DOM text' } }, X_SENDER);
    expect(save.returns).toContain(true);
    const port = await portThatSent(ports, 'savePost');
    expect(port.sent[0]).toMatchObject({ type: 'savePost', saveId: 'trace-1', metaOk: false, metadata: { url: POST_URL, text: null } });
    port.emitMessage({ ok: true, captureId: 'saved-id', media: [] });
    await expect(save.responseP).resolves.toMatchObject({ ok: true, captureId: 'saved-id', metaOk: false, domFilled: [] });
  });

  test('保存済み照会は query ポートで応答を対応付ける', async () => {
    const ports = env.connectAsControllablePort();
    const query = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1'] });
    const port = await portThatSent(ports, 'query');
    const request = port.sent[0];
    port.emitMessage({ id: request.id, ok: true, results: { 'https://x.com/a/status/1': { id: 'one', media: [] } } });
    await expect(query.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/a/status/1': { id: 'one', media: [] } } });
  });
});

describe('右クリックメディア保存', () => {
  let env: ReturnType<typeof setupBackground>;
  const TAB = { id: 42, url: 'https://news.example/articles/hello' };
  const SRC = 'https://cdn.example.com/selected.jpg';

  beforeEach(() => {
    env = setupBackground();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('メディア用メニューを画像と動画に登録する', () => {
    expect(env.contextMenuCreateCalls).toHaveLength(1);
    expect(env.contextMenuCreateCalls).toContainEqual({ id: 'hologram-save', title: 'msg:ctxSaveMedia', contexts: ['image', 'video'] });
  });

  test('対応サイトでは画像保存を隠し、対応サイト外では表示する', async () => {
    env.setTabMessage(async (id) => (id === 42 ? { hoverSave: true } : undefined));
    env.activateTab({ id: 42 });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxImportSaved', contexts: ['all'] }));
    env.activateTab({ id: 43, url: 'https://news.example/articles/hello' });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxSaveMedia', contexts: ['image', 'video'] }));
  });

  test('背景タブの更新で選択中のXの画像保存を表示しない', async () => {
    env.setTabMessage(async (id) => (id === 42 ? { hoverSave: true } : undefined));
    env.activateTab({ id: 42 });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxImportSaved', contexts: ['all'] }));
    env.contextMenuUpdateCalls.length = 0;
    env.updateTab({ id: 43, url: 'https://news.example/', active: false });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxImportSaved', contexts: ['all'] }));
  });

  test('ウィンドウを切り替えると選択中のページに表示を合わせる', async () => {
    env.setTabMessage(async (id) => (id === 42 ? { hoverSave: true } : undefined));
    env.focusWindow({ id: 43, url: 'https://news.example/' });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxSaveMedia', contexts: ['image', 'video'] }));
    env.focusWindow({ id: 42 });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxImportSaved', contexts: ['all'] }));
  });

  test('常駐スクリプトの起動通知でURLなしのタブを再判定する', async () => {
    env.activateTab({ id: 42 });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxSaveMedia', contexts: ['image', 'video'] }));
    env.setTabMessage(async () => ({ hoverSave: true }));
    env.dispatch({ type: 'hoverSaveReady' }, { tab: { id: 42 }, frameId: 0 });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxImportSaved', contexts: ['all'] }));
  });

  test('応答する常駐スクリプトがないタブでは画像保存を表示する', async () => {
    env.setTabMessage(async () => {
      throw new Error('Receiving end does not exist');
    });
    env.activateTab({ id: 43 });
    await vi.waitFor(() => expect(env.contextMenuUpdateCalls.at(-1)).toMatchObject({ title: 'msg:ctxSaveMedia', contexts: ['image', 'video'] }));
  });

  test('別項目、非 HTTP ページ、画像でない URL は無視する', () => {
    const ports = env.connectAsControllablePort();
    env.clickMedia(TAB, SRC, 'other-menu');
    env.clickMedia({ id: 43, url: 'chrome://extensions' }, SRC);
    env.clickMedia(TAB, 'data:image/png;base64,AA');
    expect(ports).toHaveLength(0);
  });

  test('表示状態が古くても対応サイトでは画像単体を保存しない', () => {
    const ports = env.connectAsControllablePort();
    env.clickMedia({ id: 42, url: 'https://x.com/home' }, 'https://pbs.twimg.com/media/example.jpg');
    expect(ports).toHaveLength(0);
  });

  test('対応外サイトではページ情報を読み、右クリックした画像だけを saveMedia へ送る', async () => {
    const ports = env.connectAsControllablePort();
    env.setTabMessage(async () => ({ context: null }));
    env.clickMedia(TAB, SRC);
    await vi.waitFor(() => expect(env.executed).toContainEqual({ target: { tabId: 42 }, files: ['read-meta.js'] }));
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Hello', description: 'Article', author: null, published: null, siteName: 'Example', image: 'https://cdn.example.com/og.jpg', url: TAB.url, metaSource: {} } }, { tab: TAB });
    const port = await portThatSent(ports, 'saveMedia');
    expect(port.sent[0]).toMatchObject({ type: 'saveMedia', expectedSaveFolder: 'C:/library', mediaUrl: SRC, mediaReferer: TAB.url, mediaType: 'image', metadata: { url: TAB.url, title: 'Hello', source: 'web', mediaType: 'image', media: [] } });
    expect([...env.localStore.values()].find((entry) => entry?.payload?.type === 'saveMedia')).toMatchObject({ payload: { expectedSaveFolder: 'C:/library' }, outcomeUnknown: true, attemptedAt: expect.any(Number) });
    port.emitMessage({ ok: true, captureId: 'right-click-id', media: [SRC] });
    await vi.waitFor(() => expect(env.tabsSent.some(({ message }) => message?.type === 'savedUpdate')).toBe(true));
    await vi.waitFor(() => expect(env.tabsSent.some(({ message }) => message?.type === 'webSaveNotice' && message.result?.metaOk === true)).toBe(true));
  });

  test('native成功後のqueue cleanup失敗は成功通知を失敗へ変えない', async () => {
    const ports = env.connectAsControllablePort();
    env.setTabMessage(async () => ({ context: null }));
    env.clickMedia(TAB, SRC);
    await vi.waitFor(() => expect(env.executed).toContainEqual({ target: { tabId: 42 }, files: ['read-meta.js'] }));
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Hello', description: null, author: null, published: null, siteName: null, image: null, url: TAB.url, metaSource: {} } }, { tab: TAB });
    const port = await portThatSent(ports, 'saveMedia');
    env.failNextLocalGet();
    port.emitMessage({ ok: true, captureId: 'saved-after-cleanup-error', media: [SRC] });
    await vi.waitFor(() => expect(env.tabsSent.some(({ message }) => message?.type === 'webSaveNotice' && message.result?.ok === true)).toBe(true));
  });

  test('右クリックの一部保存は通知し、同じタブの発行済みトークンだけ再試行できる', async () => {
    const ports = env.connectAsControllablePort();
    env.clickMedia(TAB, SRC);
    await vi.waitFor(() => expect(env.executed).toContainEqual({ target: { tabId: 42 }, files: ['read-meta.js'] }));
    env.dispatch({ type: 'pageMetaExtracted', result: { title: null, description: null, author: null, published: null, siteName: null, image: null, url: TAB.url, metaSource: {}, acquisitionError: 'invalidResponse' } }, { tab: TAB });
    const port = await portThatSent(ports, 'saveMedia');
    port.emitMessage({ ok: true, captureId: '1700000000800-ab01', media: [SRC] });
    await vi.waitFor(() => expect(env.tabsSent.some(({ message }) => message?.type === 'webSaveNotice' && message.result?.metaOk === false)).toBe(true));
    const notice = env.tabsSent.find(({ message }) => message?.type === 'webSaveNotice' && message.result)?.message;
    expect(notice.result.savedContent.media).toBe(1);
    const denied = env.dispatch({ type: 'retryWebSave', token: notice.token }, { tab: { ...TAB, id: 99 }, frameId: 0 });
    expect(await denied.responseP).toMatchObject({ ok: false });
    env.dispatch({ type: 'retryWebSave', token: notice.token }, { tab: TAB, frameId: 0 });
    await vi.waitFor(() => expect(env.executed.filter((row) => row.files?.includes('read-meta.js'))).toHaveLength(2));
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Recovered', description: null, author: null, published: null, siteName: null, image: null, url: TAB.url, metaSource: {} } }, { tab: TAB });
    await vi.waitFor(() => expect(ports.flatMap((p) => p.sent).filter((row) => row.type === 'saveMedia')).toHaveLength(2));
    expect(ports.flatMap((p) => p.sent).filter((row) => row.type === 'saveMedia')[1].metadata.retryOf).toBe('1700000000800-ab01');
  });

  test('対応外サイトでは右クリックした動画を動画として saveMedia へ送る', async () => {
    const videoUrl = 'https://cdn.example.com/selected.mp4';
    const ports = env.connectAsControllablePort();
    env.setTabMessage(async () => ({ context: null }));
    env.clickMedia(TAB, videoUrl, 'hologram-save', 'video');
    await vi.waitFor(() => expect(env.executed).toContainEqual({ target: { tabId: 42 }, files: ['read-meta.js'] }));
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Video', description: null, author: null, published: null, siteName: 'Example', image: null, url: TAB.url, metaSource: {} } }, { tab: TAB });
    const port = await portThatSent(ports, 'saveMedia');
    expect(port.sent[0]).toMatchObject({ type: 'saveMedia', mediaUrl: videoUrl, mediaReferer: TAB.url, mediaType: 'video', metadata: { url: TAB.url, title: 'Video', source: 'web', mediaType: 'video', media: [] } });
  });

  test('選んだ画像の alt を取得できる場合だけ保存する', async () => {
    const ports = env.connectAsControllablePort();
    env.setSelectedMediaContext({ alt: '作品の説明' });
    env.setTabMessage(async () => ({ context: null }));
    env.clickMedia(TAB, SRC);
    await vi.waitFor(() => expect(env.executed.some((details) => typeof details.func === 'function' && details.args?.[0] === SRC)).toBe(true));
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Example', description: null, author: null, published: null, siteName: 'Example', image: null, url: TAB.url, metaSource: {} } }, { tab: TAB });
    const port = await portThatSent(ports, 'saveMedia');
    expect(port.sent[0]).toMatchObject({ mediaAlt: '作品の説明', metadata: { url: TAB.url } });
  });

  test('ページ情報の注入に失敗しても媒体と出典ページ URL は保存する', async () => {
    const ports = env.connectAsControllablePort();
    env.failFileScript(new Error('page refused injection'));
    env.clickMedia({ ...TAB, title: 'Fallback title' }, SRC);
    const port = await portThatSent(ports, 'saveMedia');
    expect(port.sent[0]).toMatchObject({
      mediaUrl: SRC,
      mediaAlt: null,
      metaOk: false,
      metadata: { url: TAB.url, title: 'Fallback title', source: 'web', media: [], saveIncomplete: true },
    });
  });

  test('host に届かない右クリック保存は再送キューへ退避する', async () => {
    env.connectAsUnavailable();
    env.setTabMessage(async () => ({ context: null }));
    env.clickMedia(TAB, SRC);
    await vi.waitFor(() => expect(env.executed).toContainEqual({ target: { tabId: 42 }, files: ['read-meta.js'] }));
    env.dispatch({ type: 'pageMetaExtracted', result: { title: 'Hello', description: null, author: null, published: null, siteName: null, image: null, url: TAB.url, metaSource: {} } }, { tab: TAB });
    await vi.waitFor(() => expect([...env.localStore.keys()].filter((key) => key.startsWith('savequeue_'))).toHaveLength(1));
    const queued: any = env.localStore.get([...env.localStore.keys()].find((key) => key.startsWith('savequeue_'))!);
    expect(queued.payload).toMatchObject({ type: 'saveMedia', mediaUrl: SRC });
  });
});
