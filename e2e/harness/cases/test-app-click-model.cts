'use strict';

// 統一されたカードのクリックモデル（#143、リデザイン P2⑥）を実際のレンダラーで
// 検証する:
//
//   - 投稿カードにはホバーの ℹ / ○ 選択リングが「無い」（ホバー部品ゼロ＝
//     純粋な Eagle モデル）
//   - 素のクリックは投稿を単一選択し「かつ」インスペクタを開く
//   - インスペクタのプレビューサムネイルはビューワを
//     開く（peek）
//   - Ctrl+クリックは選択に2枚目のカードを加える（Shift の範囲選択は
//     records.test.ts の選択構築でカバー済み）
//   - 投稿者カードにもホバー部品は無い。素のクリックは投稿者インスペクタを
//     開き、ダブルクリックはその投稿者の投稿へ潜る
//   - 投稿のダブルクリックは画像ビューを開く（タブ内履歴の行き先）
//   - Home/End は選択を最初/最後のカードへ飛ばす。矢印ナビと同じ番人と移動後
//     の手順を使い回す（#672）。検索ボックスに向けた Home/End はブラウザに
//     任せ（キャレットの行頭/行末移動）、横取りしない
//
// この操作はセルそれ自身の props（#618）なので、実際の合成 MouseEvent を
// 発火させ、その結果の DOM 状態（インスペクタが開いた、ライトボックスが
// マウントされた、画像ビューが有効）を検証する。
// ブラックボックスの形。自前のサンドボックス化された Electron を起動する
// （HOLOGRAM_SMOKE）。
//
//   node e2e/harness/cases/test-app-click-model.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { readEvalResult } = require('../../../scripts/lib-eval-result.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-clickmodel-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// どの投稿も自分の url を持つ → それぞれが投稿者も生む（buildUsers）。media は
// ディスク上の原本画像で、カードとインスペクタのサムネイルが描かれるようにする。
const ids = ['dummy-c1', 'dummy-c2', 'dummy-c3'];
const records: any[] = [];
ids.forEach((id, i) => {
  fs.writeFileSync(path.join(saveFolder, `${id}-orig.jpg`), jpeg);
  records.push({
    captureId: id,
    image: null,
    url: `https://x.com/u${i}/status/${900 + i}`,
    platform: 'x',
    text: `本文${i}`,
    displayName: `人${i}`,
    screenName: `u${i}`,
    capturedAt: `2026-05-0${i + 1}T12:00:00Z`,
    date: `2026-04-0${i + 1}T10:00:00Z`,
    media: [{ file: `${id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
    tags: [],
    hashtags: [],
  });
});
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, waitStable, neverHappens }) => {
  const postCards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="post-grid"] [data-slot="post-card"]')];
  // カードは、人が指し示すのと同じやり方で特定する: そこに書いてある内容で。
  // セルはもうキー/添字の属性を持たない（#618）— シードした投稿は本文0/1/2
  // と読める。
  const cardOf = (n) => postCards().find((c) => (c.textContent || '').includes('本文' + n));
  // カードそのものがステップである箇所では、オプショナルチェインではなく
  // 名前を付けて弾く: カードが無い場合は実行を止めてそう言うべきで、操作を
  // 飛ばして後の主張に無関係な何かを報告させてはいけない。
  const cardMust = (n) => {
    const c = cardOf(n);
    if (!c) throw new Error('グリッドにカード 本文' + n + ' が見つからない');
    return c;
  };
  const nameOf = (c) => ((c.textContent || '').match(/本文(\d)/) || [])[0] || '?';
  const selectedCards = () => postCards().filter((c) => c.hasAttribute('data-selected'));
  const selectedKeys = () => selectedCards().map(nameOf).sort();
  const selectedCard = () => selectedCards()[0] || null;
  const selectedIndex = () => {
    const c = selectedCard();
    return c ? postCards().indexOf(c) : -1;
  };
  const arrow = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const click = (el, mods?) => el && el.dispatchEvent(new MouseEvent('click', Object.assign({ bubbles: true }, mods)));
  const dblclick = (el) => el && el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  // このパネルには自前の id が無い（P2⑦）— data-slot がフックで、中の部品と
  // 同じ。
  const insp = () => document.querySelector<HTMLElement>('[data-slot="inspector"]');
  const inspVisible = () => {
    const el = insp();
    return !!el && !el.hidden;
  };
  const inspMust = () => {
    const el = insp();
    if (!el) throw new Error('インスペクタパネルが DOM に見つからない');
    return el;
  };
  // peek のオーバーレイは条件付きで描画される（P2⑦）。#62 以降は shadcn の
  // Dialog なので、スクリムは閉じた後もフェードの分だけ長生きする —
  // [data-open] は存在ではなく開いている状態を表す。
  const viewerOpen = () => !!document.querySelector('[data-slot="viewer-image"]');
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  await waitFor('グリッドがシードした3件の投稿すべてを表示すること', () => postCards().length >= 3);
  // これらのケースを書いた前提のレイアウト。失敗した時に「どの」レイアウトで
  // 失敗したかを言うために報告する（#975）: 矢印/Home/End の主張は DOM の
  // 添字を読むが、それが揃うのはシードした全件が仮想ウィンドウの内側にある
  // 間だけ。
  const grid = document.querySelector('[data-slot="post-grid"]');
  if (!grid) throw new Error('投稿グリッドが DOM に見つからない');
  out.viewport = { w: innerWidth, h: innerHeight, cards: postCards().length, grid: Math.round(grid.getBoundingClientRect().width) };

  // A. 投稿カードには ℹ / ○ のホバー部品が無い（#143 で退役した）
  // 今はホバーで何も現れない（ケース A として確認済み）: ℹ も 🏷 も ○ リングも
  // ハイライトも無し。
  out.postHoverParts = document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"] button, [data-slot="post-grid"] [data-slot="post-card"] [class*="act-pill"]').length;
  // 上のゼロに対する対照実験: 同じ子孫クエリで、「何らかの」子を求める。中身が
  // 見えないカードもホバー部品0を報告してしまうので、そのゼロは何も意味しない
  // （#635）。
  out.postCardParts = document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"] *').length;

  // B. 素のクリック＝単一選択＋インスペクタ（投稿の種別、投稿者ヘッドなし）
  click(cardOf(0));
  out.inspOpenedB = await waitFor('クリックした投稿カードでインスペクタが開くこと', inspVisible);
  const inspB = insp();
  out.inspIsPost = !!inspB && !inspB.hidden && !!inspB.querySelector('[data-slot="inspector-post"]');
  // 「クリックしたカードが選択済みとして表示される」ことを待ってから選択
  // 「全体」を読むことで、主張を生かしたままにする: 別のカードも選択済みの
  // ままにしてしまうクリックはそれでも失敗する。
  await waitFor('クリックしたカードが選択済みとして表示されること', () => {
    const c = cardOf(0);
    return !!c && c.hasAttribute('data-selected');
  });
  out.selAfterB = selectedKeys().join(',');

  // C. インスペクタのプレビューサムネイル → ビューワ
  // (peek)。Esc で閉じる
  const thumb = inspMust().querySelector('[data-slot="inspector-thumb"]');
  // 単一画像のプレビューはカーセル用の data-peek を持たない。クリックで開ける
  // サムネイルであることを、実際の遷移で検証する。
  out.thumbViewable = !!thumb;
  click(thumb);
  out.viewerOpened = await waitFor('インスペクタのサムネイルからビューワが開くこと', () => viewerOpen());
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  out.viewerClosed = await waitFor('Esc でビューワが閉じること', () => !viewerOpen());

  // D. Ctrl+クリックは2枚目のカードを加える（上の素のクリックで c1 は選択済み
  // のまま）
  click(cardOf(1), { ctrlKey: true });
  await waitFor('Ctrl+クリックしたカードが選択に加わること', () => {
    const c = cardOf(1);
    return !!c && c.hasAttribute('data-selected');
  });
  out.selAfterD = selectedKeys().join(',');

  // D2. 矢印キーは単一選択をグリッドの中で移動させ（P2⑥）、インスペクタが
  // それに追従する — この組が連続タグ付けを一つの操作にまとめる。真ん中の
  // カードから始めるのは、ソート順がどうであれ両方向に行き先があるようにする
  // ため。
  click(cardOf(1));
  await waitFor('真ん中のカードが単一選択になること', () => {
    const c = cardOf(1);
    return selectedCards().length === 1 && !!c && c.hasAttribute('data-selected');
  });
  const startIdx = postCards().indexOf(cardMust(1));
  arrow('ArrowRight');
  // 選択が元の位置を「離れる」のを待ってから、その歩幅を別途計測する —
  // 「右へ1枚」を待ってしまうとそれ自体が主張になってしまう。
  await waitFor('→ の後で選択が真ん中のカードから動くこと', () => selectedIndex() !== startIdx);
  out.arrowRightSel = selectedKeys().join(',');
  out.arrowRightStep = selectedIndex() - startIdx;
  const afterArrow = selectedCard();
  out.arrowFollowsInspector = !!afterArrow && afterArrow.hasAttribute('data-inspected');
  arrow('ArrowLeft');
  arrow('ArrowLeft');
  // 2回連続のキーには中間の位置があるので、ここでは「動いた」だけでは
  // 足りない: 特定の値ではなく添字が変化しなくなるのを待つ。
  await waitStable('← ← の後で選択が落ち着くこと', () => selectedIndex());
  out.arrowLeftStep = selectedIndex() - startIdx;
  // 最後へ折り返すのではなく、最初のカードで頭打ちになる。
  arrow('ArrowLeft');
  await waitStable('最初のカードで ← の後に選択が落ち着くこと', () => selectedIndex());
  out.arrowClampedAtStart = selectedIndex() === 0;

  // D2b. Home/End（#672）は矢印移動が一度も届かない両端へ直接飛ぶ。同じ選択の
  // 基本操作を使い回す — 上の頭打ちにより今は添字0にいるので、End は
  // 「最後」のカードまで移動しなければならず、2回目の End は何もしない
  // （すでにそこにいる — 何も変化せず例外も出ないはず）。
  const lastIdx = postCards().length - 1;
  arrow('End');
  await waitFor('End で選択が最初のカードから飛び去ること', () => selectedIndex() !== 0);
  out.endSelIndex = selectedIndex();
  const afterEnd = selectedCard();
  out.endFollowsInspector = !!afterEnd && afterEnd.hasAttribute('data-inspected');
  arrow('End');
  // 何もしない操作には「待つべきもの」が無い — 添字が動かなくなるのを待って
  // から読む。
  await waitStable('2回目の End で選択がそのまま留まること', () => selectedIndex());
  out.endIsIdempotent = selectedIndex() === lastIdx;
  arrow('Home');
  await waitFor('Home で選択が最後のカードから飛び去ること', () => selectedIndex() !== lastIdx);
  out.homeSelIndex = selectedIndex();

  // D3c. Home/End はテキスト欄自身のキャレット行頭/行末移動を横取りしては
  // ならない（#672 の受け入れ基準）— 検索ボックスの input は本物
  // （SearchBox.tsx）なので、それにフォーカスし、「入力欄に向けた」 Home で
  // グリッドの選択がそのまま留まることを確認する。矢印キーがすでに得ている
  // のと同じ番人。
  const searchInput = document.querySelector<HTMLInputElement>('[data-slot="toolbar-search"] input');
  out.searchInputFound = !!searchInput;
  if (searchInput) {
    searchInput.focus();
    const beforeGuardIdx = selectedIndex();
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    // どちらの番人も「起きないこと」を証明するので、それぞれの観測窓をあえて
    // 使い切る（#986）。
    out.homeIgnoredInSearchBox = await neverHappens('検索ボックスの中で Home によりグリッドの選択が動くこと', () => selectedIndex() !== beforeGuardIdx, 300);
    searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    out.endIgnoredInSearchBox = await neverHappens('検索ボックスの中で End によりグリッドの選択が動くこと', () => selectedIndex() !== beforeGuardIdx, 300);
    searchInput.blur();
  }

  // 投稿者 nav の active 状態は browseMode を追う（グリッドは CSS で隠される
  // だけでアンマウントはされないので、投稿者カードは DOM に残り続ける —
  // active な nav がモードの目印）。
  const navActive = () => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '投稿者');
    return !!(b && b.hasAttribute('data-active') && b.getAttribute('data-active') !== 'false');
  };

  // E. 投稿者ビューへ切り替える → 投稿者カードには ℹ ボタンが無い
  const posterNav = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '投稿者');
  if (!posterNav) throw new Error('サイドバーに投稿者の nav ボタンが見つからない');
  posterNav.click();
  out.posterCardsShown = await waitFor('投稿者ビューが有効になり投稿者カードを表示すること', () => navActive() && document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length >= 1);
  // 投稿者カードにもホバー部品は無い＝A と同じやり方で数える。
  // これはかつて [data-slot="poster-info"] を数えていたが、tag-pop が撤去
  // された後（1512e839）その ℹ ボタンはアプリのどこにも無くなったので、
  // カウントは常に0になる＝決して失敗し得ない検証になっていた（#635）。
  // 今使っている2つの目印は、どちらも同じ実行の中で生きていることを確認
  // 済み: poster-card はすぐ上の posterCardsShown が >= 1 であることで確認
  // され、button は HTML のタグなので消えようがない。退役した名前を数える
  // やり方には戻らないこと。
  out.posterHoverParts = document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"] button, [data-slot="poster-grid"] [data-slot="poster-card"] [class*="act-pill"]').length;
  out.posterCardParts = document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"] *').length; // A と同じ対照実験

  // F. 投稿者を素のクリック → 投稿者インスペクタ（投稿者ヘッドのブロックを
  // 持つ）
  const posterCardMust = () => {
    const c = document.querySelector<HTMLElement>('[data-slot="poster-grid"] [data-slot="poster-card"]');
    if (!c) throw new Error('投稿者ビューにクリックできる投稿者カードが無い');
    return c;
  };
  posterCardMust().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.inspOpenedF = await waitFor('クリックした投稿者カードでインスペクタが開くこと', inspVisible);
  out.posterSelectionRing = await waitFor('クリックした投稿者カードに投稿と同じ不透明な外枠が描画されること', () => {
    const c = posterCardMust();
    const style = getComputedStyle(c);
    return c.hasAttribute('data-inspected') && style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) === 2 && parseFloat(style.outlineOffset) === 2 && style.outlineColor !== 'rgba(0, 0, 0, 0)';
  });
  const inspF = insp();
  out.inspIsPoster = !!inspF && !inspF.hidden && !!inspF.querySelector('[data-slot="inspector-poster"]');

  // 投稿者インスペクタの作品から画像ビューへ進み、戻ると同じ投稿者の
  // インスペクタ、選択枠、カードの表示をまとめて復元する。
  const posterWork = inspF?.querySelector<HTMLElement>('[data-slot="inspector-work-thumb"]');
  if (!posterWork) throw new Error('投稿者インスペクタに最近の作品が見つからない');
  click(posterWork);
  out.posterWorkOpened = await waitFor('投稿者インスペクタの作品で画像ビューが開くこと', () => !!document.querySelector('[data-slot="image-tab-view"]'));
  const backButton = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === '戻る');
  if (!backButton) throw new Error('戻るボタンが見つからない');
  click(backButton);
  out.posterRestoredAfterBack = await waitFor('戻ると同じ投稿者のインスペクタと選択枠が復元されること', () => {
    const inspected = document.querySelector<HTMLElement>('[data-slot="poster-grid"] [data-slot="poster-card"][data-inspected]');
    return navActive() && !!inspected && !!insp()?.querySelector('[data-slot="inspector-poster"]');
  });

  // G. 投稿者をダブルクリック → その投稿者の投稿へ潜る（browseMode が
  // 投稿者ビューを離れる）
  const restoredPoster = document.querySelector<HTMLElement>('[data-slot="poster-grid"] [data-slot="poster-card"][data-inspected]');
  if (!restoredPoster) throw new Error('戻った投稿者カードが選択状態になっていない');
  dblclick(restoredPoster);
  out.drilledIn = await waitFor('ダブルクリックした投稿者がその投稿へ潜ること', () => !navActive());

  // 投稿インスペクタの投稿者リンクは投稿者ビューへ移り、対象カードを選択して
  // 表示範囲へ運ぶ。仮想グリッド上でも DOM に現れることがこの検査になる。
  click(postCards()[0]);
  await waitFor('投稿インスペクタに投稿者リンクが出ること', () => !!document.querySelector('[data-slot="inspector-author-link"]'));
  const authorLink = document.querySelector<HTMLElement>('[data-slot="inspector-author-link"]');
  if (!authorLink) throw new Error('投稿インスペクタの投稿者リンクが見つからない');
  click(authorLink);
  out.authorJumpSelected = await waitFor('投稿者リンクで対象の投稿者カードが選択されること', () => navActive() && !!document.querySelector('[data-slot="poster-grid"] [data-slot="poster-card"][data-inspected]'));
  const jumpedPoster = document.querySelector<HTMLElement>('[data-slot="poster-grid"] [data-slot="poster-card"][data-inspected]');
  if (!jumpedPoster) throw new Error('投稿者リンクの移動先カードが見つからない');
  dblclick(jumpedPoster);
  await waitFor('移動先の投稿者から投稿一覧へ戻れること', () => !navActive());

  // H. 投稿をダブルクリック → 画像ビュー（タブ内履歴の行き先）
  dblclick(postCards()[0]);
  out.imageViewActive = await waitFor('ダブルクリックした投稿で画像ビューが開くこと', () => !!document.querySelector('[data-slot="image-tab-view"]'));

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
    console.log('CLICK_MODEL_TEST_FAIL (eval の結果が無い)');
    process.exit(1);
  }
  const checks = [
    ['投稿カードに ℹ / ○ のホバー部品が無い', r.postHoverParts === 0],
    ['…かつ中身は見えていた（そのゼロは本物のゼロ）', r.postCardParts >= 1],
    ['素のクリックでインスペクタが開く', r.inspOpenedB === true],
    ['素のクリックで投稿インスペクタが出る', r.inspIsPost === true],
    ['素のクリックでカードを単一選択する', r.selAfterB === '本文0'],
    ['インスペクタのサムネイルが peek（拡大）を示している', r.thumbViewable === true],
    ['インスペクタのサムネイルでビューワが開く', r.viewerOpened === true],
    ['Esc でビューワが閉じる', r.viewerClosed === true],
    ['Ctrl+クリックで2枚目のカードが加わる', r.selAfterD === '本文0,本文1'],
    ['→ で選択が1枚移動し単一のまま', r.arrowRightStep === 1 && r.arrowRightSel.split(',').length === 1],
    ['矢印移動でインスペクタが新しいカードへ切り替わる', r.arrowFollowsInspector === true],
    ['← で選択が戻る', r.arrowLeftStep === -1],
    ['← は折り返さず最初のカードで頭打ちになる', r.arrowClampedAtStart === true],
    ['End で最後のカードへ飛ぶ', r.endSelIndex === 2],
    ['End も矢印移動と同じくインスペクタが追従する', r.endFollowsInspector === true],
    ['2回目の End（すでにそこ）は例外ではなく何もしない', r.endIsIdempotent === true],
    ['Home で最初のカードへ戻る', r.homeSelIndex === 0],
    ['検索ボックスの input が実際に見つかった（下の番人が偽陽性でない）', r.searchInputFound === true],
    ['検索ボックスに向けた Home はグリッドの選択に触れない', r.homeIgnoredInSearchBox === true],
    ['検索ボックスに向けた End はグリッドの選択に触れない', r.endIgnoredInSearchBox === true],
    ['投稿者カードが描画される', r.posterCardsShown === true],
    ['投稿者カードに ℹ / ○ のホバー部品が無い', r.posterHoverParts === 0],
    ['…かつ中身は見えていた（そのゼロは本物のゼロ）', r.posterCardParts >= 1],
    ['素のクリックで投稿者インスペクタが開く', r.inspOpenedF === true && r.inspIsPoster === true],
    ['クリックした投稿者カードに投稿と同じ不透明な外枠が描画される', r.posterSelectionRing === true],
    ['投稿者の作品から戻ると投稿者インスペクタと選択枠が復元される', r.posterWorkOpened === true && r.posterRestoredAfterBack === true],
    ['投稿者をダブルクリックするとその投稿へ潜る', r.drilledIn === true],
    ['投稿インスペクタの投稿者リンクが対象カードを選択する', r.authorJumpSelected === true],
    ['投稿をダブルクリックすると画像ビューが開く', r.imageViewActive === true],
    ['どのハンドラも例外を投げなかった', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'CLICK_MODEL_TEST_FAIL' : 'CLICK_MODEL_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
