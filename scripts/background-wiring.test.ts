// extension/utils/background.ts の chrome API の配線（メッセージ / ポート）のテスト。
// chrome.* に依存しない純関数は #127 がすでに切り出しているので、このファイルが受け持つのは
// 残った配線＝
//   - chrome.runtime.onMessage の振り分け（送信元の番人・型ごとの排他・非同期の sendResponse）
//   - bridgeSend / queryBridge が chrome.runtime.connectNative の返す Port と話すときに通る経路
//     （タイムアウト・切断・エラー応答・普通の応答）
//   - ホストへ届かないときの診断ログの退避（stashLogLocally のリングバッファと間引き）
// これらを自前の chrome スタブで確かめる。
//
// スタブの方針（#128 の決定コメント）: ライブラリを使わない。connectNative を働く Port として
// モックできる既存のライブラリ（fake-browser / jest-chrome / sinon-chrome など）が無かったので
// （どれも実装していない）、このファイルは手書きのスタブだけに頼る。Port の参考実装は
// tab-stash の MockPort だが、このスイートに要るのはテストのコード自身が「ホスト側」という
// 片側を演じることだけで、双方向の対を組むことはない（参考実装から引き継いだ性質は、切断後に
// postMessage が例外を投げる1点だけ）。
//
// bridgeSend と queryBridge は startBackground() のクロージャの中に在って外から直接は呼べない。
// だから onMessage 経由で savePost / checkSaved のメッセージを実際に送って駆動する。
// fetchPostMetadata は実装（extension/utils/extractor/）をそのまま使うが、通信に出ないように
// postUrl はどのプラットフォームの URL パターンにも一致しない文字列にしてある（parsePostUrl が
// null を返すので、fetchPostMetadata は fetch を呼ばず空のレコードで即座に解決する）。

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { startBackground } from '../extension/utils/background';

// --- 手書きの chrome スタブ ------------------------------------------------------------

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
    // lastErrorMessage: undefined ならホスト側が正常に切断したという意味（chrome.runtime.lastError は立たない）
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
  // #269 の画面（ツールバーのアクション・注入・タブの生き死に）。既定は「注入は成功する／
  // 拡張機能のファイルは読める」＝これを上書きしたテストだけが失敗の経路へ入る。
  const actionCalls: Array<{ call: string; arg: any }> = [];
  const createdTabs: Array<{ url: string }> = [];
  // #124 がリスナーを外した後も残してある。下の「アクションは onClicked を登録してはいけない」
  // のテストが読むのは、この空の配列。
  const clickListeners: Array<(tab: any) => void> = [];
  const commandListeners: Array<(command: string) => Promise<void> | void> = [];
  // chrome.tabs.query({active:true}) が答える中身＝キーボードのコマンドもポップアップの経路も
  // 相手にするタブ。
  let activeTab: any = null;
  const tabUpdatedListeners: Array<(tabId: number, changeInfo: any) => void> = [];
  const tabRemovedListeners: Array<(tabId: number) => void> = [];
  let executeScriptImpl: (arg: any) => Promise<any> = async () => [];
  // 常駐コンテンツスクリプトが chrome.tabs.sendMessage へ返すはずの答え（#793 の
  // popupCheckBulk の入口）。このスイートの他の呼び出し側にとっては製品版の既定と同じ＝
  // どれも解決した値を読まず、.catch() を付けて投げっぱなしにするので、ここを undefined の
  // まま置いても何も変わらない。
  let tabsSendMessageImpl: (tabId: number, message: any) => Promise<any> = async () => undefined;
  let packageReadable = true;
  const recordAction = (call: string) => (arg: any) => {
    actionCalls.push({ call, arg });
    return Promise.resolve();
  };

  // #195: ここでは模してある（host-protocol.test.ts や background-unit.test.ts のスタブは
  // 模していない）。右クリックメニューからの保存の経路を下で受け持つのがこのファイルだから。
  // removeAll のコールバックは同期で走る＝実際の Chrome は非同期だが、ここに順序へ頼るものは
  // 無いし、偽のマイクロタスクを挟んでも雑音が増えるだけ。
  const contextMenuListeners: Array<(info: any, tab: any) => void> = [];
  const contextMenuCreateCalls: any[] = [];
  const chromeStub: any = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined as { message: string } | undefined,
      // removeListener（#239 の readPageMeta が、ブックマーク保存ごとに使い捨てのリスナーを
      // 登録し、答えが返ったら外す）＝実際の Chrome はどの onMessage にもこれを持つ。この
      // スタブへ登録される他のリスナーはテストの寿命の間ずっと居座り、これを呼ぶことはない。
      // 配列から抜き取らず、何もしない関数へ差し替える。リスナーがこれを呼ぶ時点（一致したら
      // 自分自身を外す）、下の dispatch() は同じ配列を `.map()` している最中で、その途中で
      // 抜き取ると添字がずれて次のリスナーを飛ばしてしまうため。
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
      // 呼び方の両方に対応する。対象のコードが両方を使うため＝古い読み手はコールバックを
      // 渡し、save-history.ts はコールバックを渡さないときに MV3 が返す promise を待つ。
      // コールバックだけのスタブでは、履歴の読み出しがどれも黙って「空」と答えてしまう。
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
  // 拡張機能が自分のファイルを読めるかどうかの実測（#269 / inject-failure.ts）。
  // ここでは偽装ではなく fetch そのものを差し替える＝製品版でも、この1回の応答が「拡張機能が
  // 壊れているのか、ページが拒んだのか」を決めている。
  (globalThis as any).fetch = async (url: string) => {
    if (!String(url).startsWith('chrome-extension://')) throw new Error(`unexpected fetch in this suite: ${url}`);
    if (!packageReadable) throw new Error('Failed to fetch');
    return { ok: true, status: 200 };
  };
  startBackground();

  function dispatch(message: any, sender: any = {}) {
    // #519: 保存の経路のメッセージは必ず saveId を持つ（ページが振る＝その保存のログ行を3つの
    // プロセスにまたがって束ねる識別子）。テストごとに書かなくて済むよう、渡されていなければ
    // 固定の値を埋める。id がホストまで本当に届くかを見るテストは、この値と突き合わせる。
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
    // #195: 上の dispatch / pressShortcut にあたる右クリックメニュー版＝startBackground() が
    // chrome.contextMenus.onClicked へ登録したリスナーを叩く。
    contextMenuCreateCalls,
    clickBookmarkMenu(tab: any, infoOverrides: any = {}) {
      for (const fn of contextMenuListeners) fn({ menuItemId: 'hologram-bookmark', ...infoOverrides }, tab);
    },
    // いま起動を頼める2つの道（3つ目の chrome.action.onClicked は、#124 が下のポップアップの
    // メッセージへ置き換えた）。
    //
    // どちらも chrome.tabs.query で自分のタブを見つけるので、テストはタブを手渡すのではなく
    // どれがアクティブかを言う。待つのは同期点の回数ではなく、入口そのものが返す Promise で
    // なければならない＝注入も生存の実測もアクションの呼び出しも全部その中に在るので、途中で
    // await が1つ増えても壊れない。
    onClickedListenerCount: () => clickListeners.length,
    pressShortcut: async (tab: any, auto = false) => {
      activeTab = tab;
      await Promise.all(commandListeners.map((fn) => fn(auto ? 'activate-auto' : 'activate')));
    },
    // ポップアップの保存ボタン。パネルが何を言うか決めるために読む {ok} / {reason} を返す＝
    // ツールバーには誰にも伝えるすべが無かったもの。
    popupSave: async (tab: any) => {
      activeTab = tab;
      const { responseP } = dispatch({ type: 'popupActivate' });
      return await responseP;
    },
    // The popup's "この一覧を取り込む" item (#793): asks background, which asks
    // 常駐コンテンツスクリプトへ訊く（注入ではなく chrome.tabs.sendMessage）＝
    // そのスクリプト自身の答えの代わりを務めるのが下の setResidentBulkAnswer。
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

// メッセージの本体で使う postUrl。どのプラットフォームの正規表現にも一致しない
// （parsePostUrl → null → fetchPostMetadata は fetch を呼ばず空のレコードで即座に解決する）。
const UNPARSEABLE_POST_URL = 'https://misskey.example/not-a-known-post-shape';
const MISSKEY_SENDER = { tab: { id: 7, url: 'https://misskey.example/notes/1' } };

// #519 以降、保存はまず capture.log へ「開始」の行を書く＝そのための接続が、保存自身の Port
// より先に開く。テストが駆動したいのは保存自身の Port なので、作られた順ではなく何を送ったかで
// 選ぶ（`createdPorts[0]` は今やログの接続）。
async function portThatSent(createdPorts: any[], type: string) {
  let found: any;
  await vi.waitFor(() => {
    found = createdPorts.find((p: any) => p.sent.some((m: any) => m.type === type));
    expect(found).toBeTruthy();
  });
  return found;
}

// capture.log のために開いた接続の数（保存の Port の数とは分けて数える）。
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

    // まず savePost を1回成功させ、markSaved 経由でキャッシュに載せる。
    const save = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: true, captureId: 'saved-capture-id', file: 'saved-file-id.jpg', media: ['https://misskey.example/files/aaa.png'] });
    const saveResult = await save.responseP;
    expect(saveResult.ok).toBe(true);

    // 次に同じ URL を checkSaved へ訊く＝キャッシュに当たるので、新しい Port は作られない。
    const { returns, responseP } = env.dispatch({ type: 'checkSaved', urls: [UNPARSEABLE_POST_URL] }, {});
    expect(returns).not.toContain(true); // 同期の応答
    // 応答は投稿ごとに captureId とその投稿の保存済み画像（#334）を、画像ごとに持ち主（#34）を運ぶ。
    // id は応答の captureId であって `file` ではない。印には「何かの id」があれば足りるが、
    // #34 の「差し替え」はこれを、退けるレコードとして読む。
    await expect(responseP).resolves.toEqual({ ok: true, results: { [UNPARSEABLE_POST_URL]: { id: 'saved-capture-id', media: ['https://misskey.example/files/aaa.png'], owners: ['saved-capture-id'], total: null } } });
    expect(createdPorts.some((p: any) => p.sent.some((m: any) => m.type === 'query'))).toBe(false); // queryBridge は呼ばれていない
  });
});

// #34 の重複保存の警告が立っている照会。ここで見るのは「警告を出すかどうか」の判定そのもの
// （軸は2つ＝投稿の URL と画像の重なり）と、差し替えが名指しするレコード。UI（3択のバナー）は
// capture.ts / drag.ts の側に在って、この答えを受け取るだけ。
describe('checkDuplicate — 重複保存の警告の判定', () => {
  let env: ReturnType<typeof setupBackground>;
  const X_SENDER = { tab: { id: 3, url: 'https://x.com/home' } };
  const POST = 'https://x.com/dave/status/444';
  const P0 = 'https://pbs.twimg.com/media/AAA?name=orig';
  const P1 = 'https://pbs.twimg.com/media/BBB?name=orig';

  beforeEach(() => {
    env = setupBackground();
  });

  // ホストの答えを1往復ぶんだけ用意する。checkDuplicate は保存の前に1往復しかしないので、
  // Port を1つ作って results を返せば足りる。
  async function answerQueryWith(entry: any, trashed?: any) {
    const createdPorts = env.connectAsControllablePort();
    const asked = env.dispatch({ type: 'checkDuplicate', platform: 'x', url: POST, imageUrls: [P0] }, X_SENDER);
    await vi.waitFor(() => expect(createdPorts.length).toBe(1));
    const sent = createdPorts[0].sent.find((m: any) => m.type === 'query');
    // trashed を渡さない呼び方＝#158 より前のホスト（あの欄を送らないホスト）を表す。
    createdPorts[0].emitMessage({ id: sent.id, ok: true, results: { [POST]: entry }, ...(trashed === undefined ? {} : { trashed: { [POST]: trashed } }) });
    return asked.responseP;
  }

  test('ライブラリに無い投稿は重複ではない', async () => {
    await expect(answerQueryWith(null)).resolves.toEqual({ ok: true, duplicate: false });
  });

  test('同じ絵が保存済みなら重複＝置換はその絵を持つレコードを名指しする', async () => {
    // 2枚目の絵だけが別のレコードとして保存されている状態。エントリの id（先にキーを掴んだ
    // レコード）は cap-a だが、今保存しようとしている P0 の絵を持っているのは cap-b。
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

  // #158: ライブラリには無いが、実体のファイルがゴミ箱に残っている投稿。差し替える相手が
  // 居ないので重複ではない＝duplicate は false のままで、告知だけが別の欄で返る。
  test('ゴミ箱に在る投稿は duplicate:false のまま告知を返す', async () => {
    await expect(answerQueryWith(null, { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' })).resolves.toEqual({
      ok: true,
      duplicate: false,
      trashed: { id: 'cap-gone', deletedAt: '2026-07-01T09:00:00Z' },
    });
  });

  // 「保存済みが勝つ」はホスト側ですでに決めている（両方を同時に運ぶことはない）が、判定が
  // その前提に寄りかかっていないことをここで固定する＝重複の答えに告知が混ざると、バナーが
  // 差し替えを隠してしまう。
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

      // metaReason は null＝ホストが落ちたのは投稿のせいではない（#505）。ここに理由が乗ると、
      // 「投稿を取得できなかった」の文言へ誤って落ちる。
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
    // #519: saveId も一緒にホストへ渡す＝ホストが書く行を、拡張機能側の行と結びつけられるように。
    expect(portCtl.sent).toEqual([expect.objectContaining({ type: 'savePost', captureId: expect.any(String), saveId: 'trace-1' })]);

    portCtl.emitMessage({ ok: true, file: 'saved-file-id' });
    const result = await responseP;

    expect(result).toMatchObject({ ok: true, file: 'saved-file-id' });
    expect(portCtl.isDisconnected()).toBe(true); // finish() が port.disconnect() を呼ぶ
    expect(() => portCtl.port.postMessage({ type: 'late' })).toThrow();
    // markSaved がこの送信元タブへ savedUpdate で知らせている。
    expect(env.tabsSent.some((s) => s.tabId === MISSKEY_SENDER.tab.id && s.message.type === 'savedUpdate')).toBe(true);
  });

  // #334: 知らせが運ぶのは「保存した」だけでなく「どの絵か」＝ホストが実際に記録したものを
  // そのまま通す。これが欠けると、複数枚の投稿の1枚を保存した直後に、残りの絵の保存ボタンが
  // 消える（オーバーレイが投稿ごと保存済みと読むため）。
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

    // 次の問い合わせは新しい Port を張り直す（切れた古い Port は使い回さない）。
    const second = env.dispatch({ type: 'checkSaved', urls: ['https://x.com/a/status/1'] }, {});
    await vi.waitFor(() => expect(createdPorts.length).toBe(2));
    // nextQueryId は張り直しをまたいでも持ち越される（失敗した1回目の要求が使った id は
    // 再利用しない）ので、実際に送られた id を読んでそれを返す。
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

    expect(createdPorts.length).toBe(1); // 同じポートを使い回す

    // 応答を順不同で返し、id で正しい呼び出し側へ届くことを確かめる。
    const [reqA, reqB] = createdPorts[0].sent;
    createdPorts[0].emitMessage({ id: reqB.id, ok: true, results: { 'https://x.com/b/status/2': { id: 'file-b', media: [] } } });
    createdPorts[0].emitMessage({ id: reqA.id, ok: true, results: { 'https://x.com/a/status/1': { id: 'file-a', media: [] } } });

    await expect(first.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/a/status/1': { id: 'file-a', media: [] } } });
    await expect(second.responseP).resolves.toEqual({ ok: true, results: { 'https://x.com/b/status/2': { id: 'file-b', media: [] } } });
  });
});

// #519: 保存の一生を capture.log に残す。ここで見るのはサービスワーカー側の3点＝
// ① 保存が「始まった」と必ず名乗ること（これが無いと「単に起動しただけ」と区別が付かない）
// ② 失敗の行が saveId・captureId・到達した段を運ぶこと（近い時刻で行を結ばずに済むように）
// ③ 段を通過するたびページへ報告すること（ワーカー自身が消えてもページ側が名乗れるように）。
// ページ側の受け取りと取り消しの行は scripts/save-log.test.ts にある。
describe('保存の記録（#519）', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  // 上限に達する前でも、プロセスごと消えても残る唯一の行なので、どの待ちよりも先に出ることが
  // 条件になる。ここで見るのは、ホストがまだ何も答えていない時点。
  // 3つの経路すべてを見る。`imageDragged` は常駐スクリプトの画面（ホバーの保存ボタンとドロップ
  // 領域）が使う唯一の保存経路で、あの画面は `activate` の行を出さない＝「開始」の行が無いと、
  // あの画面での保存は記録に一切現れない。利用者が実際に固まりに当たったのがその画面なので、
  // これが欠けると #519 の目的そのものが崩れる。
  test.each([
    ['savePost', { type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }],
    ['save', { type: 'captureAndSend', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, rect: { x: 0, y: 0, width: 10, height: 10 } }],
    ['saveDragged', { type: 'imageDragged', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, imageUrls: ['https://misskey.example/files/a.png'] }],
  ])('%s: 保存を受け付けた時点で「開始」の行が出る（どの待ちより先）', async (type, message) => {
    const createdPorts = env.connectAsControllablePort();

    env.dispatch(message, MISSKEY_SENDER);

    const logPort = await portThatSent(createdPorts, 'log');
    expect(logPort.sent[0].entry).toMatchObject({ stage: 'save', phase: 'begin', type, saveId: 'trace-1', url: UNPARSEABLE_POST_URL, captureId: expect.any(String) });
    // ログの接続は保存の接続とは別＝保存1回につきホストのプロセスが1つ増える。上限より先に
    // 「開始」をディスクへ落とすための引き換えで、意図してそうしている。
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
      // メタデータの段は通り、ブリッジで落ちた＝どこまで進んだかが行に乗る。
      reached: ['metadata'],
    });
  });

  test('段を通過するたびページへ報告する（ワーカーが消えてもページが名乗れるように）', async () => {
    const createdPorts = env.connectAsControllablePort();

    const { responseP } = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    (await portThatSent(createdPorts, 'savePost')).emitMessage({ ok: true, file: 'saved-file-id' });
    await responseP;

    const progress = env.tabsSent.filter((s) => s.message.type === 'saveProgress').map((s) => s.message);
    // 先頭の空配列が「受け取った」の合図＝まだどの段も通っていない。これが届くまでページ側の
    // 期限は「そもそも動いているか」を測り、届いた後は「黙り込んでいないか」を測る
    // （save-deadline.ts）。だから段の報告と同じ経路で、これが先に1本来る必要がある。
    expect(progress.map((m) => m.reached)).toEqual([[], ['metadata'], ['metadata', 'bridge']]);
    expect(progress.every((m) => m.saveId === 'trace-1')).toBe(true);
  });

  test('保存を受け取った時点で、まだ何も通っていなくても1本押す（居るかどうかが先に分かる）', async () => {
    const createdPorts = env.connectAsControllablePort();

    // ポートには何も答えさせない＝ホストの手前で止まった保存。それでも受領記録だけは先に
    // 届いている。それがこの合図の役目。
    env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    await portThatSent(createdPorts, 'savePost');

    const first = env.tabsSent.filter((s) => s.message.type === 'saveProgress').map((s) => s.message)[0];
    expect(first, `tabsSent: ${JSON.stringify(env.tabsSent)}`).toMatchObject({ saveId: 'trace-1', reached: [] });
  });
});

// === 注入そのものが失敗した時（#269） ===========================================
//
// 起動からの保存は「background が capture.js を注入し、注入されたスクリプトがバナーを描く」
// という作りなので、注入が失敗すると、その失敗を告げる画面がページ上に1つも無い＝押下が完全に
// 無反応になる。ページ側に自前の画面が無い以上、表示の画面として残るのはツールバーのアクション
// だけで、ここで見るのはその画面の配線。ドラッグからの保存は常駐スクリプトが自分でバナーを
// 描くので関係ない。
//
// ⚠️「拡張機能が壊れている」と「ページが拒んだ」を分けるのは Chrome の例外の文言ではなく、
// 拡張機能が自分のファイルを読めるかどうかの実測（fetch(chrome.runtime.getURL(...))）。
// 文言は約束事ではないので、そこで分岐させると Chrome の言い回しが変わった日に案内が反転する。
//
// 駆動はキーボードの経路から（#124）。アイコンはもう何も起動せず、ポップアップを開くだけなので、
// ここで書いた段階的な引き上げが今も生きているのは Alt+S の側。ポップアップ自身の経路は
// この次のブロック。
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
    // 色は生成されたトークンから来る＝ここに色のリテラルは無い（#270）。
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

  // 2026-07-31 に使い捨て Chromium で実測。拡張機能の展開先ディレクトリが消えると
  // chrome-extension://<id>/diag.html は開けず ERR_FILE_NOT_FOUND になる＝この Issue の元に
  // なった失敗そのものが、診断ページへの逃げ道を塞ぐ。
  // まだ出せる画面は chrome://extensions だけで、そこの「再読み込み」が直し方そのもの。
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

// === ポップアップの保存ボタン（#124） ===========================================
//
// ツールバーのアクションにパネルを持たせると chrome.action.onClicked を失う＝Chrome は
// ポップアップを持つアクションへあれを配らない。だから、これまで注入していた押下はメッセージ
// として届く。成り立たせるべきことは2つ。注入の実装が1つのままであること（ポップアップが
// 自前のものを生やさない）。そして、#269 の2回目の押下と違って、ポップアップの押下はパネルの
// 裏に修復用のタブを開かないこと。パネル自体が、#269 には無かったその画面だから。
describe('ポップアップからの保存（#124）', () => {
  let env: ReturnType<typeof setupBackground>;
  const TAB = { id: 42, url: 'https://x.com/someone/status/1' };
  const badgeText = (calls: Array<{ call: string; arg: any }>) => calls.filter((c) => c.call === 'setBadgeText').map((c) => c.arg);

  beforeEach(() => {
    env = setupBackground();
  });

  // このリスナーは決して発火しない（Chrome いわく「This event will not fire if the action
  // has a popup」）ので、登録を残しておくのは無害ではない＝生きているように読める、死んだ
  // 2本目の経路になる。
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

  // 印は残る＝閉じてしまうパネルより長生きする。だがタブは開かない。パネルは今開いていて
  // 読まれている最中で、同じページをボタンとして差し出しているから。
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

  // タブごとの回数を2つの経路で共有しているのは意図してそうしている。ポップアップが変える
  // のはタブを開くかどうかであって、何を失敗と数えるかではない。
  test('Alt+S 側の意味は変わらない（同じタブの2回目は今までどおり開く）', async () => {
    env.failInjection('The extensions gallery cannot be scripted.');
    await env.popupSave(TAB);
    await env.pressShortcut(TAB);
    expect(env.createdTabs).toEqual([{ url: 'chrome-extension://test-extension-id/diag.html?issue=inject' }]);
  });
});

// === ポップアップの一括取込の項目（#793） =========================================
//
// 保存ボタンと違い、この経路は答えを出すために注入しない。chrome.tabs.sendMessage で常駐
// コンテンツスクリプト（match したサイトにはもう載っている）へ訊く。だから、待ち受けの無い
// ページ（chrome://・match しないサイト）は、そのサイトの extractor が「対応しない」と答えた
// のと同じに読まれる＝どちらも {supported: false} で返り、パネルが特別扱いしなければならない
// 例外にはならない。
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
    env.setResidentBulkAnswer({ supported: true }); // 設定はしてある＝ここへ届いてはいけない
    expect(await env.popupCheckBulk({ id: 44, url: 'chrome://newtab/' })).toEqual({ supported: false });
    expect(env.tabsSent.some((s) => s.message?.type === 'checkBulkCapturePage')).toBe(false);
  });

  test('アクティブタブが無ければ supported:false', async () => {
    expect(await env.popupCheckBulk(null)).toEqual({ supported: false });
  });
});

// === ポップアップが読むもの（#124） ==============================================
//
// パネルが見せるのは、ワーカーがそのために書いておかなければならない2つ。どちらも、あらゆる
// 保存の経路が通る唯一の漏斗（admitSave）から書かれる。最近の保存のリングと、版ずれの通知に
// ついては、このブラウザセッションで既にバナーが1度言ったという事実。
describe('保存履歴と版ずれ通知（#124）', () => {
  let env: ReturnType<typeof setupBackground>;

  beforeEach(() => {
    env = setupBackground();
  });

  const history = () => env.localStore.get('saveHistory.v1') as any[] | undefined;

  // portThatSent と同じく何を送ったかで保存の Port を選ぶが、最初ではなく n 番目を採る。
  // このスイートは保存を2回続けて駆動するため。
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

  // この一覧は「入ったのか」に答えるために読まれるので、「入らなかった」もそこに要る。
  test('入らなかった保存も1行残る', async () => {
    env.connectAsUnavailable('Specified native messaging host not found.');
    const save = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    await save.responseP;
    await vi.waitFor(() => expect(history()?.[0]).toMatchObject({ ok: false, type: 'savePost' }));
    expect(history()?.[0].error).toBeTruthy();
  });

  // 版ずれを読む常設の場所は、今はポップアップ。バナーはブラウザセッションごとに1回だけ言う。
  // ポップアップを一度も開かない人にも伝わるように、そしてちょうど1回にして、保存のたびに
  // 雑音にならないように。
  test('版ずれの通知はブラウザセッション中1回だけ', async () => {
    const createdPorts = env.connectAsControllablePort();
    const first = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL }, MISSKEY_SENDER);
    await answerSave(createdPorts, 0, { ok: true, captureId: 'cap-1', protocolVersion: 3 });
    expect((await first.responseP).hostSkew).toBe('host-new');

    const second = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: `${UNPARSEABLE_POST_URL}-2` }, MISSKEY_SENDER);
    await answerSave(createdPorts, 1, { ok: true, captureId: 'cap-2', protocolVersion: 3 });
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
        vi.advanceTimersByTime(1); // 毎回 ts を1ms進め、間引きの順序の判定を決定的にする
      }

      const { responseP } = env.dispatch({ type: 'dumpLogs' }, {});
      const { entries } = await responseP;

      expect(entries).toHaveLength(50);
      expect(entries[0].seq).toBe(5); // 古い方から5件（seq 0-4）が間引かれた
      expect(entries[49].seq).toBe(54);
    } finally {
      vi.useRealTimers();
    }
  });
});

// #450: 動画の投稿でページが渡せるのはポスター画像だけで、その1枚を作品として保存しても
// ライブラリに入れる意味が無い。動画と GIF の投稿は、プラットフォームが申告した原本を落とす
// 投稿保存の経路へ回す（動画自体への対応は #119 の段1で入った）＝ここで見るのはその振り分け。
describe('imageDragged の振り分け（#450）', () => {
  const X_SENDER = { tab: { id: 3, url: 'https://x.com/alice/status/1' } };
  const X_POST_URL = 'https://x.com/alice/status/1';
  const POSTER = 'https://pbs.twimg.com/amplify_video_thumb/1/img/abc.jpg';

  // 部分文字列ではなくホストで見る。対象の URL はクエリに投稿 URL を抱えているので、
  // `includes()` では全く別の宛先への要求にも「はい」と答えてしまう。
  const isSyndication = (url: unknown) => {
    try {
      return new URL(String(url)).hostname === 'cdn.syndication.twimg.com';
    } catch {
      return false;
    }
  };

  function mockSyndication(mediaDetails: unknown[]) {
    vi.stubGlobal('fetch', async (url: unknown) => (isSyndication(url) ? new Response(JSON.stringify({ text: 'hi', user: { screen_name: 'alice', id_str: '1' }, mediaDetails }), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 404 })));
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

  // 静止画は今までどおり働く＝指した絵そのものがレコードの主画像になる、作品レコードの形を乱さない。
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

// #323 の後半。ページ側の防ぎ（isTrusted）が塞ぐのは「今在る経路」だけなので、ホストの
// プロセスを起こす側にも上限を置く。connectNative は1回につきホストのプロセスを1つ起こす
// （意図してそうしている＝アプリを閉じていても保存できるのはこのため）ので、「何本開けるか」が
// そのまま「何プロセス起こせるか」になる。
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

    // saveId が違っても「同じタブからの同じ投稿」＝同じ保存。2本目のホスト接続は開かない。
    expect(savePorts(createdPorts)).toHaveLength(1);
    await expect(first.responseP).resolves.toMatchObject({ ok: true, captureId: 'cap-1' });
    await expect(second.responseP).resolves.toMatchObject({ ok: true, captureId: 'cap-1' });
  });

  test('同時に走らせられる保存には上限があり、超えた分は接続を開かずに断る', async () => {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();

    // どれも答えない＝全部が枠を掴んだままになる。人の操作では届かない本数（上限は8）。
    for (let i = 0; i < 8; i++) env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(i), saveId: `s${i}` }, MISSKEY_TAB);
    await vi.waitFor(() => expect(savePorts(createdPorts)).toHaveLength(8));

    const refused = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(99), saveId: 's99' }, MISSKEY_TAB);

    // 断りは同期で返る＝ホストには一切触れていない。
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
    // 応答が返る時点で枠はもう戻っている（枠の解放は sendResponse より先に走る）。
    await expect(running[0].responseP).resolves.toMatchObject({ ok: true });

    const next = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: postUrl(100), saveId: 's100' }, MISSKEY_TAB);
    await vi.waitFor(() => expect(savePorts(createdPorts)).toHaveLength(9));
    expect(next.returns).toContain(true); // busy ではなく、本物の保存として受け付けられた
  });

  // この Issue の出発点そのもの＝投稿へ解決しないクリックが診断ログの行を1本ずつ出し、その行
  // ごとに接続が開いていた。行は落とさず、接続だけをまとめる。
  //
  // 最初の1行は待たせない（先頭で出す）＝#519 の「保存を開始した」の行は、後続の待ちが詰まる
  // 前にディスクへ落ちる必要がある。まとめるのは、その1本の接続が開いている間に溜まった分
  // なので、20行あっても接続は2本しか開かない＝行数に比例しない。
  test('失敗ログが連続しても、接続は行数に比例しない（開いている1本にまとめる）', async () => {
    const env = setupBackground();
    const createdPorts = env.connectAsControllablePort();
    // 接続は「この20行のどれかを運んだか」で数える。前のテストが起こしたワーカーのタイマーが
    // このスタブへ漏れてくることがあるため（テスト環境でだけ起きる＝実際にはワーカーは1つ）。
    const ourLines = (port: any) => port.sent.filter((m: any) => m.type === 'log' && typeof m.entry?.seq === 'number');
    const ourPorts = () => createdPorts.filter((p: any) => ourLines(p).length);

    for (let i = 0; i < 20; i++) {
      env.dispatch({ type: 'logCapture', entry: { stage: 'select', phase: 'fail', seq: i } }, { tab: { url: 'https://x.com/a' } });
    }

    await vi.waitFor(() => expect(ourPorts()).toHaveLength(1));
    expect(ourLines(ourPorts()[0])).toHaveLength(1); // 最初の1行はすぐ出る＝残り19行では接続が増えない

    ourPorts()[0].emitMessage({ ok: true }); // この接続は使い切り＝溜まった分は次の1本でまとめて出る
    await vi.waitFor(() => expect(ourPorts()).toHaveLength(2), { timeout: 3000 });
    expect(ourLines(ourPorts()[1])).toHaveLength(19); // 行は1本も落ちていない
    expect(ourPorts()).toHaveLength(2); // 20行に対して接続は2本
  });
});

// #580: 失敗した保存がどちらの console に出るか。console.error は chrome://extensions の
// エラーコンソールに積み上がるので、保存の結果としての断り（取得できない投稿）は console.warn
// へ、本当に壊れているものは console.error へ届き続けなければならない。
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

// URL のブックマーク取り込み（#195、メタデータ抽出は #239 が吸収）＝ページの右クリック項目。
// chooseWebMeta と buildWebMeta は web-meta.test.ts が直接受け持ち、ビルドしたエントリポイント
// と実パーサの組み合わせは read-meta-bundle.test.ts が受け持つ。このスイートが足すのは、
// あちらでは動かせない配線だけ＝登録、files: での注入と pageMetaExtracted メッセージの往復、
// そして Native Messaging の通信路上へ実際に届くもの。
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
    // read-meta.js の報告＝クリックの前ではなく後に流す。doSaveBookmark は readPageMeta の
    // Promise executor の中で onMessage のリスナーを同期で登録し、その executor は
    // doSaveBookmark 自身の最初の await より前に（これも同期で）走る。だから
    // clickBookmarkMenu が返る時点でリスナーはもう生きている。
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

    // markSaved が走るのは emitMessage からマイクロタスクを数回跨いだ後（doSaveBookmark 自身の
    // await の連なりの中、bumpRecentSave の storage.session の往復の先）。マクロタスクを1回
    // 回せば全部片付くので、ここは実時間を待つのではなくイベントループへ制御を返している。
    // vi.waitFor でないのは、再試行するものが無いから＝早すぎる dispatch はキャッシュに外れて
    // queryBridge へ落ち、このテストが決して答えない2本目のネイティブ接続を開く。単に
    // もう一度問い合わせ直すのではなく、そこで止まってしまう。
    // biome-ignore lint/plugin: 0ms ＝マクロタスクを1つ譲るという意味で、時間を待っているのではない
    await new Promise((r) => setTimeout(r, 0));
    const { responseP } = env.dispatch({ type: 'checkDuplicate', url: TAB.url, platform: null, imageUrls: [] });
    await expect(responseP).resolves.toMatchObject({ ok: true, duplicate: true, captureId: 'bm-capture-id' });
  });
});

// #203: 再送のキュー。退避・追い出し・格下げ・冪等性・直列の停止は save-queue.ts 自身の
// スイート（scripts/save-queue.test.ts）が直接受け持つ。このブロックが見るのは配線＝
// background.ts の bridgeSend が「届かない」拒否に印を付けること、実際の imageDragged の経路を
// 通って退避が chrome.storage.local へ落ちること、そして4つの引き金の1つ（checkSaved の印の
// 照会）から再送が端から端まで本当に起きること。
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

  // 引き金4（#203 の設計コメント #4）の端から端までの形。保存済みの印の照会ポートが答える
  // ことが掃き出しを起こし、そのための専用の巡回は要らない。退避 → 冪等性の事前検査 → 再送 →
  // キューからの取り出しを、実際の Chrome セッションと同じ background.ts の配線で駆動する。
  test('checkSaved のクエリ成功が引き金になり、退避済みの保存が再送されて消える', async () => {
    // 1) ホストへまったく届かない状態で保存が失敗し、退避される。
    env.connectAsUnavailable('Specified native messaging host not found.');
    const failed = env.dispatch(DRAG, MISSKEY_SENDER);
    const failResult = await failed.responseP;
    expect(failResult.queued).toBe(true);
    expect([...env.localStore.keys()].some((k) => k.startsWith('savequeue_'))).toBe(true);

    // 2) ホストへ届くようになる。
    const createdPorts = env.connectAsControllablePort();

    // 3) タイムラインの印が無関係な投稿について訊く＝その照会ポートが答えることが引き金4。
    const check = env.dispatch({ type: 'checkSaved', urls: ['https://misskey.example/notes/other'] }, {});
    const queryPort = await portThatSent(createdPorts, 'query');
    const badgeReq = queryPort.sent.find((m: any) => m.type === 'query');
    queryPort.emitMessage({ id: badgeReq.id, ok: true, results: {} });
    await check.responseP;

    // 4) 掃き出し自身の冪等性の事前検査（#34）は、同じ常駐の照会ポートを2本目の 'query'
    //    メッセージで使い回す。
    await vi.waitFor(() => expect(queryPort.sent.filter((m: any) => m.type === 'query').length).toBe(2));
    const idempotencyReq = queryPort.sent.filter((m: any) => m.type === 'query')[1];
    queryPort.emitMessage({ id: idempotencyReq.id, ok: true, results: {} }); // まだ入っていない

    // 5) ここで初めて、再送が自分の使い捨てポートを開いて成功する。
    const resendPort = await portThatSent(createdPorts, 'saveDragged');
    resendPort.emitMessage({ ok: true, file: 'resent.jpg', media: [] });

    await vi.waitFor(() => expect([...env.localStore.keys()].some((k) => k.startsWith('savequeue_'))).toBe(false));
  });
});
