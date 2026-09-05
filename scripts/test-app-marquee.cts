'use strict';

// 実際のレンダラーでグリッドの空白部分のジェスチャを検証する＝同じ押下の両半分:
// ドラッグすればバンドが触れたカードを選択し（#484）、ドラッグせずに離せば選択が
// 消える（#242）。
//
// scripts/marquee.test.ts ではカバーできないこと: ジェスチャが正しい要素に配線
// されていること、ヒットテストが masonic の positioner を読むこと、そしてその答えが
// カードが実際に「ある」場所と一致すること（このテストは実際の DOM の rect から期待値を
// 導いて比較する＝モデルと現実の対比が、仮想化グリッドにおけるリスクの全て）。加えて
// 各種ガード: Ctrl は置き換えではなく拡張、Esc は復元、モディファイアが押されていると
// 背景クリックは何もしない、インスペクタは選択を追ってプレースホルダまで戻る。
//
// カバーできないこと: 実際のジェスチャの手触りと自動スクロール＝合成イベントは
// フレームを瞬時に飛び越える。それには実際のポインタが要る（#484 自身の本文どおり）。
//
//   node scripts/test-app-marquee.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-marquee-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// masonry の行が複数できる程度の投稿数＝バンドが周りの行に触れずに1行だけを
// 横切れるようにする。
const records: any[] = [];
for (let i = 0; i < 12; i++) {
  const id = `dummy-m${i}`;
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u${i}/status/${900 + i}`,
    platform: 'x',
    text: `本文${i}`,
    displayName: `人${i}`,
    screenName: `u${i}`,
    capturedAt: `2026-05-01T12:00:${String(i).padStart(2, '0')}Z`,
    date: `2026-04-01T10:00:${String(i).padStart(2, '0')}Z`,
    media: [{ file: `${id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
    tags: [],
    hashtags: [],
  });
}
seedLibrary(configDir, records);

// sleep / waitFor / waitStable / neverHappens と WAIT_DEADLINE の予算（#952）は
// 第一引数として入ってくる＝scripts/lib-wait.cts。本体をテンプレートリテラルでは
// なく実際の関数にしているのは、Biome の no-fixed-wait プラグインと tsc の
// 両方が読めるようにするため。これはシリアライズされるので、このファイルの
// 何にもクロージャしない。
const evalJs = evalSource(async ({ waitFor, waitStable, neverHappens }) => {
  const cards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="post-grid"] [data-slot="post-card"]')];
  // カードは自分自身のテキストで識別される（key 属性はない＝#618）。
  const nameOf = (c) => ((c.textContent || '').match(/本文\d+/) || [])[0] || '?';
  const selectedKeys = () =>
    cards()
      .filter((c) => c.hasAttribute('data-selected'))
      .map(nameOf)
      .sort();
  const band = () => document.querySelector('[data-slot="grid-marquee"]');
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  const rectsOf = (sel) =>
    [...document.querySelectorAll(sel)].map((c) => {
      const k = c.getBoundingClientRect();
      return [Math.round(k.left), Math.round(k.top), Math.round(k.width), Math.round(k.height)];
    });

  await waitFor('the grid to show all 12 seeded posts', () => cards().length >= 12);
  // 以下の期待値は全てこれらの rect から導かれるので、フレーム数を固定して待つの
  // ではなく masonic が測定する高さが動かなくなるのを待つ。
  out.gridSettled = await waitStable('the masonry layout to stop moving', () => rectsOf('[data-slot="post-grid"] [data-slot="post-card"]'));

  // オプショナルチェーンではなく名前を付ける: 以下の座標は全てこの要素から測定
  // するので、scroller が無い場合は実行を止めてそう告げなければならない。その
  // RECT はここでは読まない＝各ケースが自分自身で取得する。インスペクタの列が
  // 埋まったり空になったりするとグリッドの端が動き、一度だけ取得した値の
  // 下で動いてしまうから（#1007）。
  const scroller = document.querySelector<HTMLElement>('[data-slot="content-scroll"]');
  if (!scroller) throw new Error('the content scroller is missing — the grid never mounted');

  // `mods` は省略可能: ここでの押下のほとんどはモディファイアを持たず、
  // Object.assign に undefined を渡しても何も起きない＝テンプレートリテラル版
  // と同じ呼び出しの形。
  const down = (x, y, mods?) => scroller.dispatchEvent(new MouseEvent('mousedown', Object.assign({ bubbles: true, button: 0, clientX: x, clientY: y }, mods)));
  const move = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  const up = () => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  // 一切動かさずに押して離す: ジェスチャのクリック側の半分（#242）。'click' イベント
  // は合成しないので、狭いオーバーレイの外側クリックでの閉じ動作（別のリスナー）が
  // ここで測っているものになり得ない。
  const click = (x, y, mods?) => {
    down(x, y, mods);
    up();
  };
  const inspectedCards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"][data-inspected]').length;
  const panelFilled = () => !!document.querySelector('[data-slot="inspector-body"] [data-slot="inspector-tags"]');
  // パネルの「何も選択されていない」状態（#244）。「埋まっていない」ことではなく
  // 単独で検証する: プレースホルダが「そこにある」ことが要件で、パネルはどちらの
  // 幅でもそれを描画する（画面上に列があるかどうかだけが違う）。
  const panelPlaceholder = () => !!document.querySelector('[data-slot="inspector-body"] [data-slot="inspector-empty"]');

  // バンドが触れるはずのカードを、実際の DOM の rect から計算する＝アプリの
  // positioner ベースのヒットテストが一致しなければならない独立した答え。
  const expectFor = (x0, y0, x1, y1) => {
    const l = Math.min(x0, x1),
      r = Math.max(x0, x1),
      t = Math.min(y0, y1),
      b = Math.max(y0, y1);
    return cards()
      .filter((c) => {
        const k = c.getBoundingClientRect();
        return l < k.right && r > k.left && t < k.bottom && b > k.top;
      })
      .map(nameOf)
      .sort();
  };
  // 一通りの流れ: 左マージンで押下、しきい値を越え、ドラッグ、離す。expect 引数は
  // このドラッグが収束すべき答え＝expectFor による実際の rect の独立した読み取り。
  // それを待つ方がジェスチャの間ずっと sleep するより良い。待つ価値のある2つの
  // ことが時計では動かないから:
  //   - バンドはしきい値越えの move で同期的に作られるので、「バンドが存在する」
  //     ことが押下が発動した証拠になる；
  //   - 離す動作は最後に1回、同期的なヒットテストを走らせ、DOM はその答えを
  //     React がストアの書き込みをコミットして初めて表示する。
  // 間にある rAF フレームは待たない: このスイートで測定すると隠しウィンドウでは
  // 1フレームあたり0.7〜1.0秒かかったので、以前ここにあった sleep(120) も
  // どのみち1フレームすら見ていなかった＝これら4つのドラッグが実際に検証するのは
  // 離す動作そのもの。ケース E だけは意図的にライブプレビューの経路を担当し、
  // それ用のサイズの待機を持つ。
  const drag = async (x0, y0, x1, y1, mods, expect) => {
    down(x0, y0, mods);
    move(x0 + 8, y0 + 8); // past MARQUEE_THRESHOLD → the band arms itself
    await waitFor('the band to appear once the drag passed its threshold', () => !!band(), 3000);
    move(x1, y1);
    up();
    if (expect) await waitFor('the released drag to select exactly the cards it crossed', () => selectedKeys().join(',') === expect.join(','), 4000);
  };

  // 行は上から順に、丸めた top でグループ化し左から右へ並べる＝一度スナップショット
  // するのではなく毎回新しく読む。カードは画像がアスペクト比を報告する前に高さを
  // 確保するため（PostCard の CardThumb → onAspect）、masonry は上の settle の後も
  // まだ動くことがあり、それが属する押下より古い読み取りから配置したバンドは、
  // もう何も無い場所に落ちることがある（#1007）。
  const readRows = () => {
    const byTop: Record<number, Array<{ el: HTMLElement; r: DOMRect }>> = {};
    for (const c of cards()) {
      const k = c.getBoundingClientRect();
      const key = Math.round(k.top);
      (byTop[key] = byTop[key] || []).push({ el: c, r: k });
    }
    return Object.keys(byTop)
      .map(Number)
      .sort((a, b) => a - b)
      .map((t) => byTop[t].sort((a, b) => a.r.left - b.r.left));
  };
  // 各ケースがバンドを置くために必要な全てを、そのケースが動く瞬間に測定し、
  // 次のケースへは決して持ち越さない。1つの読み取りを使い回すことがケース C を
  // 壊した原因（#1007）: ランナーは実行中に masonry を再レイアウトする＝
  // windows-latest で測定したところ、ケース H の後の rect は40回の実行全てで
  // ここで読んだものと異なっていた＝つまり前のケースの座標は隙間を指すことが
  // あり、そこに置いたバンドは何も横切らない。scroller も再度読み直す。
  // インスペクタの列が動くとグリッドの左端も一緒に動くため。
  //
  // `index` は masonry の行で上から順。2枚のカードが全ケースが必要とする
  // 最小限（左マージンから2列目の中央までのバンド）。
  const settles: boolean[] = [];
  const rowNow = async (label, index) => {
    settles.push(await waitStable(`the masonry layout to stop moving before ${label}`, () => rectsOf('[data-slot="post-grid"] [data-slot="post-card"]')));
    const row = readRows()[index];
    // オプショナルチェーンではなく名前を付ける: このケースの座標は全てこれらの
    // カードから測定するので、そのような行をレイアウトしなかったグリッドは
    // 実行を止めてそう言わなければならない。
    if (!row || row.length < 2) throw new Error(`the grid laid out no row ${index} of two cards for ${label}`);
    const box = scroller.getBoundingClientRect();
    return {
      el: row[0].el,
      cy: Math.round((row[0].r.top + row[0].r.bottom) / 2),
      x0: Math.round(box.left + 6), // scrollerのパディング: 空白部分
      xFirst: Math.round((row[0].r.left + row[0].r.right) / 2),
      xSecond: Math.round((row[1].r.left + row[1].r.right) / 2),
    };
  };

  const rows0 = readRows();
  out.rowCount = rows0.length;
  out.row0Count = rows0[0].length;
  // 行0を貫く細い水平バンド。左マージンから2列目の中央まで＝つまりその行の最初の
  // 2枚のカードだけを取るはず。
  const a = await rowNow('the plain drag', 0);
  // 「カードの上ではないか」が問いで、これはグリッド自身の押下認識器が問うのと
  // 同じもの（_shared/VirtualGrid.tsx: closest() でセルに到達しない限り押下は
  // 背景扱い）。以前はその要素が scroller そのものであることを要求していたが、
  // これはアプリの実際の契約より厳しい: 幅によってはその点がグリッド自身の
  // ラッパーに落ちる＝それでも空白であり背景の押下だが、変わっていないものを
  // テストしたままケースが失敗していた。
  out.startsOnEmptySpace = !document.elementFromPoint(a.x0, a.cy)?.closest('[data-slot="post-card"], [data-slot="poster-card"]');

  // A. 素のドラッグは触れたものだけを選択し、他は何も選択しない
  out.expectA = expectFor(a.x0, a.cy - 5, a.xSecond, a.cy + 5);
  await drag(a.x0, a.cy - 5, a.xSecond, a.cy + 5, undefined, out.expectA);
  out.gotA = selectedKeys();
  out.scrolledA = scroller.scrollTop; // the band stayed clear of the auto-scroll edges
  // 「選択モードに入った」は、下部のフローティングバーが表示されているかで
  // 検証する（グリッド側の .selecting クラスは、それが隠すはずだったホバー部分と
  // 一緒に消えた＝#618 で決定案 A が確定した）。
  out.selectingClass = document.querySelector('[data-slot="selection-bar"]')?.getAttribute('aria-hidden') === 'false';
  out.bandRemovedA = !band();

  // B. しきい値を一度も越えない押下はバンドを描かず、Ctrl を押していれば選択を
  //    一切変えない（#242 はモディファイアがあれば clear をスキップする）
  down(a.x0, a.cy, { ctrlKey: true });
  move(a.x0 + 1, a.cy + 1);
  // 以下の両方の待機時間は「起きなかったことを証明する」検査なので、意図的に
  // タイムアウトを丸ごと消費する（#986）＝事後条件を待つと、必ず通ってしまう
  // 検査になる。同じ理由で短く保っている。
  out.bandDuringB = !(await neverHappens('a band to appear from a press under the threshold', () => !!band(), 200));
  up();
  const afterA = out.gotA.join(',');
  await neverHappens('the release under the threshold to disturb the selection', () => selectedKeys().join(',') !== afterA, 200);
  out.gotB = selectedKeys();

  // C. 押下時に Ctrl を押していると拡張になる: 行1の最初の2枚が行0のものに加わる
  const c = await rowNow('the Ctrl+drag', 1);
  // 独立したフィールドとして保持し、独立した行として検査する。下の expectC は
  // ケース A が選択を残した状態との和集合になるため: 何も横切らないバンドは
  // expectC を gotA へ潰してしまい、その検査はリリースに矛盾する2つのこと
  // （「前と同じカード」かつ「前より多いカード」）を同時に求めることになる。
  // それを満たす答えは無いので、実際には Ctrl+drag が動いているのにケースは
  // 壊れていると報告した（#1007）。
  out.bandC = expectFor(c.x0, c.cy - 5, c.xSecond, c.cy + 5);
  out.expectC = [...new Set([...out.gotA, ...out.bandC])].sort();
  await drag(c.x0, c.cy - 5, c.xSecond, c.cy + 5, { ctrlKey: true }, out.expectC);
  out.gotC = selectedKeys();

  // D. 1枚のカードだけを覆う素のドラッグは、これまでの選択を全て置き換える
  const d = await rowNow('the replacing drag', 0);
  out.expectD = expectFor(d.x0, d.cy - 5, d.xFirst, d.cy + 5);
  await drag(d.x0, d.cy - 5, d.xFirst, d.cy + 5, undefined, out.expectD);
  out.gotD = selectedKeys();

  // E. バンドはドラッグ中に描画され、Esc は選択を元に戻す
  const e = await rowNow('the live-preview drag', 1);
  const before = selectedKeys();
  down(e.x0, e.cy - 5);
  move(e.x0 + 8, e.cy);
  out.bandVisibleE = await waitFor('the band to be painted while dragging', () => !!band(), 3000);
  move(e.xSecond, e.cy + 5);
  // ライブプレビューにはアニメーションフレームが要り、隠しウィンドウは rAF を
  // 強くスロットルする（上のパスが着地するのは、離す動作が最後に1回同期的な
  // パスを行うからにすぎない）＝60Hz の時計を前提にせず、余裕を持って待つ。
  out.changedDuringE = await waitFor('the selection to preview live while the band moves', () => selectedKeys().join(',') !== before.join(','), 6000);
  esc();
  out.bandRemovedE = !band(); // finish('cancel') はオーバーレイを同期的に取り除く
  await waitFor('Esc to put the pre-drag selection back', () => selectedKeys().join(',') === before.join(','), 4000);
  out.gotE = selectedKeys();
  out.expectE = before;
  up(); // 実際のジェスチャもリリースで終わる。バンドを再適用してはならない
  // 再び「何も起きない」の検査: 時間窓を消費すること自体が検証（#986）。
  await neverHappens('the release after Esc to re-apply the cancelled band', () => selectedKeys().join(',') !== before.join(','), 200);
  out.gotEAfterUp = selectedKeys();

  // F. カードの上から始まるドラッグはマーキーではない。要素もこの読み取りから取る＝前の
  // ものからは取らない: masonry のセルは再利用されるので、複数のケースをまたいで
  // 保持したノードは、今ごろ別の投稿を表示していることがある（#1007）。
  const f = await rowNow('the press that starts on a card', 0);
  f.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: f.xFirst, clientY: f.cy }));
  move(f.xSecond, f.cy + 40);
  out.bandFromCard = !(await neverHappens('a band to appear from a drag that started on a card', () => !!band(), 200));
  up(); // no listeners are attached (the press never armed a gesture) — nothing to settle

  // G. 空白部分での素のクリックは選択を消し、かつインスペクタをプレースホルダへ
  //    戻す（#242）。先に行うカードクリックがパネルを埋める側。
  f.el.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: f.xFirst, clientY: f.cy }));
  await waitFor('the clicked card to be selected and fill the inspector', () => selectedKeys().length === 1 && inspectedCards() === 1 && panelFilled(), 4000);
  out.selectedBeforeG = selectedKeys();
  out.inspectedBeforeG = inspectedCards();
  out.panelFilledBeforeG = panelFilled();
  click(f.x0, f.cy);
  await waitFor('the background click to clear the selection and empty the inspector', () => selectedKeys().length === 0 && !panelFilled() && panelPlaceholder(), 4000);
  out.gotG = selectedKeys();
  out.inspectedAfterG = inspectedCards();
  out.panelFilledAfterG = panelFilled();
  out.panelPlaceholderAfterG = panelPlaceholder();
  out.bandDuringG = !!band(); // クリックが矩形を後に残してはいけない

  // H. モディファイアを押した状態での同じクリックは何も変えない（Nautilus /
  //    Dolphin どちらも unselect_all を Ctrl/Shift が離されていることでゲートしている）
  const h = await rowNow('the modifier-held background clicks', 0);
  await drag(h.x0, h.cy - 5, h.xSecond, h.cy + 5, undefined, expectFor(h.x0, h.cy - 5, h.xSecond, h.cy + 5));
  out.beforeH = selectedKeys();
  const beforeH = out.beforeH.join(',');
  // どちらも「モディファイアがこれを無効化する」という主張＝時間窓を消費
  // しなければならず、事後条件で短絡させてはいけない（#986）。
  click(h.x0, h.cy, { ctrlKey: true });
  await neverHappens('Ctrl + a background click to touch the selection', () => selectedKeys().join(',') !== beforeH, 200);
  out.gotHCtrl = selectedKeys();
  click(h.x0, h.cy, { shiftKey: true });
  await neverHappens('Shift + a background click to touch the selection', () => selectedKeys().join(',') !== beforeH, 200);
  out.gotHShift = selectedKeys();

  // I. 最終行の「下」の空白も背景である（#242 で確定した設計3）: グリッドは
  //    カードの分だけの高さしかないので、これが最大のクリック対象であり、
  //    グリッドの rect だけを見るヒットテストでは取りこぼす部分。
  scroller.scrollTop = scroller.scrollHeight;
  // 末尾までスクロールすると masonic のレンダーウィンドウが再構築されるため、
  // 「最終行はどこか」の答えがしばらく動く＝止まるのを待つ。
  out.bottomSettled = await waitStable('the last row to stop moving after scrolling to the bottom', () => [Math.round(scroller.scrollTop), rectsOf('[data-slot="post-grid"] [data-slot="post-card"]')]);
  const lowest = Math.max(...cards().map((c) => c.getBoundingClientRect().bottom));
  const belowY = Math.round(lowest + 24);
  // ここで scroller を再測定する理由は行の場合と同じ（#1007）: インスペクタの列が
  // 冒頭の読み取り以降に埋まったり空になったりし、グリッドの左端と下端も
  // それに伴って動く。
  const srI = scroller.getBoundingClientRect();
  const belowX = Math.round(srI.left + scroller.clientWidth / 2);
  out.belowAvailable = belowY < srI.bottom - 4;
  out.belowIsEmpty = out.belowAvailable && !document.elementFromPoint(belowX, belowY)?.closest('[data-slot="post-card"]');
  out.beforeI = selectedKeys();
  if (out.belowAvailable) {
    click(belowX, belowY);
    await waitFor('the click below the last row to clear the selection', () => selectedKeys().length === 0, 4000);
  }
  out.gotI = selectedKeys();

  // J. 投稿者グリッドも同じジェスチャに乗る（#242）。選択という概念はなく＝
  //    投稿者カードは詳細表示されるだけで選択はされない＝背景クリックがすることは
  //    両グリッドが共有するパネルをプレースホルダへ戻すことだけ。
  [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '投稿者')?.click();
  out.posterCardsShown = await waitFor('the poster grid to show its cards', () => document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length >= 1);
  // masonic は投稿者グリッドをゼロからレイアウトする＝上の投稿グリッドと同じ
  // rect の繰り返し待機。以下の押下位置はこれらの rect から読むため。
  out.posterSettled = await waitStable('the poster grid layout to stop moving', () => rectsOf('[data-slot="poster-grid"] [data-slot="poster-card"]'));
  // オプショナルチェーンではなく名前を付ける: このカードはクリック対象であり、
  // 以下の押下位置を測る物差しでもあるので、無ければ実行を止めなければならない。
  const posterCard = document.querySelector('[data-slot="poster-grid"] [data-slot="poster-card"]');
  if (!posterCard) throw new Error('the poster grid rendered no poster card to click');
  posterCard.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.posterFilledBeforeJ = await waitFor('the clicked poster to fill the inspector', () => !!document.querySelector('[data-slot="inspector-body"] [data-slot="inspector-poster"]'), 4000);
  const pr = posterCard.getBoundingClientRect();
  const py = Math.round((pr.top + pr.bottom) / 2);
  const xJ = Math.round(scroller.getBoundingClientRect().left + 6);
  out.posterPressOnEmpty = !document.elementFromPoint(xJ, py)?.closest('[data-slot="poster-card"]');
  click(xJ, py);
  out.posterPlaceholderAfterJ = await waitFor('the poster grid background click to return the inspector to its placeholder', () => panelPlaceholder(), 4000);

  out.settles = settles;
  out.errors = errors;
  return JSON.stringify(out);
});

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: configDir,
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = readEvalResult(out);
  if (!r) {
    console.log('MARQUEE_TEST_FAIL（eval結果なし）');
    process.exit(1);
  }
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const checks: Array<[string, boolean]> = [
    // 想定ではなく実測で報告する: 以下の期待値は全て、masonic が動きを止めて
    // 初めて意味を持つ rect から読む（#952）。
    ['rect を読む前にグリッドが動きを止めた', r.gridSettled === true],
    ['グリッドが複数行をレイアウトした', r.rowCount >= 2 && r.row0Count >= 2],
    ['押下位置がカードではなく空白部分', r.startsOnEmptySpace === true],
    ['ドラッグが触れたカードだけを選択する', same(r.gotA, r.expectA) && r.gotA.length >= 2],
    ['バンドが自動スクロールの端に触れなかった', r.scrolledA === 0],
    ['グリッドが選択モードに入る', r.selectingClass === true],
    ['リリースでバンドが取り除かれる', r.bandRemovedA === true],
    ['しきい値未満の押下はバンドを描かない', r.bandDuringB === false],
    ['Ctrl + 背景クリックは選択を変えない', same(r.gotB, r.gotA)],
    // 6つの読み取り全てを1行で: 各ケースは自分の座標を測定し、その測定は
    // masonry が動きを止めて初めて意味を持つ。
    ['各ケースが測定前にレイアウトが動きを止めるのを待った', Array.isArray(r.settles) && r.settles.length === 6 && r.settles.every(Boolean)],
    // 下の検査より先に置く理由は、これがあって初めて下が答え可能になるから: 空の
    // バンドは「選択を拡張する」を偽ではなく判定不能にしてしまう（#1007）。
    ['Ctrl+drag のバンドが追加すべきカードを自ら横切る', Array.isArray(r.bandC) && r.bandC.length >= 2],
    ['Ctrl+drag が選択を拡張する', same(r.gotC, r.expectC) && r.gotC.length > r.gotA.length],
    ['素のドラッグが選択を置き換える', same(r.gotD, r.expectD) && r.gotD.length === 1],
    ['バンドがドラッグ中に描画される', r.bandVisibleE === true],
    ['選択がドラッグ中にライブプレビューされる', r.changedDuringE === true],
    ['Esc がバンドを取り除く', r.bandRemovedE === true],
    ['Esc がドラッグ前の選択を復元する', same(r.gotE, r.expectE)],
    ['Esc の後のリリースがバンドを再適用しない', same(r.gotEAfterUp, r.expectE)],
    ['カード上から始まるドラッグはマーキーではない', r.bandFromCard === false],
    ['カードクリックがインスペクタを埋めカードを選択する', r.selectedBeforeG.length === 1 && r.inspectedBeforeG === 1 && r.panelFilledBeforeG === true],
    ['背景クリックが選択を空にする', same(r.gotG, [])],
    ['背景クリックがインスペクタをプレースホルダへ戻す', r.inspectedAfterG === 0 && r.panelFilledAfterG === false && r.panelPlaceholderAfterG === true],
    ['背景クリックがバンドを後に残さない', r.bandDuringG === false],
    ['Ctrl + 背景クリックが選択を保つ', same(r.gotHCtrl, r.beforeH) && r.beforeH.length >= 2],
    ['Shift + 背景クリックが選択を保つ', same(r.gotHShift, r.beforeH)],
    ['最終行の下の空間も背景として扱われる', r.bottomSettled === true && r.belowAvailable === true && r.belowIsEmpty === true && r.beforeI.length > 0 && same(r.gotI, [])],
    ['投稿者クリックがインスペクタを埋める', r.posterCardsShown === true && r.posterSettled === true && r.posterFilledBeforeJ === true],
    ['投稿者グリッドの背景もインスペクタを戻す', r.posterPressOnEmpty === true && r.posterPlaceholderAfterJ === true],
    ['ハンドラが例外を投げなかった', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'MARQUEE_TEST_FAIL' : 'MARQUEE_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
