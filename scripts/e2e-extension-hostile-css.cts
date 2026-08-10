'use strict';

// #44の2つの完了条件を、実際のブラウザ上で数値に落とし込む。
//
//   1. ホストのCSSに影響されない――ページが`* { all: unset !important }`と同等の
//      敵対的ルールを置いても、拡張機能のUIは設計どおりの見た目を保つ
//   2. 拡張機能のCSSがホストへ漏れない――ページ自身の要素が拡張機能のクラス名を
//      身にまとっても、拡張機能のスタイルはそれらに適用されない
//
// これはまさにShadowRoot（extension/utils/ui-root.ts）が存在する理由であり、その境界が
// ゆるむと、通常のテストは全部緑のまま通ってしまう＝ここで固定しておかなければ静かに
// 壊れる。
//
// 3つ目として、ホストがインラインスタイルを禁じるCSPを返すケースも確かめる。#270で
// 実測したとおり、構築されたシート（adoptedStyleSheets）はCSPの検査対象にならないので、
// トークンはそれでも解決されなければならない。これはまさにx.comが実際に送ってくる
// ポリシーの種類だ。
//
// 注意: 敵対的CSSは**外部シートとして配信される**（`<style>`ではなく`<link>`）。
// `style-src 'none'`はページ自身の`<style>`と`style=`属性も同様に殺してしまうので、
// 敵対的ルールを`<style>`タグに書くと**そのルール一式まるごと無効化され、チェック1と2は
// 何もテストしないまま緑で通ってしまう**（2026-07-30に直接実測。同じ理由で、フィクスチャ
// 自身の寸法もインライン属性としては書けない）。`style-src 'self'`なら同一オリジンの
// 外部シートだけを通す＝敵対的CSSは実際に適用されつつ、インラインに頼れないという
// 状況も保たれる。
//
// 使い捨てのChromiumと使い捨ての拡張機能ステージング＝ユーザーのプロファイルにも
// 実際のライブラリにも触れない（e2e-overlay-visualと同じ仕組み）。

const { launchOverlayBrowser } = require('./lib-overlay-e2e.cts');
const { waitFor } = require('./lib-wait.cts');

const POST_ID = '1999999999999999996';
const POST_URL = `https://x.com/hologram/status/${POST_ID}`;
const CSS_URL = 'https://x.com/hostile.css';

// ページ側の敵対的CSS。拡張機能が使う要素名・クラス名を名指しで狙い、押し潰す。
const HOSTILE = `
  *, *::before, *::after { all: unset !important; }
  div, button, svg, span, input, label { all: unset !important; display: inline !important; }
  .surface, .badge, .label, .ring, .choice, .highlight, .spinner {
    all: unset !important;
    display: none !important;
    position: static !important;
    background: #ff00ff !important;
    border: 0 !important;
  }
  hologram-extension-ui { display: none !important; position: static !important; opacity: 0 !important; }
  /* 写真の角のコントロール（#310）。固定レイヤーではなく投稿のサブツリーの中に居るので、
     ページのCSSが名前で狙える位置にある＝ここで押し潰す。 */
  hologram-corner-control { display: none !important; position: static !important; width: auto !important; height: auto !important; }
  article, .media { display: block !important; }
`;

const PAGE_CSS = `
  article { width: 640px; min-height: 360px; margin: 80px auto; padding: 32px; }
  .media { margin-top: 24px; background: #888; }
  ${HOSTILE}
  /* 全消しルールの後、ページは自分の写真フレームのサイズを取り直す
     （詳細度で上の*に勝つ）。これは実際のサイトでも普通の形であり、これが無いと
     フレームが高さ0に潰れ、コントロールが「フレームが小さすぎる」せいでそもそも
     現れなくなる＝下のチェックは何もテストしないことになる。 */
  #capture-target .media { display: block !important; width: 480px !important; height: 220px !important; }
`;

const POST_HTML = `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Hologram hostile-CSS fixture</title>
<link rel="stylesheet" href="${CSS_URL}">
</head>
<body>
  <article id="capture-target" data-testid="tweet">
    <a href="/hologram/status/${POST_ID}"><time datetime="2026-07-29T00:00:00.000Z">2026-07-29</time></a>
    <p>Hostile CSS fixture post</p>
    <div class="media" data-testid="tweetPhoto" aria-label="fixture image"><img id="pic" src="https://pbs.twimg.com/media/HOSTILE.jpg" alt="fixture"></div>
    <!-- ページが拡張機能自身のクラス名を騙る。拡張機能が出荷するものはここには
         一切届かない＝そのスタイルシートはシャドウルートの中に住んでいる。 -->
    <div id="host-impostor" class="surface"><span class="badge">x</span><span class="label">y</span></div>
  </article>
</body>
</html>`;

declare const chrome: any;

// 1x1の透明PNG。中身はどうでもよい＝必要なのは「ちゃんと機能する画像」であることだけ。
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

// 数値で固定して確かめるもの。敵対的CSSが実際に効いていれば、このうち少なくとも1つは必ず失敗する。
interface Measured {
  found: boolean;
  display: string;
  position: string;
  right: number;
  bottom: number;
  width: number;
  height: number;
  background: string;
  borderTopWidth: string;
  fontWeight: string;
  badgeRadius: string;
  badgeWidth: number;
  // こちらのクラス名を身にまとったホスト側自身の要素を、こちら側のプロパティに
  // ついて測る。ページのカスケードが何に落ち着くかはページの領分。
  impostorPosition: string;
  impostorWidth: number;
  impostorBackground: string;
  // ルートの中で解決されるトークン――このテストのCSP側の半分。
  surfaceToken: string;
}

(async () => {
  const overlay = await launchOverlayBrowser({ locale: 'ja-JP' });
  try {
    const page = await overlay.browser.newPage();
    await page.route('**/*', async (route: any) => {
      if (route.request().url() === POST_URL) {
        await route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          // style-src 'self'――'unsafe-inline'は無いので、注入した<style>はシャドウ
          // ルートの中でも死んでいる（#270の実測）。一方でページ自身の敵対的シートは
          // 同一オリジンかつ外部なので読み込まれ続ける。adoptedStyleSheetsとCSSOMは
          // CSPの標的ではなく、拡張機能が使っているのはこちらだ。
          headers: { 'content-security-policy': "style-src 'self'" },
          body: POST_HTML,
        });
      } else if (route.request().url() === CSS_URL) {
        await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: PAGE_CSS });
      } else if (route.request().resourceType() === 'image') {
        // 本物の画像を返す。下のドラッグが本物のドラッグでなければならないからだ＝
        // Chromiumは壊れた画像からはドラッグを始めない。中断されたリクエストでは
        // ゾーンが現れる根拠が無くなってしまう。URLはx.comの形を保っている――
        // 拡張機能が投稿の身元をそこから読み取るからだ。
        await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
      } else await route.abort();
    });
    await page.goto(POST_URL, { waitUntil: 'domcontentloaded' });
    await page.locator('#capture-target').waitFor();

    // === 写真の角のコントロール（#310） =====================================
    // ドロップゾーンと違い、これは固定レイヤーには居ない＝投稿のサブツリーの中に留まり、
    // 自分専用の小さなShadowRootに隔離されている。だからここで確かめることは2つある。
    // (1) ホスト要素のボックスがページの`!important`に対して生き残るか（ページが名前で
    // 狙えるのはここだけ）(2) 円そのものがページの`button { all: unset !important }`に
    // 触れられずに済んでいるか。
    const media = await page.locator('.media').boundingBox();
    await page.mouse.move(media.x + media.width / 2, media.y + media.height / 2);
    await page.waitForSelector('[data-hologram-overlay][data-hologram-face="save"]', { timeout: 5000 });
    const corner = await page.evaluate(() => {
      const el = document.querySelector('[data-hologram-overlay]') as HTMLElement;
      const disc = el?.shadowRoot?.firstElementChild as HTMLElement | undefined;
      const box = document.querySelector('.media') as HTMLElement;
      if (!el || !disc) return null;
      const hostStyle = getComputedStyle(el);
      const discStyle = getComputedStyle(disc);
      const r = disc.getBoundingClientRect();
      const boxRect = box.getBoundingClientRect();
      return {
        hostDisplay: hostStyle.display,
        hostPosition: hostStyle.position,
        tag: disc.tagName,
        display: discStyle.display,
        width: r.width,
        height: r.height,
        radius: discStyle.borderRadius,
        background: discStyle.backgroundColor,
        borderTopWidth: discStyle.borderTopWidth,
        boxShadow: discStyle.boxShadow,
        glyphs: disc.querySelectorAll('svg').length,
        label: disc.getAttribute('aria-label'),
        titled: el.hasAttribute('title') || disc.hasAttribute('title'),
        // 角に座っていること＝借りている包含ブロック（ページ要素のposition: relative）が
        // ページの`position: static !important`に負けていないことを証明できる唯一の
        // 観測点。
        offsetLeft: r.left - boxRect.left,
        offsetTop: r.top - boxRect.top,
      };
    });
    const cornerFail = (why: string) => {
      throw new Error(`HOSTILE_CSS_CORNER_FAIL: ${why} — ${JSON.stringify(corner)}`);
    };
    if (!corner) cornerFail('角のコントロールに自分専用のシャドウルートが無い');
    if (corner.hostDisplay !== 'block') cornerFail(`ホスト要素がdisplay:${corner.hostDisplay}になっている。blockを期待`);
    if (corner.hostPosition !== 'absolute') cornerFail(`ホスト要素がposition:${corner.hostPosition}になっている。absoluteを期待`);
    if (corner.tag !== 'BUTTON') cornerFail(`保存の面が<${corner.tag}>になっている。BUTTONを期待`);
    if (corner.display !== 'flex') cornerFail(`円盤がdisplay:${corner.display}になっている。flexを期待`);
    if (Math.abs(corner.width - 24) > 0.5 || Math.abs(corner.height - 24) > 0.5) cornerFail(`円盤が${corner.width}x${corner.height}になっている。24x24を期待`);
    if (corner.radius !== '50%') cornerFail(`円盤の半径が${corner.radius}になっている。50%を期待`);
    if (corner.background === 'rgba(0, 0, 0, 0)' || corner.background === 'rgb(255, 0, 255)') cornerFail(`円盤の塗りが${corner.background}になっている`);
    if (corner.borderTopWidth !== '1px') cornerFail(`円盤の輪郭線が${corner.borderTopWidth}になっている。1pxを期待`);
    // 影は24px専用のトークン（#310）＝カードで使う36pxのぼかしとは別物。
    if (!/\b2px\b/.test(corner.boxShadow) || /3[0-9]px/.test(corner.boxShadow)) cornerFail(`円盤の影が"${corner.boxShadow}"になっている。コンパクトなコントロール用の影を期待`);
    if (corner.glyphs !== 1) cornerFail(`円盤が${corner.glyphs}個のグリフを抱えている。1個を期待`);
    if (!corner.label) cornerFail('押せる面にアクセシブルな名前が無い');
    if (corner.titled) cornerFail('角にまだブラウザのツールチップが付いている');
    if (Math.abs(corner.offsetLeft - 6) > 1 || Math.abs(corner.offsetTop - 6) > 1) cornerFail(`円盤が写真の角から${corner.offsetLeft},${corner.offsetTop}の位置にある。6,6を期待`);

    // Alt+Sのバナーではなくドロップゾーンの方を見る＝キャプチャの起動にはactiveTabが
    // 要り、それを与えられるのは拡張機能レベルのジェスチャー（ツールバーかコマンド）
    // だけで、Playwrightはそのどちらも押せない。常駐コンテンツスクリプトはmanifestに
    // よってこのオリジンに既に居るので、投稿の画像をドラッグするのはページレベルの
    // ジェスチャーだ――同じ共有サーフェス、同じ共有ルートで、権限は要らない。
    //
    // `page.dispatchEvent('dragstart')`ではなく本物のドラッグ＝#323以降、ゾーンは
    // 信頼されたイベントに対してしか現れず、dispatchしたイベントは定義上ページ側の
    // ものになる。マウスを押して動かす操作はDevToolsプロトコルのinputドメインを
    // 経由し、それはその境界のユーザー側に立つ。下のリリースはゾーンから遠いので
    // 何も保存されない――このテストはゾーンがどう「見えるか」についてのものだ。
    const picture = await page.locator('#pic').boundingBox();
    await page.mouse.move(picture.x + picture.width / 2, picture.y + picture.height / 2);
    await page.mouse.down();
    await page.mouse.move(picture.x + picture.width / 2 + 80, picture.y + picture.height / 2 + 40, { steps: 8 });
    // ゾーンの登場を、ゾーンそのものとして待つ。タイムアウトは飲み込む。下の
    // `m.found`が「共有ルートの中にそもそも存在しない」ことを報告してくれ、それが
    // このテストが確かめたい発見そのものだからだ。
    await waitFor('the drop zone to enter the shared root', () =>
      page.evaluate(() => {
        const zone = document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('#__hologramDropZone');
        return !!zone && getComputedStyle(zone as HTMLElement).display !== 'none';
      }),
    ).catch(() => {});
    // 以下で読むすべての数値はgetBoundingClientRectであり、登場の途中で測った要素は
    // レイアウトの数値ではなくトゥイーンの数値を返してしまう（#818）。
    await page.evaluate(async () => {
      const zone = document.querySelector('hologram-extension-ui')?.shadowRoot?.querySelector('#__hologramDropZone');
      if (zone) await Promise.all(zone.getAnimations().map((animation) => animation.finished.catch(() => {})));
    });

    const m: Measured = await page.evaluate(() => {
      const root = document.querySelector('hologram-extension-ui')?.shadowRoot;
      const banner = root?.querySelector('#__hologramDropZone') as HTMLElement | null;
      const badge = banner?.querySelector('.badge') as HTMLElement | null;
      const impostor = document.getElementById('host-impostor') as HTMLElement;
      const impostorStyle = getComputedStyle(impostor);
      if (!banner || !badge) {
        return {
          found: false,
          display: '',
          position: '',
          right: 0,
          bottom: 0,
          width: 0,
          height: 0,
          background: '',
          borderTopWidth: '',
          fontWeight: '',
          badgeRadius: '',
          badgeWidth: 0,
          impostorPosition: impostorStyle.position,
          impostorWidth: impostor.getBoundingClientRect().width,
          impostorBackground: impostorStyle.backgroundColor,
          surfaceToken: '',
        };
      }
      const s = getComputedStyle(banner);
      const r = banner.getBoundingClientRect();
      const bs = getComputedStyle(badge);
      return {
        found: true,
        display: s.display,
        position: s.position,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        background: s.backgroundColor,
        borderTopWidth: s.borderTopWidth,
        fontWeight: s.fontWeight,
        badgeRadius: bs.borderRadius,
        badgeWidth: badge.getBoundingClientRect().width,
        impostorPosition: impostorStyle.position,
        impostorWidth: impostor.getBoundingClientRect().width,
        impostorBackground: impostorStyle.backgroundColor,
        surfaceToken: s.getPropertyValue('--hologram-surface').trim(),
      };
    });

    await page.mouse.up(); // ゾーンから離れた位置でドラッグを離す――何も保存されない

    const fail = (why: string) => {
      throw new Error(`HOSTILE_CSS_FAIL: ${why} — ${JSON.stringify(m)}`);
    };

    // 前提――敵対的CSSが実際に効いていること――についての自己チェック。
    // `.surface { background: #ff00ff }`はページ自身のルールなので、これがマゼンタで
    // なければシートは一度も読み込まれていない＝この後のすべてのチェックは何も
    // テストしないまま成功してしまう。#44の最初のバージョンはまさにその状態だった
    // （`style-src 'none'`が<style>タグを殺していた――2026-07-30、#310の作業中に発見）。
    if (m.impostorBackground !== 'rgb(255, 0, 255)') fail(`敵対的シートが適用されていない（ページ自身の.surfaceが${m.impostorBackground}になっている。マゼンタを期待）――以下のすべてのチェックが中身の無いまま通ってしまう`);
    if (!m.found) fail('ドロップゾーンが共有ルートの中にそもそも存在しない');
    // 1. こちらのタグとこちらのクラスに対するホスト側の`display:none !important`は
    //    何にも届いてはいけない＝ホスト要素自身のボックスはこちらからinline !important
    //    にしてあり、その中のサーフェスはページの手が完全に届かない場所にある。
    if (m.display !== 'flex') fail(`ゾーンがdisplay:${m.display}になっている。flexを期待`);
    if (m.position !== 'fixed') fail(`バナーがposition:${m.position}になっている。fixedを期待`);
    // 右下、components.cssが与える幅の位置。ホスト側のルールが1つでも通ってしまえば、
    // これはドキュメントフロー内のインラインボックスに潰れる。
    if (Math.abs(m.width - 248) > 1) fail(`ゾーンの幅が${m.width}pxになっている。248を期待`);
    if (m.height < 90) fail(`ゾーンの高さが${m.height}pxに潰れている`);
    if (Math.abs(m.right - (1280 - 24)) > 1) fail(`ゾーンの右端が${m.right}になっている。${1280 - 24}を期待`);
    if (Math.abs(m.bottom - (960 - 24)) > 1) fail(`ゾーンの下端が${m.bottom}になっている。${960 - 24}を期待`);
    // 2. 見た目が生き残っているか＝塗り、輪郭線、太さ、バッジの円。
    if (m.background === 'rgba(0, 0, 0, 0)' || m.background === 'rgb(255, 0, 255)') fail(`ゾーンの塗りが${m.background}になっている`);
    if (m.borderTopWidth !== '1px') fail(`輪郭線が${m.borderTopWidth}になっている。1pxを期待`);
    if (m.fontWeight !== '600') fail(`ラベルの太さが${m.fontWeight}になっている。600を期待`);
    if (m.badgeRadius !== '50%') fail(`バッジの半径が${m.badgeRadius}になっている。50%を期待`);
    if (m.badgeWidth < 20) fail(`バッジが${m.badgeWidth}pxに潰れている`);
    // 3. ページがスタイルシートを完全に禁じていても、トークンは解決される。
    if (!/^#|^rgb/.test(m.surfaceToken)) fail(`--hologram-surfaceが解決されなかった: "${m.surfaceToken}"`);
    // 4. 逆方向にも何も漏れていない。ページ側のプロパティが在ることではなく、
    //    こちら側のプロパティが「無い」ことでアサートする＝ページ自身のカスケードが
    //    何に落ち着くかはページの領分だが、`position: fixed`と、こちらの248pxの
    //    測定値と、こちらのサーフェスの塗りは、こちらからしか来ようがない。
    if (m.impostorPosition === 'fixed') fail('ホスト自身の.surfaceにこちらのpositionが与えられている');
    if (Math.abs(m.impostorWidth - m.width) < 1) fail(`ホスト自身の.surfaceにこちらの幅が与えられている（${m.impostorWidth}px）`);
    if (m.impostorBackground === m.background) fail(`ホスト自身の.surfaceにこちらの塗りが与えられている（${m.impostorBackground}）`);

    console.log(`PASS e2e-extension-hostile-css: ゾーン ${Math.round(m.width)}x${Math.round(m.height)}、位置は${Math.round(m.right)},${Math.round(m.bottom)}、塗り${m.background}、輪郭線${m.borderTopWidth}、--hologram-surfaceは${m.surfaceToken}としてstyle-src 'self'の下で解決`);
    console.log(`  角のコントロール: ${Math.round(corner.width)}x${Math.round(corner.height)} <${corner.tag}>、専用のシャドウルート内、塗り${corner.background}、影${corner.boxShadow}、ツールチップなし、名前"${corner.label}"`);
  } finally {
    await overlay.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
