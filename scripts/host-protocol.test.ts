// 拡張⇄ネイティブホストのメッセージ契約（#400 — native-host/protocol.mts）。
//
// 型検査だけでは片側しか守れない：拡張とホストは別の TS プロジェクトで、
// `npm run typecheck` は両方を別々に通すので、「同じ宣言を import している」
// ことは型検査では見えても「拡張が実際に線に載せた形」は見えない。
// ここが見るのはそこ＝**拡張のコードが本当に送ったメッセージ**を、
// **ホストが本当に使う parse** に通す。フィールドを片側だけ改名すれば、
// 型検査が落ちなくてもこのスイートが落ちる。
//
// 送信側は startBackground() をそのまま動かす（bridgeSend / queryBridge は
// 閉包の中で、外から呼べないため）。chrome スタブの方針は
// scripts/background-wiring.test.ts と同じ＝ライブラリを使わず Port を自前で演じる。
// ネットワークに触れないよう postUrl はどのプラットフォームにも一致しない文字列を使う
// （fetchPostMetadata が fetch を呼ばず空レコードで即解決する）。

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { generateCaptureId, startBackground } from '../extension/utils/background';
import { CAPTURE_ID_PATTERN, PROTOCOL_VERSION, hostProtocolVersion, isCaptureId, parseHostFrame, parseHostRequest, protocolSkewOf, readHostResponse, responseId, stampProtocol } from '../native-host/protocol.mts';

const UNPARSEABLE_POST_URL = 'https://misskey.example/not-a-known-post-shape';
const SENDER = { tab: { id: 7, windowId: 1, url: 'https://misskey.example/notes/1' } };
// 1x1 の JPEG は要らない＝ホストへ渡る前の形だけを見るので、crop の返り値は
// data URL の体裁さえ整っていればよい。
const CROPPED = 'data:image/jpeg;base64,/9j/4AAQ';

// 送信された全メッセージを1本のリストに集める chrome スタブ。ポートを何本開いたか
// （保存用・ログ用・バッジ用）はここでの関心ではない＝線に載った物だけを見る。
function setup() {
  const messageListeners: Array<(message: any, sender: any, sendResponse: (r: any) => void) => boolean> = [];
  const sent: any[] = [];
  // ポートごとの送信も控える＝返信を「その問い合わせを出したポート」へ返すため
  // （保存・ログ・バッジで別々のポートが開くので、返す先を間違えると届かない）。
  const ports: Array<{ emitMessage(msg: any): void; sent: any[] }> = [];

  const chromeStub: any = {
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
      sendMessage: (_tabId: number, message: any) => Promise.resolve(message?.type === 'cropImage' ? { croppedDataUrl: CROPPED } : undefined),
      query: async () => [{ id: SENDER.tab.id, windowId: SENDER.tab.windowId }],
      captureVisibleTab: async () => CROPPED,
    },
    scripting: { executeScript: async () => {} },
    action: { onClicked: { addListener: () => {} } },
    commands: { onCommand: { addListener: () => {} } },
    storage: {
      local: { get: (_k: any, cb: (r: any) => void) => cb({}), set: (_i: any, cb?: () => void) => cb?.(), remove: (_k: any, cb?: () => void) => cb?.() },
      session: { get: async () => ({}), set: async () => {} },
    },
  };

  (globalThis as any).chrome = chromeStub;
  startBackground();

  return {
    sent,
    ports,
    dispatch(message: any) {
      let respond!: (r: any) => void;
      const responseP = new Promise<any>((resolve) => {
        respond = resolve;
      });
      for (const fn of messageListeners) fn(message, SENDER, respond);
      return responseP;
    },
    // 型ごとに1件取り出し、共有 parse を通した結果を返す。parse が拒めばここで落ちる。
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
    // その型を送ったポート＝そこへ返信を流せば、拡張側の待っている処理へ届く。
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
    env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, saveId: 'trace-1' });
    const req = await env.parsedOf('savePost');
    expect(req.type).toBe('savePost');
    if (req.type !== 'savePost') return;
    // captureId は契約の形（parse が弾いた id は null になる）＝ホストがそのまま
    // ファイル名の頭に使う値なので、ここが null で通ることは無い。
    expect(req.captureId).toMatch(CAPTURE_ID_PATTERN);
    expect(req.saveId).toBe('trace-1'); // #519: 3プロセスをまたいで保存を結ぶ id
    expect(req.metadata.url).toBe(UNPARSEABLE_POST_URL);
    expect(req.metaOk).toBe(false); // 空レコード＝プラットフォーム API から何も返っていない
  });

  test('save（スクリーンショット保存）', async () => {
    env.dispatch({ type: 'captureAndSend', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, saveId: 'trace-2', rect: { x: 0, y: 0, width: 10, height: 10 } });
    const req = await env.parsedOf('save');
    expect(req.type).toBe('save');
    if (req.type !== 'save') return;
    expect(req.captureId).toMatch(CAPTURE_ID_PATTERN);
    expect(req.image).toBe(CROPPED.split(',')[1]); // data URL の頭は落として base64 だけを渡す
  });

  test('saveDragged（ドラッグ保存）', async () => {
    env.dispatch({ type: 'imageDragged', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, saveId: 'trace-3', imageUrls: ['https://misskey.example/files/a.png'] });
    const req = await env.parsedOf('saveDragged');
    expect(req.type).toBe('saveDragged');
    if (req.type !== 'saveDragged') return;
    expect(req.imageUrl).toBe('https://misskey.example/files/a.png');
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
    env.dispatch({ type: 'logCapture', entry: { stage: 'select', phase: 'fail', saveId: 'trace-4' } });
    const req = await env.parsedOf('log');
    expect(req.type).toBe('log');
    if (req.type !== 'log') return;
    expect(req.entry.stage).toBe('select');
  });

  test('保存中に線へ載ったメッセージは、1件残らず契約の型に収まる', async () => {
    env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, saveId: 'trace-5' });
    await env.parsedOf('savePost');
    expect(env.sent.length).toBeGreaterThan(0);
    for (const message of env.sent) {
      const parsed = parseHostRequest(message);
      expect(parsed.ok, `契約に無いメッセージが送られた: ${JSON.stringify(message)?.slice(0, 120)}`).toBe(true);
    }
  });
});

// ping は診断ページ（extension/utils/diag.ts）だけが送る。DOM ごと立ち上げずに
// 形だけを確かめる＝送信箇所は `satisfies HostRequest` で型検査が押さえている。
describe('parseHostRequest — 型ごとの受理と、失敗の答え方', () => {
  test('ping', () => {
    const parsed = parseHostRequest({ type: 'ping' });
    expect(parsed.ok && parsed.request.type).toBe('ping');
  });

  test('未知の type は unknown-type ＝ホストは黙って捨てない', () => {
    const parsed = parseHostRequest({ id: 9, type: 'saveEverything' });
    expect(parsed).toEqual({ ok: false, id: 9, failure: { ok: false, code: 'unknown-type', error: 'Unknown message type: saveEverything' } });
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

  test('欠けたフィールドは throw でなく、ハンドラが断れる形に落ちる', () => {
    const parsed = parseHostRequest({ type: 'save' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.request.type !== 'save') return;
    expect(parsed.request.captureId).toBeNull(); // → ハンドラの 'Invalid captureId'
    expect(parsed.request.image).toBe(''); // → ハンドラの 'Missing image data'
    expect(parsed.request.metadata).toEqual({});
  });

  test('query の urls から文字列でないものは落ちる', () => {
    const parsed = parseHostRequest({ type: 'query', id: 1, urls: ['https://x.com/u/status/1', null, 42, ''] });
    expect(parsed.ok && parsed.request.type === 'query' && parsed.request.urls).toEqual(['https://x.com/u/status/1']);
  });
});

describe('captureId は契約が持つ＝保存フォルダから出られない形だけを通す', () => {
  test('拡張が振る id は契約の形に合う', () => {
    for (let i = 0; i < 50; i++) expect(isCaptureId(generateCaptureId())).toBe(true);
  });

  test('パス区切りや .. を含む id は請求の時点で落ちる', () => {
    for (const bad of ['../../etc/passwd', '1717500000000-ab/cd', '1717500000000-ab\\cd', '..', '', 'nope']) {
      expect(isCaptureId(bad)).toBe(false);
      const parsed = parseHostRequest({ type: 'save', captureId: bad, image: 'x' });
      expect(parsed.ok && parsed.request.type === 'save' && parsed.request.captureId).toBeNull();
    }
  });
});

describe('readHostResponse / responseId — 返信の読み方も1か所', () => {
  test('ok:true は ack、それ以外は文言つきの失敗', () => {
    expect(readHostResponse({ ok: true, captureId: '1717500000000-ab', file: 'a.jpg', saveFolder: 'D:/x', media: [], mediaCount: 0 })).toMatchObject({ ok: true, ack: { file: 'a.jpg' } });
    expect(readHostResponse({ ok: false, error: 'Post unavailable: …', code: 'save-failed' })).toEqual({ ok: false, error: 'Post unavailable: …', code: 'save-failed', protocolVersion: null });
  });

  // 保存は済んでいるのに読み手が「失敗した」と言い出すのが最悪なので、知らない
  // フィールドは通す＝ホストと拡張は別経路で更新される（#205 が扱う世代ずれ）。
  test('見覚えのないフィールドを持つ ack も ack のまま通る', () => {
    expect(readHostResponse({ ok: true, file: 'a.jpg', somethingNewer: 1 })).toMatchObject({ ok: true });
  });

  test('返信になっていないものは既定の文言で失敗にする', () => {
    expect(readHostResponse(undefined)).toEqual({ ok: false, error: 'Native host returned an error', code: null, protocolVersion: null });
    expect(readHostResponse({ ok: false })).toEqual({ ok: false, error: 'Native host returned an error', code: null, protocolVersion: null });
  });

  test('返信の id は、どの問い合わせの答えかを言う唯一の手段', () => {
    expect(responseId({ id: 12, ok: true })).toBe(12);
    expect(responseId({ ok: true })).toBeNull(); // 保存の返信＝1往復のポートなので id は要らない
  });
});

test('PROTOCOL_VERSION は契約が変わった時だけ動く整数（#205 が比較する値）', () => {
  expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
  expect(PROTOCOL_VERSION).toBeGreaterThan(0);
});

// 拡張とホストは別経路で更新される（拡張＝Chrome ウェブストア／ホスト＝アプリの
// 自動更新）ので「片方だけ新しい」は事故ではなく常態。ここが見るのは、そのずれが
// ①検知されること ②検知しても保存を止めないこと の2点。
describe('プロトコル版のハンドシェイク（#205）', () => {
  test('返信への刻印は1か所で付く＝2つ目の送り手が付け忘れられない', () => {
    expect(stampProtocol({ ok: true, pong: true })).toEqual({ ok: true, pong: true, protocolVersion: PROTOCOL_VERSION });
    // 失敗の返信にも付く＝保存を断るほど古いホストこそ、版が知りたい相手。
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
    // 比較できない刻印は「無い」と同じ扱い＝3つ目の状態を作らない。
    expect(hostProtocolVersion({ ok: true, protocolVersion: '1' })).toBeNull();
    expect(hostProtocolVersion({ ok: true, protocolVersion: 1.5 })).toBeNull();
    expect(hostProtocolVersion({ ok: true, protocolVersion: 2 })).toBe(2);
  });

  test('版がずれていても保存は止まらず、結果に更新案内が乗る', async () => {
    const env = setup();
    const responseP = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, saveId: 'skew-1' });
    const port = await env.portThatSent('savePost');
    // 版を名乗らない＝この契約より前のホスト。ack 自体は正常に返す。
    port.emitMessage({ ok: true, captureId: '1717500000000-abcd', file: 'a.jpg', saveFolder: 'D:/x', media: [] });
    const res = await responseP;
    expect(res.ok).toBe(true); // ⚠️止めない＝データを捨てない（リトライキュー #203 と同じ方針）
    expect(res.captureId).toBe('1717500000000-abcd'); // 保存の結果もそのまま届く
    expect(res.hostSkew).toBe('host-old');
  });

  test('版が合っていれば案内は出ない', async () => {
    const env = setup();
    const responseP = env.dispatch({ type: 'savePost', platform: 'misskey', postUrl: UNPARSEABLE_POST_URL, saveId: 'skew-2' });
    const port = await env.portThatSent('savePost');
    port.emitMessage({ ok: true, captureId: '1717500000000-abcd', file: 'a.jpg', saveFolder: 'D:/x', media: [], protocolVersion: PROTOCOL_VERSION });
    await expect(responseP).resolves.toMatchObject({ ok: true, hostSkew: null });
  });
});
