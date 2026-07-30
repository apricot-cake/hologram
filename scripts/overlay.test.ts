// extension/utils/overlay.ts＝タイムライン上のオーバーレイ（#54 の「保存済み」印を #309 の
// 三値設定で出し分け、#94 のホバー保存ボタンを出す）のオフライン純ユニットテスト。
// ビルド済みのコンテンツスクリプトを jsdom の中で、実際の注入と同じグローバル
// （glass-ui.js / site-detect.js / media-identity.js をマニフェスト順に同じ window で評価）と
// スタブした chrome API のもとで走らせる。
//
// 見るのはスクリプト自身の配線＝どの投稿を問い合わせるか・それが1バッチか・答えと設定が
// 角の表示を決めるか・保存ボタンが「正直に保存できる」場所にだけ出るか・押したときに
// ドラッグ&ドロップと同じメッセージを送るか・投稿自身の部分木を触らないか。
// 見られないのは、プラットフォームごとのセレクタが実際の X / Bluesky / pixiv の DOM に
// まだ当たるか（フィクスチャは自前のマークアップなので、自分が書いたものを読めることしか
// 証明しない。content-fixtures.test.ts と同じ限界で、生きたカナリアは
// scripts/e2e-capture-test.cts）。
//
// このスイートは1つのページを順に動かすので、テストの宣言順に意味がある。
//
// 前提: extension のビルド成果物（extension/.output/chrome-mv3/…）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { asUser } from './lib-user-event.ts';

// overlay.ts の x 分岐が狙う形の投稿。data-rect-top がメディア枠の幾何を宣言し
// （jsdom は何もレイアウトしない）、data-rect-size で大きさを絞る。
const X_HTML = `<!doctype html><html><body>
  <div id="feed">
    <article data-testid="tweet" id="p1">
      <a href="/alice/status/111"><time datetime="2026-07-01T00:00:00Z">1h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="100"><img src="https://pbs.twimg.com/media/AAA.jpg"></div>
    </article>
    <article data-testid="tweet" id="p2">
      <a href="/bob/status/222"><time datetime="2026-07-01T00:00:00Z">2h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="400"><img src="https://pbs.twimg.com/media/BBB.jpg"></div>
    </article>
    <!-- p3 の写真はまだ大きさを持たない（data-rect-top 無し）＝折り返しの下の遅延読み込み画像。
         実際のタイムラインが、絵がレイアウトされる前に投稿へ答えるのと同じ状況。 -->
    <article data-testid="tweet" id="p3">
      <a href="/carol/status/333"><time datetime="2026-07-01T00:00:00Z">3h</time></a>
      <div data-testid="tweetPhoto"><img id="lazy" src="https://pbs.twimg.com/media/CCC.jpg"></div>
    </article>
    <!-- 1投稿に2枚: 保存ボタンは1枚に対して働くので、枠ごとに自分のアンカーを持つ -->
    <article data-testid="tweet" id="p4">
      <a href="/dave/status/444"><time datetime="2026-07-01T00:00:00Z">4h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="1200" id="p4a"><img src="https://pbs.twimg.com/media/DDD.jpg"></div>
      <div data-testid="tweetPhoto" data-rect-top="1600" id="p4b"><img src="https://pbs.twimg.com/media/EEE.jpg"></div>
    </article>
    <!-- 投稿の絵ではないもの（profile_images＝アバター）と、投稿の主題と言うには小さすぎる枠。
         どちらも保存を申し出てはいけない。 -->
    <article data-testid="tweet" id="p5">
      <a href="/erin/status/555"><time datetime="2026-07-01T00:00:00Z">5h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2000" id="p5a"><img src="https://pbs.twimg.com/profile_images/FFF.jpg"></div>
    </article>
    <article data-testid="tweet" id="p6">
      <a href="/frank/status/666"><time datetime="2026-07-01T00:00:00Z">6h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2400" data-rect-size="60" id="p6a"><img src="https://pbs.twimg.com/media/GGG.jpg"></div>
    </article>
    <!-- メディアタブのタイル（/<user>/media のグリッド）: article も testid も無く、
         自分の /status/ アンカーの数段上に素の <li> があるだけ。アンカーが <img> を直に包む（#349）。 -->
    <li id="p7">
      <div><div><div>
        <a href="/gina/status/777/photo/1"><img data-rect-top="2800" src="https://pbs.twimg.com/media/HHH.jpg"></a>
      </div></div></div>
    </li>
    <!-- 同じ投稿(777)の動画タイル: サムネが別の CDN パスにあるので、上の写真タイル経由で
         投稿が保存済みになっても、こちらは黙ったままでなければならない。 -->
    <li id="p8">
      <div><div><div>
        <a href="/gina/status/777/video/2"><img data-rect-top="3200" src="https://pbs.twimg.com/amplify_video_thumb/III.jpg"></a>
      </div></div></div>
    </li>
    <!-- 再生が始まった動画投稿（#450）: X は poster の <img> を <video poster> に
         差し替えたきり戻さないので、ホバーできる状態の動画投稿は必ずこの形。 -->
    <article data-testid="tweet" id="p9">
      <a href="/heidi/status/999"><time datetime="2026-07-01T00:00:00Z">9h</time></a>
      <div data-testid="videoPlayer" data-rect-top="3600" id="p9a"><video poster="https://pbs.twimg.com/amplify_video_thumb/999/img/JJJ.jpg"></video></div>
    </article>
    <!-- もう1つの2枚投稿。ライブラリが「どの絵を持っているか」まで答えられる場合を見る（#334）＝
         p4 は「投稿は保存済み・絵は不明」の側なので、答えの出た投稿へは二度と問い合わせない
         （スクロールで戻るのをタダにする設計）以上、別の投稿でなければ試せない。 -->
    <article data-testid="tweet" id="p10">
      <a href="/ivan/status/1010"><time datetime="2026-07-01T00:00:00Z">10h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="4000" id="p10a"><img src="https://pbs.twimg.com/media/KKK.jpg"></div>
      <div data-testid="tweetPhoto" data-rect-top="4400" id="p10b"><img src="https://pbs.twimg.com/media/LLL.jpg"></div>
    </article>
    <!-- 「絵は保存できたが投稿情報が取れなかった」（partial）を試すためだけの投稿。
         最後まで未保存で残しておく必要があるので、他のどの describe も触らない。 -->
    <article data-testid="tweet" id="p11">
      <a href="/judy/status/1111"><time datetime="2026-07-01T00:00:00Z">11h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="4800" id="p11a"><img src="https://pbs.twimg.com/media/MMM.jpg"></div>
    </article>
    <!-- #576: ホバー保存だけホストの版ずれ案内（#205）が乗っていなかった配線漏れを試す
         専用の投稿。p11 と同じ理由で、保存済みにしてしまうと保存ボタンが消えるので
         このテストの最後まで他のどの describe も触らない。 -->
    <article data-testid="tweet" id="p12">
      <a href="/kevin/status/1212"><time datetime="2026-07-01T00:00:00Z">12h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="5200" id="p12a"><img src="https://pbs.twimg.com/media/NNN.jpg"></div>
    </article>
    <!-- 同じく#576: 版が一致している（hostSkew: null）ときに誤警報が出ないことは
         p12 とは別の未保存の絵で見る＝p12 は上のテストで保存済みになってしまう。 -->
    <article data-testid="tweet" id="p13">
      <a href="/laura/status/1313"><time datetime="2026-07-01T00:00:00Z">13h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="5600" id="p13a"><img src="https://pbs.twimg.com/media/OOO.jpg"></div>
    </article>
    <!-- テキストのみの投稿（#575）: mediaIn が何も返さない形。投稿要素自身とアバターが
         それぞれ自分の幾何を持つ＝印は投稿要素を足場に、アバターの左下へ置かれる。 -->
    <article data-testid="tweet" id="p14" data-rect-top="6000" data-rect-size="120">
      <div data-testid="Tweet-User-Avatar" data-rect-top="6012" data-rect-size="40" id="p14avatar"></div>
      <a href="/kim/status/1414"><time datetime="2026-07-01T00:00:00Z">14h</time></a>
    </article>
  </div>
</body></html>`;

// runScripts:'outside-only' で下の window.eval に本物のスクリプト文脈を与える
// （ページ自身の <script> は不活性のまま。フィクスチャには無い）
const dom = new JSDOM(X_HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
const { window } = dom;

const animatedElements = new Set<any>();
const animationFrames = new Map<number, any>();
const observed = new Set<any>();
const sent: any[] = [];
const storage: Record<string, unknown> = {};
const storageListeners: any[] = [];
const runtimeListeners: any[] = [];
let ioCallback: any = null;
// ホストの応答と同じ形（#334）＝投稿ごとに captureId ＋その投稿の保存済みの絵。
// media が空＝「保存済み・絵は分からない」で、オーバーレイは投稿まるごととして扱う。
type SavedEntry = { id: string; media: Array<string | null> };
let savedAnswer: Record<string, SavedEntry | null> = {};
let saveReply: any = { ok: true, metaOk: true };

const intersect = (ids: string[], isIntersecting: boolean) => ioCallback(ids.map((id) => ({ target: window.document.getElementById(id), isIntersecting })));
const setSetting = (key: string, value: unknown) => {
  storage[key] = value;
  for (const fn of storageListeners) fn({ [key]: { newValue: value } }, 'local');
};

// 小型コントロールは投稿の部分木に残る（#44 は固定レイヤーへ移していない＝スクロール
// 追従とホストの重ね順を壊すため）ので、素の document から拾えるままでよい。拾えるのは
// ホスト要素 `<hologram-corner-control>` で、円そのものはその ShadowRoot の中にある
// （#310＝部分木に居たままホスト CSS から隔離する）。
const controls = (): any[] => Array.from(window.document.querySelectorAll('[data-hologram-overlay]'));
// ホスト要素から円へ。見た目・タブ順・読み上げ名を見るテストは全部こちら側。
const disc = (el: any): any => el?.shadowRoot?.firstElementChild ?? el;
const labelOf = (el: any): string | null => disc(el)?.getAttribute('aria-label');
// 一方で、失敗を伝える上部バナーは共有の ShadowRoot の中（ui-root.ts）。
const saveBanners = (): any[] => Array.from((window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot?.querySelectorAll('[data-hologram-save-banner]') || []);
// 面はホスト要素の data-hologram-face で名指しされている（#310）＝ローカライズされた
// 文言に依存せずに「どの顔か」を聞ける。文言そのものは別のテストが見る。
const marks = () => controls().filter((el) => el.getAttribute('data-hologram-face') === 'mark');
const saveButtons = () => controls().filter((el) => el.getAttribute('data-hologram-face') === 'save');
const settle = () => new Promise((r) => setTimeout(r, 400)); // 300ms の問い合わせデバウンスを越える

// overlay.ts はポインタが何の上にあるかを「座標」で決める（実際の pointermove は必ず
// clientX/clientY を運ぶ）。イベントがどの要素で起きたかでは決めない＝サイト自身のコントロールが
// 絵の上に重なっていても印やボタンが出る。ハーネスもそれに合わせ、メディア枠の中心を狙う。
const MEDIA_BOX = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]';
const boxOf = (id: string) => {
  const el = window.document.getElementById(id);
  if (el.matches(MEDIA_BOX)) return el;
  return el.querySelector(MEDIA_BOX) || el.querySelector('img') || el; // メディアタブの li は <img> 自体が枠、テキストのみの投稿（#575）は投稿要素自身が枠
};
const controlOf = (id: string) => controls().filter((el) => el.parentElement === boxOf(id));
const pointerMove = (target: any, x: number, y: number) => {
  const e: any = new window.Event('pointermove', { bubbles: true });
  e.clientX = x;
  e.clientY = y;
  target.dispatchEvent(e);
};
const hover = (id: string) => {
  const box = boxOf(id);
  const r = box.getBoundingClientRect();
  pointerMove(box, r.left + r.width / 2, r.top + r.height / 2);
};
const hoverAway = () => pointerMove(window.document.getElementById('feed'), 900, 50); // どの枠よりも右＝何の上でもない
// #323: 保存ボタンと再試行はユーザーの押下でしか動かない。ページが投げられる版は
// pageClick 側で、そちらはガード自身のテストだけが使う。押下は円（ShadowRoot の中）へ
// 投げる＝ホスト要素へ投げたイベントは shadow tree に入らないので、ホスト側へ投げると
// 「押しても何も起きない」がガードのおかげか経路違いか分からなくなる。
const pageClick = (el: any) => disc(el).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const click = (el: any) => disc(el).dispatchEvent(asUser(new window.MouseEvent('click', { bubbles: true })));
const rectTop = (sel: string, top: string) => window.document.querySelector(sel)?.setAttribute('data-rect-top', top);

beforeAll(async () => {
  // jsdom が実装しないブラウザ側の部品を、overlay.ts が使う最小限だけ埋める。
  // レイアウトが無く全ての矩形がゼロ（overlay.ts はそれを「小さすぎて印を出せない」と正しく読む）
  // ので、フィクスチャが自分で幾何を宣言する＝data-rect-top を持つ要素はその位置の正方形。
  window.Element.prototype.animate = function () {
    animatedElements.add(this);
    return { cancel() {}, finish() {} };
  };
  window.Element.prototype.getBoundingClientRect = function () {
    const declared = this.getAttribute?.('data-rect-top');
    if (declared === null || declared === undefined) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    const top = Number(declared);
    const size = Number(this.getAttribute('data-rect-size') || 300);
    return { left: 50, top, right: 50 + size, bottom: top + size, width: size, height: size, x: 50, y: top };
  };
  let nextAnimationFrame = 1;
  window.requestAnimationFrame = (fn) => {
    const id = nextAnimationFrame++;
    animationFrames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => animationFrames.delete(id);

  // 注意: jsdom は要素で発火したイベントの伝播経路に Window を入れない＝`window` に
  // 登録した capture フェーズのリスナはこのハーネスでは決して呼ばれない（ブラウザでは呼ばれる）。
  // overlay.ts の load / pointer ハンドラと同じく `document` で聞くこと。

  // IntersectionObserver: 可視状態はテストが手で動かす
  window.IntersectionObserver = class {
    constructor(cb: any) {
      ioCallback = cb;
    }
    observe(el: any) {
      observed.add(el);
    }
    unobserve(el: any) {
      observed.delete(el);
    }
    disconnect() {
      observed.clear();
    }
  } as any;

  // chrome API のスタブ。`sent` に全メッセージを記録して、checkSaved が投稿ごとでなく
  // バッチで出ていること、保存ボタンがドラッグ経路の imageDragged を再利用していることを見る。
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      sendMessage: (msg: any, cb: any) => {
        sent.push(msg);
        if (msg.type === 'imageDragged') {
          cb?.(saveReply);
          return;
        }
        const results: Record<string, SavedEntry | null> = {};
        for (const u of msg.urls || []) results[u] = Object.hasOwn(savedAnswer, u) ? savedAnswer[u] : null;
        cb?.({ ok: true, results });
      },
      onMessage: {
        addListener: (fn: any) => runtimeListeners.push(fn),
        removeListener: (fn: any) => {
          const i = runtimeListeners.indexOf(fn);
          if (i >= 0) runtimeListeners.splice(i, 1);
        },
      },
    },
    storage: {
      local: {
        // 本物の chrome.storage.local.get はキー1つでもリストでも取る＝overlay.ts は
        // 2つの設定を1回で読む
        get: (keys: any, cb: any) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of list) out[k] = storage[k];
          cb(out);
        },
        set: (obj: object) => Object.assign(storage, obj),
      },
      onChanged: { addListener: (fn: any) => storageListeners.push(fn) },
    },
  } as any;

  // 常駐コンテンツスクリプトのバンドルは、Chrome が読むのと同じ WXT の出力そのもの
  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3', 'content-scripts', 'resident.js'), 'utf8'));
}, 30000);

test('初回走査で全ての投稿が観測される', () => {
  expect(observed.size).toBe(14); // p1〜p14（#576 で p12/p13、#575 で p14 を追加）
});

describe('問い合わせは見えている投稿だけ・1バッチで', () => {
  beforeAll(async () => {
    savedAnswer = { 'https://x.com/alice/status/111': { id: '1780000000000-aa', media: [] } };
    intersect(['p1', 'p2'], true);
    await settle();
  });

  test('投稿ごとではなく1回のバッチ', () => {
    expect(sent).toHaveLength(1);
  });

  test('バッチが両方のパーマリンクを運ぶ', () => {
    expect(sent[0].urls.sort()).toEqual(['https://x.com/alice/status/111', 'https://x.com/bob/status/222']);
  });

  test('送るのはパーマリンクであって正規化済みキーではない', () => {
    expect(sent[0].urls.every((u: string) => u.startsWith('https://x.com/'))).toBe(true);
  });
});

describe('savedBadgeMode の三値', () => {
  test('既定の always は、ポインタがどこにも無くても保存済みを印す', () => {
    expect(marks()).toHaveLength(1);
    expect(marks()[0].parentElement).toBe(boxOf('p1'));
  });

  test('hover へ切り替えると常時の印は消える', () => {
    setSetting('savedBadgeMode', 'hover');
    expect(controls()).toHaveLength(0);
  });

  test('保存済みの投稿にポインタを乗せると印が出る', () => {
    hover('p1');
    expect(marks()).toHaveLength(1);
  });

  test('印は写真の内側に置かれ、メディア枠が位置決めの親になる', () => {
    expect(marks()[0].parentElement).toBe(boxOf('p1'));
    expect(marks()[0].style.left).toBe('6px');
    expect(marks()[0].style.top).toBe('6px');
    expect((boxOf('p1') as any).style.position).toBe('relative');
  });

  test('コントロールは操作可能（pointer-events を殺していない）', () => {
    expect((marks()[0] as any).style.pointerEvents).not.toBe('none');
  });

  // 「押せる面か」で分ける分岐（#536）の、押せない側。報告するだけの面は素の div の
  // まま＝タブ順にも入らない。読み上げ名は持つ（事実を述べる図形として）。
  test('報告するだけの印はタブ順に入らない', () => {
    expect(disc(marks()[0]).tagName).toBe('DIV');
    expect(disc(marks()[0]).tabIndex).toBe(-1);
    expect(disc(marks()[0]).getAttribute('role')).toBe('img');
  });

  // #310: 説明はブラウザのツールチップ（title）で出さない＝拡張が描く他の面と別系統に
  // なる上、キーボードとタッチには最初から届いていなかった。残すのは読み上げ名だけ。
  test('印は title を持たず、読み上げ名だけを持つ', () => {
    expect(marks()[0].hasAttribute('title')).toBe(false);
    expect(disc(marks()[0]).hasAttribute('title')).toBe(false);
    expect(labelOf(marks()[0])).toBe('Saved in Hologram');
  });

  // #310: 部分木に居たままホスト CSS から隔離する＝円はホスト要素の ShadowRoot の中で、
  // ページ側の CSS はセレクタが届かない。境界そのものの数値検査は e2e-extension-hostile-css。
  test('円はホスト要素の ShadowRoot の中にある', () => {
    expect(marks()[0].tagName.toLowerCase()).toBe('hologram-corner-control');
    expect(marks()[0].shadowRoot).toBeTruthy();
    expect(disc(marks()[0]).parentNode).toBe(marks()[0].shadowRoot);
  });
});

// コントロールはメディア枠の中にあるのでスクロールでは同じ合成操作の中で一緒に動く＝
// 座標を書き直す必要が無い。そして「絵の中でスクロールした」（読みながらホイールを前後に振った）
// のは絵がポインタから離れたことではないので、コントロールを消してはいけない（#347）
describe('スクロール中の追従（#347）', () => {
  test('見えているコントロールはスクロール中もメディアに付いたまま', () => {
    rectTop('#p1 [data-testid="tweetPhoto"]', '40');
    window.dispatchEvent(new window.Event('scroll'));

    expect(marks()[0]?.parentElement).toBe(boxOf('p1'));
    expect(marks()[0].style.top).toBe('6px');
    expect(animationFrames.size).toBe(0);
  });

  test('ホバー中の絵の中でスクロールしてもコントロールは残る', async () => {
    await new Promise((r) => setTimeout(r, 120)); // スクロールの落ち着きを越える
    expect(marks()[0]?.parentElement).toBe(boxOf('p1'));
  });

  // p1 がポインタから外れ、p2 がその下へ来るところまでスクロールした状態。
  // コントロールは p1 と一緒に去り、動いていないポインタが「p2 が下に来ただけ」で
  // p2 を選んではいけない。
  test('動いていないポインタは、スクロールで下に来た次の絵を選ばない', () => {
    rectTop('#p1 [data-testid="tweetPhoto"]', '-300');
    rectTop('#p2 [data-testid="tweetPhoto"]', '100');
    window.dispatchEvent(new window.Event('scroll'));

    // レイアウトが動いてポインタの下に p2 が来た時、Pointer Events はこの境界イベントを
    // 要求する。これを「意図的なホバー移動」と数えてはいけない。
    const layoutBoundary: any = new window.Event('pointerover', { bubbles: true });
    layoutBoundary.clientX = 200;
    layoutBoundary.clientY = 250;
    boxOf('p2').dispatchEvent(layoutBoundary);

    expect(controlOf('p2')).toHaveLength(0);
  });

  test('ポインタから外れて行った絵のコントロールは消える', async () => {
    await new Promise((r) => setTimeout(r, 120));
    expect(controls()).toHaveLength(0);

    rectTop('#p1 [data-testid="tweetPhoto"]', '100');
    rectTop('#p2 [data-testid="tweetPhoto"]', '400');
    hoverAway();
  });
});

// このファイルが存在する理由そのもの: 絵の上に重なった「別の要素」（Bluesky の ALT/オーバーレイ
// div、pixiv のブックマークのハート）に物理的に当たったポインタも、絵をホバーしていると
// 数えなければならない＝判定は座標であって、当たった要素から親を辿ることではない。
test('絵の上に重なった別要素の上でも、絵をホバーしていると数える', () => {
  const p1box = boxOf('p1').getBoundingClientRect();
  // #feed（枠でもその子孫でもない）で発火させ、座標だけ p1 の枠内にする
  pointerMove(window.document.getElementById('feed'), p1box.left + p1box.width / 2, p1box.top + p1box.height / 2);

  expect(marks()).toHaveLength(1);
  hoverAway();
});

describe('always / off', () => {
  test('always はポインタ無しで印す', () => {
    setSetting('savedBadgeMode', 'always');
    expect(marks()).toHaveLength(1);
  });

  test('off は何も出さず、ホバーでも覆らない', () => {
    setSetting('savedBadgeMode', 'off');
    expect(controls()).toHaveLength(0);

    hover('p1');
    expect(marks()).toHaveLength(0);

    hoverAway();
    setSetting('savedBadgeMode', 'hover');
  });
});

describe('答えのキャッシュ', () => {
  test('一度答えた投稿は、戻ってきても再問い合わせしない', async () => {
    intersect(['p1', 'p2'], false);
    await settle();
    intersect(['p1'], true);
    await settle();

    expect(sent).toHaveLength(1);
  });

  test('印はキャッシュした答えから戻る', () => {
    hover('p1');
    expect(marks()).toHaveLength(1);
    hoverAway();
  });
});

describe('保存ボタン', () => {
  beforeAll(async () => {
    intersect(['p2'], true);
    await settle();
    hover('p2');
  });

  test('未保存の絵を指すと即座に保存を申し出る', () => {
    expect(saveButtons()).toHaveLength(1);
  });

  test('静止した単色グリフだけの native button で、読み上げ名を持つ', () => {
    const b = disc(saveButtons()[0]);

    expect(b.tagName).toBe('BUTTON');
    // 4つの面（マーク・保存・進行中・再試行）は同じ寸法＝押した瞬間に角が縮まない。
    expect(b.style.width).toBe('24px');
    expect(b.style.background).toBe('var(--hologram-control-surface)');
    // #310: 影はカード面と共有をやめ、24px 専用のトークンを持つ。
    expect(b.style.boxShadow).toBe('var(--hologram-control-shadow)');
    expect(b.getAttribute('aria-label')).toBe('Save image');
    // 押せる面は必ずタブ順に入る（#536）＝グリフだけのボタンなので、名前と focus の
    // どちらが欠けてもキーボードとスクリーンリーダーからは無いものになる。
    expect(b.tabIndex).toBe(0);
    expect(b.textContent).toBe('');
    expect(animatedElements.has(b)).toBe(false);
  });

  // #310: 押せる面も title を持たない＝押せるかどうかは読み上げ名とカーソルが言う。
  test('保存ボタンも title を持たない', () => {
    expect(disc(saveButtons()[0]).hasAttribute('title')).toBe(false);
    expect(saveButtons()[0].hasAttribute('title')).toBe(false);
    expect(disc(saveButtons()[0]).style.cursor).toBe('pointer');
  });

  test('ホバーは状態色を足さずに見分けをつける', () => {
    const b = disc(saveButtons()[0]);
    b.dispatchEvent(new window.Event('pointerenter'));

    // 状態色ではなく面の色＋ハロー＋拡大だけ。ホバーでも半透明のままである
    // ことが要点＝保存済みマークと同じ透明度に揃えた（ユーザー判断・2026-07-29）
    // ので、ホバーで不透明へ戻すと写真を透かす意味が消える。
    expect(b.style.background).toBe('var(--hologram-control-surface-hover)');
    expect(b.style.transform).toBe('scale(1.04)');

    b.dispatchEvent(new window.Event('pointerleave'));
  });

  // #323: この角はページ自身の DOM の中に置かれている（絵の子＝ui-root.ts の但し書き）
  // ので、ページ側スクリプトから見つけてクリックできる。押せば確認も何も無く保存が
  // 走る面なので、ユーザーの押下でなければ何も起きない。
  test('ページが投げた合成クリックでは保存しない（#323）', () => {
    const before = sent.length;
    pageClick(saveButtons()[0]);

    expect(sent.slice(before)).toHaveLength(0);
    expect(saveButtons()).toHaveLength(1); // まだ申し出たまま＝進行中にすらならない
  });

  describe('押したとき', () => {
    let save: any;

    beforeAll(() => {
      click(saveButtons()[0]);
      save = sent.at(-1);
    });

    test('ドラッグ保存の経路を再利用する（新しいメッセージを作らない）', () => {
      expect(save).toMatchObject({ type: 'imageDragged', platform: 'x' });
    });

    test('絵が属する投稿を保存する', () => {
      expect(save.postUrl).toBe('https://x.com/bob/status/222');
    });

    test('サムネだけでなく原寸の URL も渡す', () => {
      expect(save.imageUrls).toContain('https://pbs.twimg.com/media/BBB.jpg');
      expect(save.imageUrls.some((u: string) => u.includes('name=orig'))).toBe(true);
    });

    test('角は押下に保存済みの印で答える', () => {
      expect(marks()).toHaveLength(1);
      expect(saveButtons()).toHaveLength(0);
    });

    test('成功したホバー保存は上部バナーを出さない', () => {
      expect(saveBanners()).toHaveLength(0);
    });

    test('保存済みになったので、もう申し出ない', () => {
      hoverAway();
      hover('p2');

      expect(saveButtons()).toHaveLength(0);
      expect(marks()).toHaveLength(1);
      hoverAway();
    });
  });
});

describe('保存に失敗したとき', () => {
  let failed: any[];

  beforeAll(async () => {
    saveReply = { ok: false, errorKind: 'host-unavailable', error: 'Error when communicating with the native messaging host.' };
    intersect(['p4'], true);
    await settle();
    hover('p4a');
    await settle();
    click(saveButtons()[0]);
    failed = controlOf('p4a');
  });

  // #310: 24px の円は「押せば再試行できる」だけを言う。長い復旧案内（診断ページへの
  // 誘導）は同じ文面のままバナーが持つ＝幅も role="alert" も在る面。
  test('角は再試行できることを言い、復旧案内は載せない', () => {
    expect(failed).toHaveLength(1);
    expect(labelOf(failed[0])).toBe('Save failed. Press to retry');
    expect(labelOf(failed[0])).not.toContain('diagnostics');
    expect(failed[0].hasAttribute('title')).toBe(false);
    expect(disc(failed[0]).hasAttribute('title')).toBe(false);
  });

  test('上部バナーも読める文面で、生のエラーを漏らさない', () => {
    const banners: any[] = saveBanners();

    expect(banners).toHaveLength(1);
    expect(banners[0].getAttribute('role')).toBe('alert');
    expect(banners[0].textContent).toBe("Hologram's saver could not start. Open the diagnostics page from the extension settings.");
    expect(banners[0].textContent).not.toContain('Error when communicating');
  });

  // 再試行は「押せば即その場で回復できる」唯一の手段なので、ポインタしか届かない状態は
  // 回復手段そのものの欠落（#536）。名前は「再試行」という語を含む専用文言（#310）。
  test('再試行の面は保存ボタンと同じくキーボードで到達でき、読み上げ名を持つ', () => {
    expect(disc(failed[0]).tagName).toBe('BUTTON');
    expect(disc(failed[0]).tabIndex).toBe(0);
    expect(labelOf(failed[0])).toContain('retry');
  });

  test('失敗表示を押すと何も起きないのではなく再試行する', () => {
    const before = sent.length;
    click(failed[0]);

    expect(sent).toHaveLength(before + 1);
    expect(sent.at(-1).type).toBe('imageDragged');
  });

  test('しばらくするとボタンへ戻り、やり直せる', async () => {
    await new Promise((r) => setTimeout(r, 2700)); // 失敗表示の滞留時間を越える

    expect(saveButtons()).toHaveLength(1);
    saveReply = { ok: true, metaOk: true };
    hoverAway();
  });
});

describe('絵ごとに1ボタン・投稿ごとに1印', () => {
  test('同じ投稿の2枚目も自分のボタンを持つ', async () => {
    hover('p4b');
    await settle();

    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p4b'));
    hoverAway();
  });

  // 絵が分からない答え（テキストのみ・取り込みの失敗・#334 より前のレコード）は
  // 投稿についてしか語れない＝印は1つ、ボタンは出さない。
  test('絵の分からない保存済み投稿は、1枚目にだけ印が付く', async () => {
    savedAnswer['https://x.com/dave/status/444'] = { id: '1780000000004-dd', media: [] };
    intersect(['p4'], false);
    await settle();
    intersect(['p4'], true);
    await settle();
    setSetting('savedBadgeMode', 'always');

    const p4Controls = [...controlOf('p4a'), ...controlOf('p4b')];
    expect(p4Controls).toHaveLength(1);
    expect(p4Controls[0].parentElement).toBe(boxOf('p4a'));
  });

  // 失敗の文面は失敗より長生きしない。#310 以降そもそも角に文面を持ち越さない
  // （理由は失敗の瞬間にバナーが言い切る）ので、印は常に自分の名前だけを持つ。
  test('印は前の失敗の文面を引きずらない', () => {
    expect(labelOf(controlOf('p4a')[0])).toBe('Saved in Hologram');
    setSetting('savedBadgeMode', 'hover');
  });
});

// #334: 複数枚投稿の1枚だけを保存した状態が普通に起こる。答えが絵まで届いている限り、
// 角は絵ごとに違う顔を見せる＝保存済みには印、まだの絵には保存ボタン。
describe('1枚だけ保存された投稿', () => {
  beforeAll(async () => {
    // ライブラリが持っているのは2枚目（LLL）だけ。URL の表記は保存時のもの（name=orig）で、
    // ページ側の src（拡張子つき）とは文字列として一致しない＝正規化された同一性で照合する。
    savedAnswer['https://x.com/ivan/status/1010'] = { id: '1780000000010-jj', media: ['https://pbs.twimg.com/media/LLL?format=jpg&name=orig'] };
    intersect(['p10'], true);
    await settle();
    setSetting('savedBadgeMode', 'always');
  });

  afterAll(async () => {
    setSetting('savedBadgeMode', 'hover');
    intersect(['p10'], false);
    await settle();
  });

  test('保存済みの絵にだけ印が付く（1枚目ではなく、その絵に）', () => {
    expect(controlOf('p10a')).toHaveLength(0);
    expect(controlOf('p10b')).toHaveLength(1);
    expect(labelOf(controlOf('p10b')[0])).toBe('Saved in Hologram');
  });

  test('まだの絵にはホバーで保存ボタンが出る', async () => {
    hover('p10a');
    await settle();

    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p10a'));
    hoverAway();
  });

  test('保存済みの絵にホバーしてもボタンにはならない', async () => {
    hover('p10b');
    await settle();

    expect(saveButtons()).toHaveLength(0);
    expect(labelOf(controlOf('p10b')[0])).toBe('Saved in Hologram');
    hoverAway();
  });

  // 同じタブの別経路（ドラッグ保存）で1枚増えた通知。投稿まるごと保存済みとして読むと、
  // 残りの絵のボタンが次の問い合わせまで消える。
  test('savedUpdate が運ぶ絵だけが追加される', () => {
    for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/ivan/status/1010', media: ['https://pbs.twimg.com/media/KKK?format=jpg&name=orig'] });

    expect(controlOf('p10a')).toHaveLength(1);
    expect(labelOf(controlOf('p10a')[0])).toBe('Saved in Hologram');
    expect(controlOf('p10b')).toHaveLength(1);
  });
});

describe('申し出るかどうかの関門', () => {
  beforeAll(async () => {
    intersect(['p5', 'p6'], true);
    await settle();
  });

  test('アバターを投稿の絵として申し出ない', async () => {
    hover('p5');
    await settle();

    expect(controls()).toHaveLength(0);
    hoverAway();
  });

  test('投稿の主題と言うには小さすぎる絵は申し出ない', async () => {
    hover('p6');
    await settle();

    expect(controls()).toHaveLength(0);
    hoverAway();
  });
});

test('同じタブの別経路で保存されたら、スクロールを待たずに印が点く', async () => {
  savedAnswer['https://x.com/carol/status/333'] = { id: '1780000000002-cc', media: [] };
  intersect(['p3'], true);
  await settle();

  for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/carol/status/333' });
  rectTop('#p3 [data-testid="tweetPhoto"]', '800');
  hover('p3');

  expect(marks()).toHaveLength(1);
  expect(marks()[0].parentElement).toBe(boxOf('p3'));
  expect(marks()[0].style.top).toBe('6px');
  hoverAway();
});

describe('ボタンを切っても印は残る', () => {
  beforeAll(() => setSetting('hoverSaveButton', false));

  test('ボタン off では未保存の絵に何も出さない', async () => {
    hover('p6');
    await settle();

    expect(controls()).toHaveLength(0);
    hoverAway();
  });

  test('印はボタン off でも働く', () => {
    hover('p1');
    expect(marks()).toHaveLength(1);

    hoverAway();
    setSetting('hoverSaveButton', true);
  });
});

// #349: article も testid も無い素の <li>。<img> が枠の場合、コントロールは直近の親
// （ここでは <img> を包む <a>）へ載る＝他の <img> 枠のプラットフォームと同じ。
describe('メディアタブのグリッドタイル（#349）', () => {
  beforeAll(async () => {
    intersect(['p7', 'p8'], true);
    await settle();
  });

  test('未保存の画像タイルは保存を申し出る', async () => {
    hover('p7');
    await settle();

    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p7').parentElement);
    hoverAway();
  });

  // #372 まで、動画・GIF タイルのサムネは投稿メディア判定を通らず、格子の中でここだけが
  // 無反応だった。判定が *_video_thumb を含むようになった今は、写真タイルと同じに答える。
  test('動画タイルも保存を申し出る', async () => {
    hover('p8');
    await settle();

    const p8Controls = controls().filter((el) => el.parentElement === boxOf('p8') || el.parentElement === boxOf('p8').parentElement);
    expect(p8Controls).toHaveLength(1);
    expect(labelOf(p8Controls[0])).toBe('Save image');
    hoverAway();
  });

  describe('グリッドタイルから保存する', () => {
    let gridSave: any;

    beforeAll(async () => {
      hover('p7');
      await settle();
      click(saveButtons()[0]);
      gridSave = sent.at(-1);
    });

    test('ドラッグ保存の経路を再利用する', () => {
      expect(gridSave).toMatchObject({ type: 'imageDragged', platform: 'x' });
    });

    test('パーマリンクから photo/N の接尾辞を落とす', () => {
      expect(gridSave.postUrl).toBe('https://x.com/gina/status/777');
    });

    test('タイルが保存済みとして読めるようになる', () => {
      expect(marks()).toHaveLength(1);
      expect(marks()[0].parentElement).toBe(boxOf('p7').parentElement);
      hoverAway();
    });

    // p8 は同じ投稿(777)の動画タイル。押下でその場に印が点くのは押した枠だけ（他の枠は
    // background からの savedUpdate で追随する）＝押した直後はまだ申し出たままで正しい。
    const p8Controls = () => controls().filter((el) => el.parentElement === boxOf('p8') || el.parentElement === boxOf('p8').parentElement);

    test('別の枠の押下だけでは、動画タイルの申し出は変わらない', () => {
      hover('p8');

      expect(p8Controls()).toHaveLength(1);
      expect(labelOf(p8Controls()[0])).toBe('Save image');
      hoverAway();
    });

    // 印が答えるのは投稿単位の「持っているか」なので、保存が通知された時点で
    // 同じ投稿の動画タイルも同じ答えを返す。
    test('保存が通知されたら、同じ投稿の動画タイルも保存済みとして読める', () => {
      for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/gina/status/777' });
      hover('p8');

      expect(p8Controls()).toHaveLength(1);
      expect(labelOf(p8Controls()[0])).toBe('Saved in Hologram');
      hoverAway();
    });
  });
});

// #450: タイムラインの動画投稿は、プレイヤーが動き出した時点で <img> を失う。
// 枠の中に <video> しか無くても、ポスターを手掛かりに同じ答えを返さなければ
// 「ホバーできる動画には必ずボタンが出ない」になる。
describe('再生中の動画投稿（#450）', () => {
  beforeAll(async () => {
    intersect(['p9'], true);
    await settle();
    hover('p9a');
    await settle();
  });

  test('<img> が無くても保存を申し出る', () => {
    expect(saveButtons()).toHaveLength(1);
    expect(saveButtons()[0].parentElement).toBe(boxOf('p9a'));
  });

  test('押すと poster の URL を、その投稿のものとして渡す', () => {
    click(saveButtons()[0]);
    const save = sent.at(-1);

    expect(save).toMatchObject({ type: 'imageDragged', platform: 'x', postUrl: 'https://x.com/heidi/status/999' });
    expect(save.imageUrls).toContain('https://pbs.twimg.com/amplify_video_thumb/999/img/JJJ.jpg');
    hoverAway();
  });
});

// #310: 「保存はできたが投稿の文章と投稿者は取れなかった」は、成功でも失敗でもない
// 結果で、角がそれを言う場所は無い（24px の円に文が入らない）。以前は印の title に
// 入れていた＝1秒ホバーしないと出ず、キーボードとタッチには最初から届いていなかった。
// 今はその瞬間にバナーの琥珀（partial）で言い切る。素の成功は今までどおり無言。
describe('投稿情報が取れなかった保存（#310）', () => {
  beforeAll(async () => {
    saveReply = { ok: true, metaOk: false, metaReason: 'protected' };
    intersect(['p11'], true);
    await settle();
    hover('p11a');
    await settle();
    click(saveButtons()[0]);
  });

  afterAll(() => {
    saveReply = { ok: true, metaOk: true };
    hoverAway();
  });

  // 直近のバナーを見る＝退場アニメーションは Web Animations なので、それを潰している
  // このハーネスでは前の失敗バナーの要素が DOM に残ったままになる（実ブラウザでは消える）。
  test('バナーが理由つきで出る', () => {
    const banner: any = saveBanners().at(-1);

    expect(banner.dataset.state).toBe('partial');
    expect(banner.textContent).toBe('Saved (post info unavailable: private account)');
  });

  test('角そのものは印のまま＝長い文面を載せない', () => {
    expect(labelOf(controlOf('p11a')[0])).toBe('Saved in Hologram');
    expect(controlOf('p11a')[0].hasAttribute('title')).toBe(false);
  });
});

// #576: #205 が用意した「ホストの版がずれている」案内は、Alt+S（capture-overlay.test.ts）と
// ドロップゾーン（drag-zone.test.ts）には配線されていたが、保存の出口3本目であるホバー保存
// （このファイル）だけが一度も showSaveBanner に渡していなかった。文言・緊急度（partial ＝
// 琥珀、他の成功文面より前）は他の2経路と同じものを #205 からそのまま使う。
describe('ホストの版がずれているときの案内（#205 の配線漏れ・#576）', () => {
  beforeAll(async () => {
    saveReply = { ok: true, metaOk: true, grouped: 0, hostSkew: 'host-old' };
    intersect(['p12'], true);
    await settle();
    hover('p12a');
    await settle();
    click(saveButtons()[0]);
  });

  afterAll(() => {
    saveReply = { ok: true, metaOk: true };
    hoverAway();
  });

  test('保存できたことと更新の要求を同時に出す', () => {
    const banner: any = saveBanners().at(-1);

    expect(banner.dataset.state).toBe('partial');
    expect(banner.textContent).toBe('Saved — please update the Hologram app (it no longer matches this extension)');
  });

  test('角そのものは印のまま＝長い文面を載せない', () => {
    expect(labelOf(controlOf('p12a')[0])).toBe('Saved in Hologram');
  });
});

// 誤警報が無いこと＝版が一致している（もしくはまだどのホストからも答えを聞いていない）
// ときは、他の成功と同じく黙ったまま。バナー数を絶対値0で比べないのはこのハーネスの
// 都合＝StatusSurface の退場は Web Animations の finish イベントで消えるが、この
// スイートの animate() スタブは onfinish を呼ばない（drag-zone.test.ts と違い、この
// ファイルは他の場面でアニメの発火自体を見る必要があるため）ので、直前の describe が
// 出したバナーは実ブラウザと違って DOM に残ったまま。そのため「このアクションの前後で
// バナーの個数が増えていないこと」を見る＝新しいバナーが1つも足されなければ、この
// アクションは黙っていたと言える。
describe('版が一致しているときは誤警報を出さない', () => {
  let before: number;

  beforeAll(async () => {
    before = saveBanners().length;
    saveReply = { ok: true, metaOk: true, grouped: 0, hostSkew: null };
    intersect(['p13'], true);
    await settle();
    hover('p13a');
    await settle();
    click(saveButtons()[0]);
  });

  test('バナーが増えない（誤警報が出ない）', () => {
    expect(saveBanners().length).toBe(before);
  });
});

// #311: Alt+S saves exactly what chrome.tabs.captureVisibleTab sees — a real
// screenshot bakes in whatever is drawn on screen, this file's corner controls
// included, unless something hides them first. capture.ts (a separate content
// script sharing this same isolated world) does that through
// window.__hologramPrepareOverlayForCapture — the same window-global signal
// __hologramAutoCapture / __snsPostSaveCleanup already use to cross between
// the two files.
describe('撮影退避フック（#311）', () => {
  // このスイートは1ページを通しで動かすため、この時点で保存ボタンが残っている
  // 投稿はもう無い（どの投稿もどこかの describe で保存済みにされた）。フックが
  // 見るのは「印」「保存ボタン」という区別ではなく共通の data-hologram-overlay
  // 属性1本なので、印（p1）に加えて同じ属性を持つだけの素の要素で確かめれば、
  // ボタン面も同じ経路で退避されることが分かる。
  let synthetic: any;

  beforeAll(() => {
    setSetting('savedBadgeMode', 'always'); // p1 の印を確実に出す
    synthetic = window.document.createElement('button');
    synthetic.setAttribute('data-hologram-overlay', '');
    synthetic.style.display = 'flex';
    window.document.body.appendChild(synthetic);
  });

  afterAll(() => {
    synthetic.remove();
    setSetting('savedBadgeMode', 'hover');
  });

  test('印・ボタン面の両方が画面上にある', () => {
    expect(controlOf('p1')).toHaveLength(1);
    expect(labelOf(controlOf('p1')[0])).toBe('Saved in Hologram');
    expect(synthetic.style.display).toBe('flex');
  });

  test('フックを呼ぶと両方 display:none になる', () => {
    const restore = window.__hologramPrepareOverlayForCapture?.() as () => void;

    expect(controlOf('p1')[0].style.display).toBe('none');
    expect(synthetic.style.display).toBe('none');
    restore();
  });

  test('返した復元関数で元の表示へ戻る', () => {
    const restore = window.__hologramPrepareOverlayForCapture?.() as () => void;
    restore();

    expect(controlOf('p1')[0].style.display).not.toBe('none');
    expect(synthetic.style.display).toBe('flex');
  });
});

// #575: mediaIn が何も返さない投稿（絵の枠が無い）。印は投稿要素自身を足場に、
// アバターの左端・下端の少し下へ置かれる。ボタンは出さない＝保存の手段は #122
// （右クリックメニュー）の担当のまま、本 Issue は「もう取り込んであるか」だけを答える。
describe('テキストのみの投稿（#575）', () => {
  test('未保存の間はホバーしても何も出さない（ボタンにならない）', async () => {
    intersect(['p14'], true);
    await settle();
    hover('p14');
    await settle();

    // p14 自身の枠だけを見る（controls() は他の投稿の一時的な face='flash' も拾う）。
    expect(controlOf('p14')).toHaveLength(0);
    hoverAway();
  });

  test('保存済みになるとホバーで印が出る。ボタンにはならない', async () => {
    savedAnswer['https://x.com/kim/status/1414'] = { id: '1780000000014-mm', media: [] };
    intersect(['p14'], false);
    await settle();
    intersect(['p14'], true);
    await settle();
    hover('p14');
    await settle();

    const p14Controls = controlOf('p14');
    expect(p14Controls).toHaveLength(1);
    expect(p14Controls[0].getAttribute('data-hologram-face')).toBe('mark');
    expect(labelOf(p14Controls[0])).toBe('Saved in Hologram');
  });

  // 投稿要素自身が足場（アバターの親をホストにできるほどアバターの箱が大きくない
  // ため）＝左端はアバターと揃え、上端はアバターの下端から少し離す。X の左上は
  // アバターそのもの、右上は⋯メニューが埋めているので、これが両方を避ける唯一の帯。
  test('位置は投稿要素を足場に、アバターの左端・下端のすぐ下', () => {
    const [mark] = controlOf('p14');
    expect(mark.style.left).toBe('0px');
    expect(mark.style.top).toBe('58px');
    hoverAway();
  });
});
