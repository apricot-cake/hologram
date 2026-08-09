'use strict';

// カードのdragstartの配線をdrag-out（#132）向けに実際のレンダラーで検証する:
//
//  - カード画像から始まるドラッグは横取りされる（preventDefault）＝そうしないと
//    ブラウザ自身のドラッグが動き、原本ファイルの代わりにasset://のサムネイル
//    URLを運んでしまう
//  - ドラッグは選択を絶対に書き換えない。その内側でも外側でも。Explorerは
//    ドラッグしたものを選択したように見えるが、それはmousedownによるもの。
//    Hologramの選択はスクロールをまたいで手で組み立てた作業セットであり、
//    Explorerの使い捨てカーソルとは違うので、アプリを離れるジェスチャは
//    それを書き換えてはならない
//  - 画像の外（投稿テキスト）から始まるドラッグはブラウザに任せる
//
// 各ドラッグが「何を渡すか」はここからは観測できない: window.hologramは
// contextBridgeによって深く凍結されているのでIPCをスパイできず、OSのドラッグ
// 自体も手の届かないところにある。その規則は純粋にrecords.tsのdragFilesOfに
// 住んでいて、scripts/test-records-unit.ctsがカバーする。このハーネスはその
// 周りの配線をカバーする。mainの側（名前のゲート、ファイル欠落）は
// scripts/test-library-files.cts。
//
//   node scripts/test-app-drag-out.cts

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-dragout-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
// カードは`image`（ディスク上の実際のスクリーンショット）から描画されるが、
// ドラッグが渡す原本は`media`＝意図的に書き込まない。mainのdrag-outは無い
// パスを落とすので、テストを走らせているマシン上で実際のOSドラッグセッションを
// 一度も開始せずに、ハンドラは最後まで走り切る。
const ids = ['dummy-d1', 'dummy-d2', 'dummy-d3'];
const records: any[] = [];
ids.forEach((id, i) => {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u/status/${900 + i}`,
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

const evalJs = evalSource(async ({ waitFor, neverHappens }) => {
  await waitFor('the grid to show all 3 seeded posts', () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 3);
  // カードが言うテキストで特定する（セルにkey属性は無い＝#618）。
  const postCards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="post-grid"] [data-slot="post-card"]')];
  const cardOf = (n) => postCards().find((c) => (c.textContent || '').includes('本文' + n));
  // オプショナルチェーンではなく名前を付けて投げる: カードと、ドラッグが始まる
  // その一部こそがこのステップそのものなので、無ければ実行を止めてどれが無いか
  // 言わなければならない。`?.`ではジェスチャがスキップされてしまい、後の検証が
  // 無関係な何かを報告することになる。
  const cardMust = (n) => {
    const c = cardOf(n);
    if (!c) throw new Error('the card 本文' + n + ' is missing from the grid');
    return c;
  };
  const partMust = (n, slot) => {
    const part = cardMust(n).querySelector('[data-slot="' + slot + '"]');
    if (!part) throw new Error('the ' + slot + ' of card 本文' + n + ' is missing');
    return part;
  };
  const nameOf = (c) => ((c.textContent || '').match(/本文(\d)/) || [])[0] || '?';
  const selectedKeys = () =>
    postCards()
      .filter((c) => c.hasAttribute('data-selected'))
      .map(nameOf)
      .sort()
      .join(',');
  // 例外を投げるハンドラこそがこのスイートが存在する理由の失敗モード:
  // dispatchEventは再スローしないので、throwの後の死んだ行はページからは見えない
  // ＝それはキャッチされないエラーとしてしか表面化しない。それがまさに、
  // drag-outがこのスイートを緑にしたまま壊れて出荷された経緯（#132/#185）:
  // 以下で検証していることは全てそのthrowより「前」に起き、その後の
  // hologramIpc.dragOut()は一度も走らなかった。
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  // ここでの各ケースは「ドラッグが何も変えなかった」ことを検証するので、待つべき
  // 事後条件が無い: 待機を仕込んでも、それを組んだ瞬間に終わってしまい何も証明
  // しない。だから時間窓は意図的に全部消費する。それが、間違った選択の書き込み
  // （hologramStoreの購読を通じてセルを再描画する）が読まれる前に現れる時間を
  // 与える（#986）。
  const dragFrom = async (el, keep) => {
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    await neverHappens('the drag to rewrite the selection (expected it to stay ' + (keep || 'empty') + ')', () => selectedKeys() !== keep, 300);
    return ev.defaultPrevented;
  };
  const out: Record<string, any> = {};

  // 1. 何も選択していない状態: ドラッグは横取りされ、何も選択しない＝export
  //    ジェスチャはライブラリを見つけたままの状態にしておく
  out.prevented1 = await dragFrom(partMust(0, 'post-card-media'), '');
  out.selAfter1 = selectedKeys();

  // 2. ○リングが無くなった今（#143）のユーザーと同じやり方で、実際の選択を
  //    手で組み立てる: 素のクリックは単一選択、Ctrl-クリックは2枚目を加える。
  cardMust(0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  cardMust(1).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  // 選択の「サイズ」を待ってから、どのカードが入っているかを読む＝だから間違った
  // カードで組み立てられたペアもちゃんと失敗する。
  await waitFor('the two clicked cards to both show as selected', () => selectedKeys().split(',').length === 2);
  out.selBuilt = selectedKeys();

  // 3. その選択の「内側」のカードをドラッグ → 選択は変わらない
  out.prevented3 = await dragFrom(partMust(0, 'post-card-media'), '本文0,本文1');
  out.selAfter3 = selectedKeys();

  // 4. その選択の「外側」のカードをドラッグ → それでも変わらない。手で組み立てた
  //    作業セットはExplorerの使い捨てカーソルではない。1枚のカードをドラッグ
  //    しても、それを消してはいけない（実際にどのファイルが出ていくかは
  //    records.tsのdragFilesOf＝test-records-unit）。
  out.prevented4 = await dragFrom(partMust(2, 'post-card-media'), '本文0,本文1');
  out.selAfter4 = selectedKeys();

  // 5. 投稿テキストから始まるドラッグはこちらのものではない＝ブラウザが保つ
  const txt = partMust(2, 'post-card-meta');
  out.preventedText = await dragFrom(txt, '本文0,本文1');
  out.selAfterText = selectedKeys();
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
    console.log('DRAG_OUT_TEST_FAIL（eval結果なし）');
    process.exit(1);
  }
  const checks = [
    ['カード画像のドラッグが横取りされる', r.prevented1 === true],
    ['ドラッグは何も選択しない（exportはライブラリを変えてはいけない）', r.selAfter1 === ''],
    ['クリック + Ctrl-クリックで選択が組み立てられる', r.selBuilt === '本文0,本文1'],
    ['選択の内側をドラッグしても選択は変わらない', r.prevented3 === true && r.selAfter3 === '本文0,本文1'],
    ['選択の外側をドラッグしても選択は変わらない', r.prevented4 === true && r.selAfter4 === '本文0,本文1'],
    ['画像の外からのドラッグはブラウザに任せる', r.preventedText === false],
    ['画像の外からのドラッグは選択を変えない', r.selAfterText === '本文0,本文1'],
    // 出荷されたバグを捕まえていたはずのもの: どのドラッグも例外を投げては
    // いけない。投げるとその後のIPC呼び出しが黙って一度も起きなくなる。
    ['どのドラッグも例外を投げなかった（投げるとその後のIPCがスキップされる）', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r));
  console.log(failed ? 'DRAG_OUT_TEST_FAIL' : 'DRAG_OUT_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
