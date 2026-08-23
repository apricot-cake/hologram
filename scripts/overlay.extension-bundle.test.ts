// extension/utils/overlay.ts＝タイムラインのオーバーレイの、オフラインで走る純粋な単体
// テスト（#54 の「保存済み」の印を #309 の3値設定で出し分け、#94 のホバー保存ボタンを出す）。
// ビルド済みのコンテンツスクリプトを jsdom の中で走らせる。実際に注入されるときと同じ
// グローバル（glass-ui.js / site-detect.js / media-identity.js を同じ window で manifest の
// 順に評価）と、スタブの chrome API の下で動かす。
//
// ここで見るのはスクリプト自身の配線だ。どの投稿を問い合わせるか、それが1バッチか、答えと
// 設定が隅の表示を決めるか、保存ボタンが「正直に保存できる」場所にだけ出るか、押したときに
// ドラッグ＆ドロップと同じメッセージを送るか、投稿自身の部分木に手を付けずにおくか。
// ここで見ないのは、プラットフォームごとのセレクタが本物の X / Bluesky / pixiv の DOM に
// 実際に当たるかどうか（フィクスチャは手書きのマークアップなので、自分で書いたものを自分で
// 読めることしか示せない。content-fixtures.test.ts と同じ限界で、生きたカナリアは
// scripts/e2e-capture-test.cts）。
//
// このスイートは1つのページを順に動かすので、テストの宣言順に意味がある。
//
// 前提: 拡張機能のテスト用出力（extension/.output/chrome-mv3-test/...）が要る。

import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { asUser } from './lib-user-event.ts';

// #986: 待ちの取り決めを共有する。import ではなく require() で読むのは、lib-wait.cts が
// CommonJS モジュール（module.exports）で、このプロジェクトのバンドラの解決が名前付き
// エクスポートとして扱わないため。
const { neverHappens } = require('./lib-wait.cts');

// overlay.ts の x 分岐が狙う投稿の形。data-rect-top がメディアボックスの幾何を宣言し
// （jsdom は何もレイアウトしない）、data-rect-size がその大きさを絞る。
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
    <!-- p3 の写真にはまだ大きさが無い（data-rect-top が無い）＝折り返しより下にある遅延
         読み込みの画像。本物のタイムラインで、画像がレイアウトされる前に投稿の答えが
         返ってくる場面と同じ。 -->
    <article data-testid="tweet" id="p3">
      <a href="/carol/status/333"><time datetime="2026-07-01T00:00:00Z">3h</time></a>
      <div data-testid="tweetPhoto"><img id="lazy" src="https://pbs.twimg.com/media/CCC.jpg"></div>
    </article>
    <!-- 1つの投稿に画像2枚。保存ボタンは画像1枚に対して働くので、箱ごとに自分の錨を持つ -->
    <article data-testid="tweet" id="p4">
      <a href="/dave/status/444"><time datetime="2026-07-01T00:00:00Z">4h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="1200" id="p4a"><img src="https://pbs.twimg.com/media/DDD.jpg"></div>
      <div data-testid="tweetPhoto" data-rect-top="1600" id="p4b"><img src="https://pbs.twimg.com/media/EEE.jpg"></div>
    </article>
    <!-- 投稿の画像ではないもの（profile_images＝アバター）と、投稿の主役と呼ぶには小さ
         すぎる箱。どちらも保存を差し出してはいけない。 -->
    <article data-testid="tweet" id="p5">
      <a href="/erin/status/555"><time datetime="2026-07-01T00:00:00Z">5h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2000" id="p5a"><img src="https://pbs.twimg.com/profile_images/FFF.jpg"></div>
    </article>
    <article data-testid="tweet" id="p6">
      <a href="/frank/status/666"><time datetime="2026-07-01T00:00:00Z">6h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="2400" data-rect-size="60" id="p6a"><img src="https://pbs.twimg.com/media/GGG.jpg"></div>
    </article>
    <!-- メディアタブのタイル（/<user>/media のグリッド）。article も testid も無く、自分の
         /status/ リンクの数段上にあるのは素の <li> だけ。リンクは <img> を直に包む（#349）。 -->
    <li id="p7">
      <div><div><div>
        <a href="/gina/status/777/photo/1"><img data-rect-top="2800" src="https://pbs.twimg.com/media/HHH.jpg"></a>
      </div></div></div>
    </li>
    <!-- 同じ投稿（777）の動画タイル。サムネイルは別の CDN パスにあるので、上の写真タイル
         経由で投稿が保存済みになった後も、こちらは黙っていなければならない。 -->
    <li id="p8">
      <div><div><div>
        <a href="/gina/status/777/video/2"><img data-rect-top="3200" src="https://pbs.twimg.com/amplify_video_thumb/III.jpg"></a>
      </div></div></div>
    </li>
    <!-- 再生が始まった動画投稿（#450）。X はポスターの <img> を <video poster> に差し替え、
         二度と戻さない。だからホバーできる動画投稿は必ずこの形になる。 -->
    <article data-testid="tweet" id="p9">
      <a href="/heidi/status/999"><time datetime="2026-07-01T00:00:00Z">9h</time></a>
      <div data-testid="videoPlayer" data-rect-top="3600" id="p9a"><video poster="https://pbs.twimg.com/amplify_video_thumb/999/img/JJJ.jpg"></video></div>
    </article>
    <!-- もう1つの画像2枚の投稿。ライブラリが「どの画像を持っているか」まで答えられる場合
         （#334）のため。p4 は「投稿は保存済み、画像は不明」の側で、一度答えの出た投稿は
         二度と問い合わせない（スクロールで戻ってもただになる設計）ので、これは別の投稿で
         しか試せない。 -->
    <article data-testid="tweet" id="p10">
      <a href="/ivan/status/1010"><time datetime="2026-07-01T00:00:00Z">10h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="4000" id="p10a"><img src="https://pbs.twimg.com/media/KKK.jpg"></div>
      <div data-testid="tweetPhoto" data-rect-top="4400" id="p10b"><img src="https://pbs.twimg.com/media/LLL.jpg"></div>
    </article>
    <!-- 「画像は保存できたが投稿の情報を取れなかった」（partial）を試すためだけの投稿。
         最後まで未保存のままでいる必要があるので、他の describe は触らない。 -->
    <article data-testid="tweet" id="p11">
      <a href="/judy/status/1111"><time datetime="2026-07-01T00:00:00Z">11h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="4800" id="p11a"><img src="https://pbs.twimg.com/media/MMM.jpg"></div>
    </article>
    <!-- #576: ホバー保存だけがホストのバージョン食い違いの知らせ（#205）を欠いていた、
         その配線の穴を試すための専用の投稿。p11 と同じ理由で、保存済みにすると保存ボタンが
         消えるので、このテストの終わりまで他の describe は触らない。 -->
    <article data-testid="tweet" id="p12">
      <a href="/kevin/status/1212"><time datetime="2026-07-01T00:00:00Z">12h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="5200" id="p12a"><img src="https://pbs.twimg.com/media/NNN.jpg"></div>
    </article>
    <!-- 同じく #576。バージョンが一致するとき（hostSkew: null）に誤報が出ないことは、
         p12 が上のテストで保存済みになるので、p12 以外の未保存の画像で見る。 -->
    <article data-testid="tweet" id="p13">
      <a href="/laura/status/1313"><time datetime="2026-07-01T00:00:00Z">13h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="5600" id="p13a"><img src="https://pbs.twimg.com/media/OOO.jpg"></div>
    </article>
    <!-- テキストだけの投稿（#575）。mediaIn が何も返さない形。投稿要素自身とアバターの
         どちらも自分の幾何を持つ＝印は投稿要素に錨を下ろし、アバターの左下に置く。 -->
    <article data-testid="tweet" id="p14" data-rect-top="6000" data-rect-size="120">
      <div data-testid="Tweet-User-Avatar" data-rect-top="6012" data-rect-left="66" data-rect-size="40" id="p14avatar"></div>
      <a href="/kim/status/1414"><time datetime="2026-07-01T00:00:00Z">14h</time></a>
    </article>
    <!-- #594: 拡張機能の更新で取り残されたタブ。撤去は取り消せない（オーバーレイは二度と
         描かない）ので、この投稿はこのファイルの最後の describe だけが触る。 -->
    <article data-testid="tweet" id="p15">
      <a href="/mia/status/1515"><time datetime="2026-07-01T00:00:00Z">15h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="6400" id="p15a"><img src="https://pbs.twimg.com/media/PPP.jpg"></div>
    </article>
    <!-- ビューアの背後にある小さなタイムラインの絵。その矩形はホバー地点でビューアの絵と
         交わるが、開いているダイアログがそれを覆う。 -->
    <article data-testid="tweet" id="p17">
      <a href="/olivia/status/1717"><time datetime="2026-07-01T00:00:00Z">17h</time></a>
      <div data-testid="tweetPhoto" data-rect-top="9100" data-rect-left="250" data-rect-size="100" id="p17a"><img src="https://pbs.twimg.com/media/RRR.jpg"></div>
    </article>
  </div>
    <!-- #659: 写真ビューア（ライトボックス）。article の外にある独立したモーダルの層で、
         data-testid="swipe-to-dismiss" が今表示しているスライドを包む（2026-07-31 に実物の
         DOM で確認）。
         viewerDialog は既定では data-rect-top を持たない＝矩形はゼロ＝「開いていない」と
         みなして無視される。各テストが rectTop() で開いた状態を明示的に立て、後始末する。
         top は 8900-9500＝他のどの投稿の矩形とも重ならない値（一番高いのは p15 の
         6400-6700）。このハーネスの座標は本物のレイアウトではなく data-rect-top の宣言
         そのものなので、重なると anchorAtPoint() の「同じ面積なら先着が勝つ」規則が
         ビューアでない方の要素を拾ってしまう
         （これは p1 の 100-400 との衝突として表に出た。追っている間は modalCovers() が
         誤って true を返しているように見えたが、実際にはただ p1 を拾っていただけだった）。 -->
    <!-- #704: swipe-to-dismiss はスワイプの当たり判定で、本物の X では画像よりずっと大きい。
         包む側はわざと画像より大きく、位置もずらしておく。そうすれば隅のテストが、コント
         ロールを包む側ではなく画像に置いていることを示せる。フィクスチャの幾何を同じ大きさ
         にすると、この重なりの退行が気付かれないまま通ってしまう。 -->
    <div role="dialog" aria-modal="true" id="viewerDialog">
      <div data-testid="swipe-to-dismiss" data-rect-top="8900" data-rect-size="600" id="p16">
        <img data-rect-top="9000" data-rect-left="150" src="https://pbs.twimg.com/media/QQQ.jpg?format=jpg&amp;name=large">
      </div>
      <button aria-label="Close" data-rect-top="9010" data-rect-left="160" data-rect-size="36"></button>
    </div>
</body></html>`;

// runScripts:'outside-only' が、下の window.eval に本物のスクリプト実行の文脈を与える
// （ページ自身の <script> は動かないまま。どのみちフィクスチャには無い）
const dom = new JSDOM(X_HTML, { url: 'https://x.com/home', runScripts: 'outside-only' });
const { window } = dom;
// 現行ブラウザが備える scrollend を明示する。jsdom はこのイベントを
// 実装していないため、テストが完了時点を手で通知する。
Object.defineProperty(window, 'onscrollend', { configurable: true, value: null });

const animatedElements = new Set<any>();
const animationCalls = new Map<any, { keyframes: any; options: any }>();
const animationFrames = new Map<number, any>();
const observed = new Set<any>();
const sent: any[] = [];
const storage: Record<string, unknown> = {};
const storageListeners: any[] = [];
const runtimeListeners: any[] = [];
let ioCallback: any = null;
// ホストの応答と同じ形（#334）＝投稿ごとの captureId と、その投稿の保存済み画像。
// media が空＝「保存済み、画像は不明」で、オーバーレイは投稿まるごととして扱う。
type SavedEntry = { id: string; media: Array<string | null> };
let savedAnswer: Record<string, SavedEntry | null> = {};
let saveReply: any = { ok: true, metaOk: true };

const intersect = (ids: string[], isIntersecting: boolean) => ioCallback(ids.map((id) => ({ target: window.document.getElementById(id), isIntersecting })));
const setSetting = (key: string, value: unknown) => {
  storage[key] = value;
  for (const fn of storageListeners) fn({ [key]: { newValue: value } }, 'local');
};

// 小さなコントロールは投稿の部分木に留まる（#44 でも固定の層へは移していない。移すと
// スクロール追従とホスト側の重なり順が壊れるため）。だから素の document からそのまま拾える。
// 拾えるのはホスト要素 `<hologram-corner-control>` で、丸そのものはその ShadowRoot の中に
// いる（#310＝部分木に留まったまま、ホストの CSS からは隔離する）。
const controls = (): any[] => Array.from(window.document.querySelectorAll('[data-hologram-overlay]'));
// ホスト要素から丸へ。見た目・タブ順・アクセシブル名を見るテストは、すべてこちら側を通る。
const disc = (el: any): any => el?.shadowRoot?.firstElementChild ?? el;
const labelOf = (el: any): string | null => disc(el)?.getAttribute('aria-label');
// 一方、失敗を知らせる上部のバナーは共有の ShadowRoot（ui-root.ts）にいる。
const saveBanners = (): any[] => Array.from((window.document.querySelector('hologram-extension-ui') as any)?.shadowRoot?.querySelectorAll('[data-hologram-save-banner]') || []);
// 顔はホスト要素の data-hologram-face（#310）で見分ける＝訳された文言に頼らずに「どの顔か」
// を聞ける。文言そのものは別のテストが見る。
const marks = () => controls().filter((el) => el.getAttribute('data-hologram-face') === 'mark');
const saveButtons = () => controls().filter((el) => el.getAttribute('data-hologram-face') === 'save');
// overlay.ts は「これは保存済みか」の問い合わせを QUERY_DEBOUNCE_MS（300）の裏でまとめる。
// そのタイマーが鳴るまでは何も送られておらず、観測できるものも無い。400 はその数字に余裕を
// 足したもの。両方のタイマーは本物で同じ時計に積まれるので、負荷の高い機械では揃って遅れる
// だけで、順番が入れ替わることはない。
// biome-ignore lint/plugin: overlay.ts の 300ms の QUERY_DEBOUNCE_MS が仕様＝その遅延を待ち切ることが目的
const settle = () => new Promise((r) => setTimeout(r, 400));

// overlay.ts はポインタが何の上にあるかを「座標」で決める（本物の pointermove は必ず
// clientX/clientY を運ぶ）。イベントがどの要素で起きたかでは決めない＝サイト自身のコントロール
// が画像の上に重なっていても、印やボタンは出る。ハーネスもこれに合わせて、メディアボックスの
// 中心を狙う。
const MEDIA_BOX = '[data-testid="tweetPhoto"], [data-testid="videoPlayer"]';
const boxOf = (id: string) => {
  const el = window.document.getElementById(id);
  if (el.matches(MEDIA_BOX)) return el;
  return el.querySelector(MEDIA_BOX) || el.querySelector('img') || el; // メディアタブの li では <img> 自身が箱、テキストだけの投稿（#575）では投稿要素自身が箱
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
const hoverAway = () => pointerMove(window.document.getElementById('feed'), 900, 50); // どの箱よりも右＝何の上でもない
// #323: 保存ボタンと再試行は、本物の利用者の押下にしか応じない。ページが投げられる方の押下は
// pageClick を通り、これは番人自身のテストでしか使わない。押下は丸（ShadowRoot の中）へ投げる
// ＝ホスト要素へ投げたイベントは shadow ツリーに入らないので、ホスト側へ投げると「押しても
// 何も起きない」のが番人のおかげなのか、単に経路を間違えただけなのかを見分けられなくなる。
const pageClick = (el: any) => disc(el).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const click = (el: any) => disc(el).dispatchEvent(asUser(new window.MouseEvent('click', { bubbles: true })));
const rectTop = (sel: string, top: string) => window.document.querySelector(sel)?.setAttribute('data-rect-top', top);

beforeAll(async () => {
  // jsdom が実装していないブラウザ側のうち、overlay.ts が使う最小限だけを埋める。
  // レイアウトが無いので矩形はすべてゼロになり（overlay.ts はそれを「印を出すには小さすぎる」
  // と正しく読む）、フィクスチャの側が自分の幾何を宣言する＝data-rect-top を持つ要素は、その
  // 位置の正方形になる。
  window.Element.prototype.animate = function (keyframes: any, options: any) {
    animatedElements.add(this);
    animationCalls.set(this, { keyframes, options });
    return { cancel() {}, finish() {} };
  };
  window.Element.prototype.getBoundingClientRect = function () {
    const declared = this.getAttribute?.('data-rect-top');
    if (declared === null || declared === undefined) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    const top = Number(declared);
    const size = Number(this.getAttribute('data-rect-size') || 300);
    // data-rect-left を宣言するのは、既定の 50 から横にずらしたい要素だけ＝アバターのように、
    // 投稿の左端からの字下げが位置決めの入力になるもの（#575）。
    const left = Number(this.getAttribute('data-rect-left') || 50);
    return { left, top, right: left + size, bottom: top + size, width: size, height: size, x: left, y: top };
  };
  let nextAnimationFrame = 1;
  window.requestAnimationFrame = (fn) => {
    const id = nextAnimationFrame++;
    animationFrames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = (id) => animationFrames.delete(id);

  // 注意。jsdom は要素で発火したイベントの伝播経路に Window を入れない＝`window` に登録した
  // キャプチャ段のリスナは、このハーネスでは一度も呼ばれない（本物のブラウザなら呼ばれる）。
  // overlay.ts の load / pointer ハンドラと同じく `document` で聞くこと。

  // IntersectionObserver: 見えているかどうかはテストが手で動かす
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

  // chrome API のスタブ。すべてのメッセージを `sent` に記録する。checkSaved が投稿ごとでは
  // なくバッチで出ること、保存ボタンがドラッグ経路の imageDragged を使い回すことを見るため。
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
        // 本物の chrome.storage.local.get はキー1つでも一覧でも受ける＝overlay.ts は2つの
        // 設定を1回の呼び出しで読む
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

  // 常駐のコンテンツスクリプトの束は、Chrome が読むのとまったく同じリリース出力
  window.eval(fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', '.output', 'chrome-mv3-test', 'content-scripts', 'resident.js'), 'utf8'));
}, 30000);

test('初回走査で全ての投稿が観測される', () => {
  expect(observed.size).toBe(17); // p1-p17（#576 で p12/p13、#575 で p14、#594 で p15、#659 で p16、#704 で p17 を追加）
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

  // 「押せる顔かどうか」の分岐（#536）の、押せない方の側。報告するだけの顔は素の div のまま
  // ＝タブ順にも入らない。読み上げ名は持つ（事実を述べる形として）。
  test('報告するだけの印はタブ順に入らない', () => {
    expect(disc(marks()[0]).tagName).toBe('DIV');
    expect(disc(marks()[0]).tabIndex).toBe(-1);
    expect(disc(marks()[0]).getAttribute('role')).toBe('img');
  });

  // #310: 説明はブラウザのツールチップ（title）では出さない＝拡張機能が描く他の顔とは別の
  // 仕組みになるうえ、そもそもキーボードにもタッチにも届いていなかった。読み上げ名だけを残す。
  test('印は title を持たず、読み上げ名だけを持つ', () => {
    expect(marks()[0].hasAttribute('title')).toBe(false);
    expect(disc(marks()[0]).hasAttribute('title')).toBe(false);
    expect(labelOf(marks()[0])).toBe('Saved in Hologram');
  });

  // #310: 部分木に留まったままホストの CSS からは隔離する＝丸はホスト要素の ShadowRoot の中に
  // いて、ページ自身の CSS セレクタは届かない。その境界そのものを数値で見るのは
  // e2e-extension-hostile-css の担当。
  test('円はホスト要素の ShadowRoot の中にある', () => {
    expect(marks()[0].tagName.toLowerCase()).toBe('hologram-corner-control');
    expect(marks()[0].shadowRoot).toBeTruthy();
    expect(disc(marks()[0]).parentNode).toBe(marks()[0].shadowRoot);
  });

  // #1057 (WCAG 2.2 SC 3.1.2): この操作子は読み上げ名しか持たない（上のテストの
  // とおり画面には何も書かない）ので、どの言語で読まれるかがそのまま出力の質。
  // ホストページの lang が継承されると、上で確認した英語の名前が別言語として
  // 読まれる＝ホスト要素自身が名乗る必要がある。
  test('ホスト要素が読み上げ名の言語を名乗る', () => {
    expect(marks()[0].lang).toBe('en');
  });
});

// コントロールはメディアボックスの中にいるので、スクロール中は同じ合成の操作でボックスと
// 一緒に動く＝座標を書き直す必要が無い。そして「絵の中でのスクロール」（読みながらホイールを
// 前後に振る）は、絵がポインタから離れたことを意味しない。だからコントロールは消えてはいけない
// （#347）
describe('スクロール中の追従（#347）', () => {
  test('見えているコントロールはスクロール中もメディアに付いたまま', () => {
    rectTop('#p1 [data-testid="tweetPhoto"]', '40');
    window.dispatchEvent(new window.Event('scroll'));

    expect(marks()[0]?.parentElement).toBe(boxOf('p1'));
    expect(marks()[0].style.top).toBe('6px');
    expect(animationFrames.size).toBe(0);
  });

  test('ホバー中の絵の中でスクロールしてもコントロールは残る', async () => {
    // 何も起きないことの確認。スクロールの連射が収まった後もコントロールはそこに居なければ
    // ならない。120ms は overlay.ts の SCROLL_HOVER_SETTLE_MS（100）に余裕を足したもので、
    // その窓を使い切ること自体が検査になる。事後条件を待つ書き方だと、タイマーがまだ仕掛かって
    // いる状態の1回目の見に行きで通ってしまうため。
    // （lib-wait の neverHappens はレンダラー側のソーステキストで、ここからは import できない。）
    // わざと窓を使い切る。要点は SCROLL_HOVER_SETTLE_MS（100ms）が過ぎてもコントロールが
    // 去らないこと。neverHappens は名前でそう言っているので、素の待ちと違って抑制が要らない。
    await neverHappens('the hovered control to disappear across the settle window', () => marks().length === 0, 120);
    expect(marks()[0]?.parentElement).toBe(boxOf('p1'));
  });

  // p1 がポインタから離れ、代わりに p2 がその下に来るところまでスクロールした状態。
  // コントロールは p1 と一緒に去る。そして動いていないポインタが、「p2 がたまたま下へ動いて
  // きた」というだけで p2 を選んではいけない。
  test('動いていないポインタは、スクロール完了前に下へ来た次の絵を選ばない', async () => {
    rectTop('#p1 [data-testid="tweetPhoto"]', '-300');
    rectTop('#p2 [data-testid="tweetPhoto"]', '100');
    window.dispatchEvent(new window.Event('scroll'));

    // レイアウトが動いて p2 がポインタの下に来たとき、Pointer Events はこの境界のイベントを
    // 要求する。これを「意図したホバーの移動」と数えてはいけない。
    const layoutBoundary: any = new window.Event('pointerover', { bubbles: true });
    layoutBoundary.clientX = 200;
    layoutBoundary.clientY = 250;
    boxOf('p2').dispatchEvent(layoutBoundary);

    // CI が混雑していても、固定時間の経過はスクロール完了の根拠にならない。
    // 旧実装の 100ms を越えても scrollend までは p2 を採用しないことを確認する。
    await neverHappens('p2 to be adopted before scrollend', () => controlOf('p2').length > 0, 120);
  });

  test('スクロールが止まるとポインタの下の絵へコントロールが移る', async () => {
    // スクロール中には次の画像を選ばず、停止後だけ再評価する。これが無いと、
    // スクロールで元の画像が外れた時点から、ポインタを動かすまで保存ボタンが消えたままになる。
    window.dispatchEvent(new window.Event('scrollend'));
    await vi.waitFor(() => expect(controlOf('p2')).toHaveLength(1));

    // Intersection Observer の通知は観測時の状態をタスク経由で届ける。
    // 負荷下では、スクロール停止後にポインタの下へ戻した後で、古い離脱と
    // 現在の交差が続けて届くことがある。現在もポインタの下にある操作は、
    // その通知の間に外して作り直さない。
    const settledControl = controlOf('p2')[0];
    intersect(['p2'], false);
    expect(controlOf('p2')).toEqual([settledControl]);
    intersect(['p2'], true);
    expect(controlOf('p2')).toEqual([settledControl]);

    rectTop('#p1 [data-testid="tweetPhoto"]', '100');
    rectTop('#p2 [data-testid="tweetPhoto"]', '400');
    hoverAway();
  });
});

// このファイルが在る理由そのもの。絵の上に重なった「別の要素」（Bluesky の ALT やオーバーレイ
// の div、pixiv のブックマークのハート）に物理的に着地したポインタも、絵をホバーしていると
// 数えなければならない＝判定は座標でやるのであって、当たった要素の親をたどって決めるのでは
// ない。
test('絵の上に重なった別要素の上でも、絵をホバーしていると数える', () => {
  const p1box = boxOf('p1').getBoundingClientRect();
  // 発火先は #feed（箱でもその子孫でもない）。座標だけを p1 の箱の内側に置く
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
    // 4つの顔（印・保存・処理中・再試行）はすべて同じ寸法を共有する＝押した瞬間に角が縮まない。
    expect(b.style.width).toBe('24px');
    expect(b.style.background).toBe('var(--hologram-control-surface)');
    // #310: 影はもうカードの面と共有しておらず、24px 専用のトークンを自分で持つ。
    expect(b.style.boxShadow).toBe('var(--hologram-control-shadow)');
    expect(b.getAttribute('aria-label')).toBe('Save image');
    // 押せる顔は必ずタブ順に入る（#536）＝グリフだけのボタンなので、名前とフォーカスの
    // どちらが欠けてもキーボードにも読み上げにも見えなくなる。
    expect(b.tabIndex).toBe(0);
    expect(b.textContent).toBe('');
    expect(animatedElements.has(b)).toBe(false);
  });

  // #310: 押せる顔にも title は無い＝押せるかどうかは読み上げ名とカーソルで伝える。
  test('保存ボタンも title を持たない', () => {
    expect(disc(saveButtons()[0]).hasAttribute('title')).toBe(false);
    expect(saveButtons()[0].hasAttribute('title')).toBe(false);
    expect(disc(saveButtons()[0]).style.cursor).toBe('pointer');
  });

  test('ホバーは状態色を足さずに見分けをつける', () => {
    const b = disc(saveButtons()[0]);
    b.dispatchEvent(new window.Event('pointerenter'));

    // 状態色ではなく、面の色とハローと拡大だけ。要点は、ホバー中も半透明のままだということ
    // ＝保存済みの印と同じ不透明度に揃えてある（2026-07-29 のユーザー判断）ので、ホバーで
    // 不透明に戻ると写真を透かして見せる意味が消える。
    expect(b.style.background).toBe('var(--hologram-control-surface-hover)');
    expect(b.style.transform).toBe('scale(1.04)');

    b.dispatchEvent(new window.Event('pointerleave'));
  });

  // #323: この角はページ自身の DOM の中（絵の子＝ui-root.ts に書いてある注意点）に置くので、
  // ページ側のスクリプトが見つけてクリックできる。押せば確認も無しに保存が走るのだから、本物の
  // 利用者の押下でない限り何も起きてはならない。
  test('ページが投げた合成クリックでは保存しない（#323）', () => {
    const before = sent.length;
    pageClick(saveButtons()[0]);

    expect(sent.slice(before)).toHaveLength(0);
    expect(saveButtons()).toHaveLength(1); // まだ保存を申し出ているだけ＝処理中にも入らない
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
      // スピナーの場所に現れたチェックだけを一度動かす。ディスク全体や成功色の
      // リングは動かさない。保存済みの問い合わせで後から印が現れた場合にも、
      // この確認モーションを走らせない。
      const mark = disc(marks()[0]);
      const check = mark.firstElementChild;
      expect(animatedElements.has(mark)).toBe(false);
      expect(animatedElements.has(check)).toBe(true);
      expect(animationCalls.get(check)).toEqual({
        keyframes: [
          { opacity: 0, transform: 'scale(0.6)', transformOrigin: 'center' },
          { opacity: 1, transform: 'scale(1.12)', transformOrigin: 'center', offset: 0.6 },
          { opacity: 1, transform: 'scale(1)', transformOrigin: 'center' },
        ],
        options: { duration: 300, easing: 'cubic-bezier(0, 0, 0.2, 1)' },
      });
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

  // #310: 24px の丸が言うのは「押せば再試行」だけ。もっと長い復旧の案内（診断の画面への
  // 誘導）は、場所も role="alert" も持っているバナーの側にそのまま置く。
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

  // 再試行は「その場で1回押せば立て直せる」唯一の手段なので、ポインタでしか届かない状態は
  // それ自体が復旧手段の欠落にあたる（#536）。名前は「retry」の語を含む専用の文言（#310）。
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
    // 失敗の顔は overlay.ts の ERROR_MS（2500）の後にボタンへ戻る。顔の入れ替わりは観測できる
    // ので、留まる時間だけ寝て待つのではなくそれを待つ。タイムアウトは遅い実行環境に許す上限で
    // あって、毎回の実行が払う代金ではない。
    await vi.waitFor(() => expect(saveButtons()).toHaveLength(1), { timeout: 8000 });
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

  // 画像の分からない答え（テキストだけ、取込の失敗、#334 より前のレコード）が言えるのは投稿に
  // ついてだけ＝印が1つ、ボタンは無し。
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

  // 失敗の文面は失敗より長生きしない。#310 以降、角はそもそも文面を持ち越さない（失敗した
  // 瞬間にバナーが余さず述べるため）ので、印は常に自分の名前だけを持つ。
  test('印は前の失敗の文面を引きずらない', () => {
    expect(labelOf(controlOf('p4a')[0])).toBe('Saved in Hologram');
    setSetting('savedBadgeMode', 'hover');
  });
});

// #334: 複数枚の投稿のうち1枚だけが保存済み、というのはよくある状態だ。答えが画像まで届いて
// いれば、角は画像ごとに違う顔を出す＝保存済みには印、まだの方には保存ボタン。
describe('1枚だけ保存された投稿', () => {
  beforeAll(async () => {
    // ライブラリが持っているのは2枚目（LLL）だけ。URL の書き方は保存したときに記録したもの
    // （name=orig）で、ページ側の src（拡張子つき）とは文字列としては一致しない＝正規化した
    // 同一性で突き合わせる。
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

  // 同じタブの別経路（ドラッグ保存）で画像がもう1枚増えた、という通知。これを投稿まるごとが
  // 保存済みになったと読むと、残りの画像のボタンが次の問い合わせまで消えてしまう。
  test('savedUpdate が運ぶ絵だけが追加される', () => {
    for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/ivan/status/1010', media: ['https://pbs.twimg.com/media/KKK?format=jpg&name=orig'] });

    expect(controlOf('p10a')).toHaveLength(1);
    expect(labelOf(controlOf('p10a')[0])).toBe('Saved in Hologram');
    expect(controlOf('p10b')).toHaveLength(1);
  });
});

describe('申し出るかどうかのゲート', () => {
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

// #349: article も testid も無い、素の <li>。<img> が箱のときは、コントロールを一番近い親
// （ここでは <img> を包む <a>）に置く＝<img> が箱になる他のプラットフォームと同じ。
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

  // #372 までは、動画や GIF のタイルのサムネイルが投稿メディアの判定を通らず、グリッドの中で
  // ここだけが反応しなかった。判定に *_video_thumb を含めた今は、写真タイルと同じに答える。
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

    // p8 は同じ投稿（777）の動画タイル。押下がその場で印を点けるのは、押された箱だけ
    // （他の箱は background からの savedUpdate で後から追いつく）＝押した直後にまだ保存を
    // 申し出ているのが正しい。
    const p8Controls = () => controls().filter((el) => el.parentElement === boxOf('p8') || el.parentElement === boxOf('p8').parentElement);

    test('別の枠の押下だけでは、動画タイルの申し出は変わらない', () => {
      hover('p8');

      expect(p8Controls()).toHaveLength(1);
      expect(labelOf(p8Controls()[0])).toBe('Save image');
      hoverAway();
    });

    // 印が答えるのは投稿の水準での「持っているか」なので、保存が通知されれば同じ投稿の動画
    // タイルも同じ答えを返す。
    test('保存が通知されたら、同じ投稿の動画タイルも保存済みとして読める', () => {
      for (const fn of runtimeListeners) fn({ type: 'savedUpdate', url: 'https://x.com/gina/status/777' });
      hover('p8');

      expect(p8Controls()).toHaveLength(1);
      expect(labelOf(p8Controls()[0])).toBe('Saved in Hologram');
      hoverAway();
    });
  });
});

// #450: タイムラインの動画投稿は、プレーヤーが動き出した瞬間に <img> を失う。箱の中に
// <video> しか無くても poster を手掛かりに同じに答えないと、「ホバーできる動画には必ず
// ボタンが無い」という事態になる。
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

// #310 / #367: 「保存はできたが投稿の本文と投稿者を取れなかった」は、成功でも失敗でもない
// 結果で、角にはそれを言う場所が無い（24px の丸に文字は入らない）。以前は印の title に入れて
// いた＝1秒ホバーして初めて出るうえ、そもそもキーボードにもタッチにも届いていなかった。
// 今はバナーの琥珀（partial）が、その瞬間に余さず述べる。ただの成功は今までどおり黙る。
//
// #367 が足したのはバナーの二段化＝失敗（割り込む alert、赤）と但し書き（割り込まない
// status、琥珀）を別々の緊急度として持つこと。下の3件がその受け入れ条件をそのまま留める。
describe('投稿情報が取れなかった保存（#310・#367）', () => {
  // 「DOM に入った瞬間」の形。この時点では但し書きにまだ言葉が入っていてはいけない（下記）
  // ので、出来上がった状態だけを見ていると壊れても気付けない＝押した直後に捕まえる。
  let born: { role: string | null; text: string; state: string };

  beforeAll(async () => {
    saveReply = { ok: true, metaOk: false, metaReason: 'protected' };
    intersect(['p11'], true);
    await settle();
    hover('p11a');
    await settle();
    click(saveButtons()[0]);
    const el: any = saveBanners().at(-1);
    born = { role: el.getAttribute('role'), text: el.textContent, state: el.dataset.state };
    await settle(); // 読み上げ登録の遅延（status-surface.ts の ANNOUNCE_MS）を待ち切る
  });

  afterAll(() => {
    saveReply = { ok: true, metaOk: true };
    hoverAway();
  });

  // 見るのは一番新しいバナー＝退場のアニメーションが Web Animations で、このハーネスはそれを
  // スタブにしているので、前の失敗バナーの要素が DOM に残る（本物のブラウザなら消える）。
  test('バナーが理由つきで出る', () => {
    const banner: any = saveBanners().at(-1);

    expect(banner.dataset.state).toBe('partial');
    expect(banner.textContent).toBe('Saved (post info unavailable: private account)');
  });

  // #367 の二段の緊急度。但し書きは「保存自体はできた」という種類の知らせなので、読み上げに
  // 割り込まない＝status。失敗（上の describe）は alert のままで、ここでは変わらない。
  test('但し書きは割り込まない＝role は status（失敗の alert と分ける）', () => {
    expect(born.role).toBe('status');
    expect(born.state).toBe('partial');
  });

  // status のライブリージョンが読み上げられるのは「登録された後に中身が変わったとき」だけ
  // ＝文を持ったまま DOM に挿すと誰にも聞こえない。それでは title に書いていた頃と同じで、
  // #367 が直そうとしている状態がバナーへ移っただけになる。だから空で入り、その後に喋る。
  // （alert はブラウザが特別扱いしてそのまま挿しても読むので、失敗はこの経路を通らない）
  test('読み上げが登録される前に喋らない＝空で入り、文はその後で入る', () => {
    const banner: any = saveBanners().at(-1);

    expect(born.text).toBe('');
    expect(banner.textContent).not.toBe('');
  });

  // 操作を持つ知らせを自動で消してはいけない（読み上げの利用者がその操作へ届かなくなる）
  // ＝但し書きは自動で消えるのだから、押せるものを持ってはいけない。ふつうの保存のたびに出る
  // 面が居座らないことは、この「何も持たない」が保証している。
  test('但し書きは操作を持たない＝自動で消してよい面のまま', () => {
    const banner: any = saveBanners().at(-1);

    expect(banner.querySelector('button, a, [role="button"], input')).toBeNull();
    expect(banner.style.pointerEvents).toBe('none');
  });

  test('角そのものは印のまま＝長い文面を載せない', () => {
    expect(labelOf(controlOf('p11a')[0])).toBe('Saved in Hologram');
    expect(controlOf('p11a')[0].hasAttribute('title')).toBe(false);
  });
});

// #576: #205 が用意した「ホストの版がずれている」の知らせは、Alt+S（capture-overlay.extension-bundle.test.ts）
// とドロップ領域（drag-zone.test.ts）には配線されていたが、3つ目の保存の出口であるホバー保存
// （このファイル）だけは一度も showSaveBanner へ渡していなかった。文面と緊急度（partial＝琥珀、
// 他の成功の文面より前に出る）は他の2経路と同じく #205 からそのまま採る。
describe('ホストの版がずれているときの案内（#205 の配線漏れ・#576）', () => {
  beforeAll(async () => {
    saveReply = { ok: true, metaOk: true, grouped: 0, hostSkew: 'host-old' };
    intersect(['p12'], true);
    await settle();
    hover('p12a');
    await settle();
    click(saveButtons()[0]);
    await settle(); // 但し書きの面は空で入って後から喋る（#367）＝文が届くまで待つ
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

// 誤警報を出さない＝版が一致しているとき（またはまだどのホストからも答えを聞いていないとき）
// は、他の成功と同じく黙る。バナーの数を絶対値の 0 と比べないのは、このハーネスの癖のため
// ＝StatusSurface の退場は Web Animations の finish イベントで消えるが、このスイートの
// animate() スタブは onfinish を一度も呼ばない（drag-zone.test.ts と違い、このファイルは他の
// 場面でアニメーションが実際に走ることを観測する必要がある）。だから前の describe が上げた
// バナーが、本物のブラウザと違って DOM に残る。そこで代わりに見るのは「この操作の前後で
// バナーの数が増えていないこと」＝新しいバナーが1枚も足されていなければ、この操作は黙って
// いたと言える。
//
// これは #367 の「但し書きが出ない条件」でもある＝投稿情報が揃っていて版もずれていない、
// ただの保存は、印を出す以上のことを何も言わない。但し書きが「言うことがあるときにだけ出る」
// ものであることは、出る側（上の describe）と出ない側（ここ）の両方を持って初めて留まる。
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
    await settle(); // 後から喋る面（#367）が遅れて出てこないことも、ここで一緒に見る
  });

  test('バナーが増えない（誤警報が出ない）', () => {
    expect(saveBanners().length).toBe(before);
  });
});

// #311: Alt+S は chrome.tabs.captureVisibleTab が見たものをそのまま保存する。本物のスクリーン
// ショットは、先に隠すものが無い限り、画面に描かれているもの＝このファイルの角のコントロールも
// 含めて焼き込む。それをやるのが capture.ts（同じ隔離世界を共有する別のコンテンツスクリプト）
// で、window.__hologramPrepareOverlayForCapture を通す。__hologramAutoCapture /
// __snsPostSaveCleanup が2つのファイルを行き来するのに既に使っている、window グローバルの
// 合図と同じ仕組み。
describe('撮影退避フック（#311）', () => {
  // このスイートは1つのページを最初から最後まで動かすので、この時点で保存ボタンが残っている
  // 投稿は無い（どの投稿もどこかの describe で保存済みになっている）。フックが見ているのは
  // 「印」と「保存ボタン」の区別ではなく、共有の data-hologram-overlay 属性1つだけ。だから
  // 印（p1）と並べて、その属性を持つだけの素の要素で見れば、ボタンの顔も同じ経路で隠れることを
  // 示すのに足りる。
  let synthetic: any;

  beforeAll(() => {
    setSetting('savedBadgeMode', 'always'); // p1 の印が出ている状態にしておく
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

// #575: mediaIn が何も返さない投稿（画像の箱が無い）。印は投稿要素そのものに錨を下ろし、
// アバターの左端・下端より少し下に置く。ボタンは出さない＝保存の手段は #122（右クリック
// メニュー）のままで、この Issue が答えるのは「もう取り込んだか」だけ。
describe('テキストのみの投稿（#575）', () => {
  test('未保存の間はホバーしても何も出さない（ボタンにならない）', async () => {
    intersect(['p14'], true);
    await settle();
    hover('p14');
    await settle();

    // 見るのは p14 自身の箱だけ（controls() は他の投稿の一時的な face='flash' も拾ってしまう）。
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

  // 印はアバターに乗る＝丸の中心がアバターの縁（左上から 135° の点）に来るので、半分が写真に
  // 重なり、半分が投稿の余白へはみ出す。錨は画像の印と同じく左上で、40px のアバターなら
  // ずらし量は 20 - 20/sqrt(2) - 12 ≒ -6＝画像側の +6 を裏返した値。
  // ここでは投稿要素が (50, 6000)、アバターが (66, 6012) なので (10, 6) になる＝x.com で実測
  // した値と一致する（アバターは投稿の左端から 16px 内側にいる）。
  test('印の中心がアバターの左上の縁に乗る', () => {
    const [mark] = controlOf('p14');
    expect(mark.style.left).toBe('10px');
    expect(mark.style.top).toBe('6px');
  });

  // 乗っている先は、どのプラットフォームでもプロフィールへのリンクだ。押せない印がその隅を
  // 飲み込むと、ページ自身のコントロールを1つ奪うことになる。
  test('アバターのリンクを塞がない（pointer-events を通す）', () => {
    expect(controlOf('p14')[0].style.pointerEvents).toBe('none');
    hoverAway();
  });
});

// #659: X の写真ビューア（ライトボックス）。article の外にある独立したモーダルの層で、
// 以前の modalIsOpen() は「モーダルが1つでも開いていたら一律に止める」だったため、ここでの
// ホバーは常に隠れていた＝ビューア自身が「その開いているモーダル」だったからだ。modalCovers は
// これを「錨を含まないモーダルが見えているときだけ止める」に絞り、ビューアのユニット
// （swipe-to-dismiss）を unitSelector に足す。
describe('写真ビューア（拡大表示）でもホバー保存が出る（#659）', () => {
  const viewerBox = () => window.document.getElementById('p16') as any;
  // #704: メディア box は実体の <img>（ラッパーではない）。ホバーも画像の矩形を狙う。
  const viewerImg = () => viewerBox().querySelector('img') as any;
  const hoverViewer = () => {
    const img = viewerImg();
    const r = img.getBoundingClientRect();
    pointerMove(img, r.left + r.width / 2, r.top + r.height / 2);
  };

  afterAll(async () => {
    dom.reconfigure({ url: 'https://x.com/home' });
    window.document.getElementById('viewerDialog')?.removeAttribute('data-rect-top');
    intersect(['p16', 'p17'], false);
    hoverAway();
    await settle();
  });

  test('URL が /photo/N でない間は絵として申し出ない', async () => {
    intersect(['p16'], true);
    await settle();
    hoverViewer();
    await settle();

    expect(controlOf('p16')).toHaveLength(0);
    hoverAway();
  });

  describe('ビューアを開いた状態（URL が /photo/N・ダイアログが可視）', () => {
    beforeAll(async () => {
      dom.reconfigure({ url: 'https://x.com/nina/status/1616/photo/1' });
      rectTop('#viewerDialog', '0');
      // URL とダイアログの矩形は mediaIn/modalCovers が遅延で読む。どちらの変更も、上の
      // MutationObserver が見ている DOM の変更そのものではない（data-rect-top は
      // attributeFilter に入っていないし、jsdom にはナビゲーションのイベントが無い）ので、
      // syncAnchors が独りでに走り直すことはない。交差の切り替えは、ビューアが実際に
      // スライドを載せたときに本物の IntersectionObserver も発火させるもの。
      intersect(['p16'], false);
      intersect(['p16'], true);
      intersect(['p17'], true);
      await settle();
    });

    test('ビューアの画像がユニットとして解決され、ホバーで保存ボタンが出る', async () => {
      hoverViewer();
      await settle();

      expect(saveButtons()).toHaveLength(1);
      // controlHost() の IMG 分岐＝mount 先は img.parentElement（ラッパー自身）。
      // 「どこに置かれて見えるか」は下の位置テストが別に見る（host と矩形は別物）。
      expect(saveButtons()[0].parentElement).toBe(viewerBox());
      expect(controlOf('p17a')).toHaveLength(0);
    });

    // #704: ビューアのスワイプのラッパーはスライド全体の当たり判定なので、その角は絵の角
    // ではない。X の閉じるボタンが絵自身の角に重なるときは、画像を基準にした左端を保った
    // まま、別の角へ移るのではなく縦にずらして避ける。
    test('保存ボタンは画像の左上に付き、Xの閉じるボタンと重ならない（#704）', () => {
      const [button] = saveButtons();
      const wrapper = viewerBox().getBoundingClientRect();
      const img = viewerImg().getBoundingClientRect();
      // フィクスチャの前提そのものを固定＝ラッパーと画像の角がずれていなければ
      // このテストは何も区別できていない（#659 の等サイズフィクスチャの穴）。
      expect(img.left).not.toBe(wrapper.left);
      expect(img.top).not.toBe(wrapper.top);
      expect(button.style.left).toBe(`${img.left - wrapper.left + 6}px`); // 106px＝(150−50)+CONTROL_INSET
      expect(button.style.top).toBe('152px'); // 閉じるボタンの下端 (9010+36) − ラッパーの上端 + inset
    });

    test('押すとパーマリンクは URL の /photo/N を落とした投稿になる（ドラッグ保存経路を再利用）', () => {
      click(saveButtons()[0]);
      const save = sent.at(-1);

      expect(save).toMatchObject({ type: 'imageDragged', platform: 'x' });
      expect(save.postUrl).toBe('https://x.com/nina/status/1616');
      hoverAway();
    });

    // 以前の modalIsOpen() の一律の遮断を「錨を含まないモーダルが見えているときだけ」に絞った
    // ことの裏返し＝ビューアの外の絵は、今までどおり開いているダイアログに覆われて出ない
    // （#347 の意図を保つ）。この時点で p13 は既に保存済み（savedBadgeMode: hover）。
    test('ビューアの外の絵は、開いているダイアログに覆われて出ない', async () => {
      hover('p13a');
      await settle();

      expect(controlOf('p13a')).toHaveLength(0);
      hoverAway();
    });
  });
});

// #594: 拡張機能が読み込み直されたり自動更新されたりすると、開きっぱなしのタブに残った常駐
// スクリプトは拡張機能との接続を失う（孤児になる）。UI はページに残るが、`chrome.*` を呼ぶと
// 同期の例外が飛ぶ。
//
// 注意。これはこのファイルの最後のスイートでなければならない＝撤去は取り消せない。ここから先は
// どの投稿にもオーバーレイが無い。
//
// 注意。ここで見るのは配線だけ（検出した後に何が起きるか）。「孤児になると実際どういう状態に
// なるか」＝`chrome.runtime.id` が falsy になり `sendMessage` が投げる、という前提そのものは
// jsdom では作り物にしかならない。それを測るのは、本物のブラウザで実際に拡張機能を読み込み
// 直す `scripts/e2e-extension-orphan.cts` の担当。前提が変わっても、このスイートは緑のまま
// 通り続けてしまう。
describe('拡張が更新されて孤児になったタブ（#594）', () => {
  // 実測した現実（e2e-extension-orphan.cts）に合わせたスタブ＝`chrome.runtime` は残り、
  // `id` だけが落ち、`sendMessage` と `storage` が同期で投げる。
  const orphan = () => {
    const api = window.chrome as any;
    api.runtime.id = undefined;
    api.runtime.sendMessage = () => {
      throw new Error('Extension context invalidated.');
    };
    api.storage.local.get = () => {
      throw new Error('Extension context invalidated.');
    };
  };

  beforeAll(async () => {
    intersect(['p15'], true);
    await settle();
    hover('p15');
    await settle();
  });

  test('孤児になる前は普通に保存ボタンが出ている', () => {
    const [button] = controlOf('p15');

    expect(button?.getAttribute('data-hologram-face')).toBe('save');
  });

  // 直す前は Uncaught Error になり、受領を待つタイムアウトまで回転子が回り続けたあげく、
  // 「保存が終わらなかったので取り消した（繰り返すなら Chrome を再起動）」を出していた
  // ＝何ともない拡張機能とホストのせいにする文面だった。
  test('孤児化した後に押しても投げず、再読み込みの案内が出る', () => {
    orphan();
    const [button] = controlOf('p15');

    expect(() => click(button)).not.toThrow();
    expect(saveBanners().map((el) => el.textContent)).toContain('The extension was updated. Please reload this page.');
  });

  test('注入した UI を自分で撤去する（残って無反応にならない）', () => {
    expect(controls()).toHaveLength(0);
  });

  test('撤去後はホバーしても二度と描かない', async () => {
    hoverAway();
    hover('p15');
    await settle();

    expect(controls()).toHaveLength(0);
  });
});
