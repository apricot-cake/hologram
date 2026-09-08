'use strict';

// ブラウザレベルのオーバーレイテスト（e2e/extension/overlay-*.spec.ts）向け共有ハーネス。
// jsdomはDOMの判断を検証できるが、ちらつき・重なり順・合成されたスクロールは本物の
// ブラウザだけが持つ性質だ。だからこれらのテストは、ビルド済みの拡張機能を使い捨ての
// Chromeプロファイルに読み込み、コンテンツスクリプトがマッチする実際のオリジンで
// プラットフォームの形をしたフィクスチャページ（tests/fixtures/overlay/）を配信する。
//
// FLICKER（ちらつき）を検証可能にしている要は記録装置だ＝コンテンツスクリプトが動く前に
// 仕込まれたMutationObserverが、オーバーレイがページに対して行うすべて――コントロールの
// 挿入・削除、ページ所有要素へのスタイル書き込み――をタイムスタンプ付きのタイムラインとして
// 書き残す。ちらつきはこのタイムライン上のパターンだ（同じホストがコントロールを得ては
// 失うことを繰り返す）。1回だけのbefore/afterアサーションでは決して見えないものだ。
//
const fs = require('node:fs');
const path = require('node:path');
const { launchExtensionBrowser, stageExtension } = require('./extension-browser.cts');
const { sleep } = require('../../scripts/lib-wait.cts');

const FIXTURES = path.join(__dirname, '../../tests/fixtures/overlay');

interface OverlayBrowser {
  browser: any;
  close(): Promise<void>;
}

async function launchOverlayBrowser(options: { locale?: string } = {}): Promise<OverlayBrowser> {
  // 意図的に決して登録されない、実行ごとに一意なホスト名。これが無いと、ステージングされた
  // 拡張機能は`com.hologram.host`と話し続けてしまう。開発マシンにはこれが実際に
  // インストールされている――インストーラーはChromeだけでなくChromiumにも登録する
  // （native-host/install.mts）――ので、保存を押すと実際のホストに届いてしまい、クリーンな
  // マシンでの同じ実行は届かず、オーバーレイがどの失敗を報告すべきかについて2つの実行が
  // 食い違ってしまっていた。「ホストが見つからない」で失敗するならどのマシンでも同じになり、
  // ユーザーがインストール済みのホストにも触れずに済む。
  const extensionDir = stageExtension({
    tempPrefix: 'hologram-overlay-e2e-ext-',
    nativeHostName: `com.hologram.host.overlay_e2e_${process.pid}`,
  });
  const session = await launchExtensionBrowser({
    extensionDir,
    headless: true,
    viewport: { width: 1280, height: 960 },
    locale: options.locale,
    args: ['--window-size=1280,960'],
  });
  return {
    browser: session.context,
    async close() {
      await session.close();
      fs.rmSync(extensionDir, { recursive: true, force: true });
    },
  };
}

// タイムラインの1エントリ。`host`はオーバーレイが作用したページ要素を識別する
// （add/removeならそのコントロールの親、styleなら変更された要素）。エントリをまたいで
// 安定しているので、フラップ――同じホストがadd/removeを繰り返すこと――を数えられる。
interface OverlayEvent {
  t: number;
  type: 'add' | 'remove' | 'style' | 'mark';
  host?: string;
  label?: string;
}

// 拡張機能のコードより前に、ページ内で走る（addInitScript）。ソース文字列のまま
// 保持している＝このファイルとページで実行されるものとの間にツールを一切挟まず、
// そのままの姿でページへ渡らなければならない。
const RECORDER_SOURCE = `(() => {
  const log = [];
  let hostSeq = 0;
  const hostIds = new WeakMap();
  const describe = (el) => {
    if (!hostIds.has(el)) hostIds.set(el, ++hostSeq);
    return el.tagName.toLowerCase() + '#' + hostIds.get(el);
  };
  window.__overlayRecorder = {
    mark(label) { log.push({ t: performance.now(), type: 'mark', label }); },
    take() { return log.splice(0, log.length); },
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) if (n instanceof Element && n.hasAttribute('data-hologram-overlay')) log.push({ t: performance.now(), type: 'add', host: describe(r.target) });
        for (const n of r.removedNodes) if (n instanceof Element && n.hasAttribute('data-hologram-overlay')) log.push({ t: performance.now(), type: 'remove', host: describe(r.target) });
      } else if (r.type === 'attributes' && r.target instanceof Element && !r.target.hasAttribute('data-hologram-overlay')) {
        // オーバーレイがPAGE要素に対して行う唯一のスタイル書き込みは、コントロールが
        // 載っている間だけ借りるホストのpositionだ。フィクスチャ自身がstyle属性に
        // 触れることは決してないので、ここに現れるすべてのエントリはオーバーレイが
        // 他人のDOMを塗り直しているものだ。
        log.push({ t: performance.now(), type: 'style', host: describe(r.target) });
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  // ^ documentElementではなくDocumentノード＝このソースは<html>が存在する前の
  // new-document時点で走るので、observe(null)は記録装置全体を黙って殺してしまう
  // （openFixtureの自己チェックはまさにそれを捕まえるために存在する）。
})();`;

// `html`を`url`にちょうど一致するときだけ配信する（それ以外はすべて中断する――
// フィクスチャは自己完結していて、画像はCSSでサイズ指定しているのでsrcが壊れていても
// レイアウトに影響しない）。そしてコンテンツスクリプトのdocument_idle起動と最初の
// スキャンが終わるのを待つ。
async function openFixture(overlay: OverlayBrowser, url: string, html: string): Promise<any> {
  const page = await overlay.browser.newPage();
  await page.addInitScript({ content: RECORDER_SOURCE });
  await page.route('**/*', async (route: any) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.url() === url) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    } else {
      await route.abort();
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // 自己チェック: 記録装置のインストールに失敗すると、タイムラインのアサーションは
  // すべて中身の無いまま通ってしまう。だからどのテストも走る前に、合成したmount/unmountを
  // ちゃんと見えていることを証明する。
  const alive = await page.evaluate(async () => {
    const el = document.createElement('div');
    el.setAttribute('data-hologram-overlay', '');
    document.body.appendChild(el);
    el.remove();
    // 2件のエントリが事後条件だ。待ち切るのではなくフレームごとにポーリングする＝
    // MutationObserverはマイクロタスクのチェックポイントで配信し、take()はspliceするので、
    // エントリは読み直すのではなく積み上げていく。
    let sawAdd = false;
    let sawRemove = false;
    for (let i = 0; i < 60 && !(sawAdd && sawRemove); i++) {
      for (const entry of (window as any).__overlayRecorder.take()) {
        if (entry.type === 'add') sawAdd = true;
        if (entry.type === 'remove') sawRemove = true;
      }
      if (!(sawAdd && sawRemove)) await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return sawAdd && sawRemove;
  });
  if (!alive) throw new Error('overlay recorder self-check failed: synthetic mutations were not observed');
  // 意図して固定時間にしている＝コンテンツスクリプトのdocument_idle起動と最初のスキャンは
  // ページに何も置かない――オーバーレイはポインタが動いて初めて描画する――ので、待つべき
  // 事後条件が無い。代わりにコントロールを待つなら、先にホバーすることになってしまい、
  // それはまさにどの呼び出し元もここで測りたいものそのものだ。
  // biome-ignore lint/plugin: the content script's startup draws nothing to wait on
  await sleep(700);
  await page.evaluate(() => (window as any).__overlayRecorder.take()); // 起動時のノイズを捨てる
  return page;
}

function fixtureHtml(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, `${name}.html`), 'utf8');
}

async function takeLog(page: any): Promise<OverlayEvent[]> {
  return page.evaluate(() => (window as any).__overlayRecorder.take());
}

// ポインタをその場に保ったままホイールスクロールする。`jitterPx`は、実際の手が
// ホイールのノッチの間に生む数ピクセルのずれを加える――pointermoveがオーバーレイの
// 唯一のホバー入力なので、この違いが意味を持つ。
async function wheelScroll(page: any, options: { from: { x: number; y: number }; steps: number; deltaY?: number; stepMs?: number; jitterPx?: number }): Promise<void> {
  const { from, steps, deltaY = 120, stepMs = 40, jitterPx = 0 } = options;
  let x = from.x;
  for (let i = 0; i < steps; i++) {
    if (jitterPx) {
      x += i % 2 ? jitterPx : -jitterPx;
      await page.mouse.move(x, from.y);
    }
    await page.mouse.wheel(0, deltaY);
    // ノッチとノッチの間隔こそが、いま模擬している入力そのものだ＝手が回すホイールは
    // 一定の間合いのノッチで来て、オーバーレイの落ち着きタイマーはその間合いに反応する。
    await sleep(stepMs);
  }
}

// 一つの入力ジェスチャーとして連続スクロールする。page.mouse.wheel() を
// 繰り返すと各呼び出しが独立した操作になり、ブラウザは途中にも scrollend
// を送る。静止したポインタと一回のスクロール完了を検査するときは、入力側も
// その意味に合わせる。
async function continuousScroll(page: any, options: { from: { x: number; y: number }; steps: number; deltaY?: number; stepMs?: number }): Promise<void> {
  const { from, steps, deltaY = 120, stepMs = 40 } = options;
  const distance = deltaY * steps;
  const durationMs = stepMs * steps;
  const speed = Math.max(1, Math.round(Math.abs(distance) / (durationMs / 1000)));
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.synthesizeScrollGesture', {
      x: from.x,
      y: from.y,
      yDistance: -distance,
      speed,
      preventFling: true,
      gestureSourceType: 'mouse',
    });
  } finally {
    await session.detach();
  }
}

interface HostStats {
  adds: number;
  removes: number;
  styles: number;
}

interface LogSummary {
  adds: number;
  removes: number;
  styles: number;
  byHost: Map<string, HostStats>;
  // このウィンドウ内でコントロールが2回以上マウントされたホスト＝これがちらつきの
  // 兆候であり、動くポインタの下を通り過ぎる別々の写真（それぞれ1回だけマウントする）
  // とは対照的なものだ。
  flapping: string[];
}

function summarize(events: OverlayEvent[]): LogSummary {
  const byHost = new Map<string, HostStats>();
  let adds = 0;
  let removes = 0;
  let styles = 0;
  for (const event of events) {
    if (event.type === 'mark' || !event.host) continue;
    let stats = byHost.get(event.host);
    if (!stats) {
      stats = { adds: 0, removes: 0, styles: 0 };
      byHost.set(event.host, stats);
    }
    if (event.type === 'add') {
      adds += 1;
      stats.adds += 1;
    } else if (event.type === 'remove') {
      removes += 1;
      stats.removes += 1;
    } else {
      styles += 1;
      stats.styles += 1;
    }
  }
  const flapping = [...byHost].filter(([, stats]) => stats.adds >= 2).map(([host]) => host);
  return { adds, removes, styles, byHost, flapping };
}

function formatTimeline(events: OverlayEvent[]): string {
  return events.map((event) => `${event.t.toFixed(1).padStart(9)}ms  ${event.type}${event.host ? ` ${event.host}` : ''}${event.label ? ` ${event.label}` : ''}`).join('\n');
}

// `wait`は以前ここからエクスポートされていて、これらのテストのNode側で唯一共有された
// 待機処理だった。今はlib-wait.cts（#986）にある。だから遅延が必要な呼び出し元は
// そこから直接`sleep`をrequireする。
module.exports = { launchOverlayBrowser, openFixture, fixtureHtml, takeLog, wheelScroll, continuousScroll, summarize, formatTimeline };
