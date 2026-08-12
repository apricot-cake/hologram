'use strict';

// インスペクタでのインラインタグ編集（リデザイン P2⑦）を実際のレンダラーで検証する:
//
//   - カードを選択すると、そのタグがインスペクタのタグ欄にチップとして表示される
//   - 新しいタグを入力してEnterで追加される（自由文＝まだ語彙に無いもの）、かつ
//     レコードのタグへ永続化される（DBのpost_tags＝#298/St5でタグ編集はDBのみの
//     書き込みになり、sidecarの書き換えではなくなった）
//   - チップの×でタグを再び削除でき、それも永続化される
//   - ソースハッシュタグは欄のポップアップから選ぶことで採用できる
//   - 語彙ポップアップは、ライブラリの他の場所で既に使われているタグを提示する
//   - そのポップアップは欄全体に位置を合わせる。チップの横の素の入力欄（チップが
//     増えるにつれ右へずれて狭くなる）ではなく
//   - カードのコンテキストメニューの「タグを編集」はキャレットが欄に入った状態で
//     パネルを開く
//
// 編集はかつて✎ボタンに固定されたポップオーバーに住んでいた（tag-pop、Issue #22）。
// このスイートはその置き換えの振る舞い契約である。検証は観測可能な状態（チップの
// 存在、ディスク上のjson）に対して行い、内部実装には依存しない＝欄はBase UIの
// Comboboxで、その内部マークアップに依存すべきではない。
//
//   node scripts/test-app-inspector-tags.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { readEvalResult } = require('./lib-eval-result.cts');

const electronPath = resolveElectron();
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-insptags-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// tag-aはテスト対象のカード: 自分のタグは無く、未採用のソースハッシュタグが1つ。
// tag-bは既にタグを1つ持っている＝語彙ポップアップが提示できるものがある。
const seed = [
  { id: 'tag-a', tags: [], hashtags: ['ソースタグ'] },
  { id: 'tag-b', tags: ['既存タグ'], hashtags: [] },
];
const records: any[] = [];
seed.forEach((s, i) => {
  fs.writeFileSync(path.join(saveFolder, `${s.id}.jpg`), jpeg);
  records.push({
    captureId: s.id,
    image: `${s.id}.jpg`,
    url: `https://x.com/u${i}/status/${800 + i}`,
    platform: 'x',
    text: `本文${i}`,
    displayName: `人${i}`,
    screenName: `u${i}`,
    capturedAt: `2026-05-0${i + 1}T12:00:00Z`,
    date: `2026-04-0${i + 1}T10:00:00Z`,
    media: [{ file: `${s.id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
    tags: s.tags,
    hashtags: s.hashtags,
  });
});
seedLibrary(configDir, records);

// sleep / waitFor / waitStable / neverHappens は第一引数として入ってくる＝
// scripts/lib-wait.cts（#986）。本体をテンプレートリテラルではなく実際の関数に
// しているのは、Biomeのno-fixed-waitプラグインとtscの両方が読めるようにするため。
// これはシリアライズされるので、このファイルの何にもクロージャしない。
const evalJs = evalSource(async ({ sleep, waitFor, neverHappens }) => {
  const field = () => document.querySelector('[data-slot="inspector"] [data-slot="inspector-tags"]');
  const chips = () => [...document.querySelectorAll('[data-slot="inspector"] [data-slot="tag-chip"]')].map((c) => c.getAttribute('data-tag'));
  const input = () => document.querySelector<HTMLInputElement>('[data-slot="inspector"] [data-slot="tag-input"]');
  // カードが言うテキストで特定する（セルにkey属性は無い＝#618）。
  const postCards = () => [...document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]')];
  const cardOf = (n) => postCards().find((c) => (c.textContent || '').includes('本文' + n));
  // オプショナルチェーンではなく名前を付ける: カード自体が以下の各ステップが作用する
  // 対象なので、無い場合はクリックをスキップして後の検証に別のことを報告させるのでは
  // なく、実行を止めてどれが無いかを言わなければならない。
  const requireCard = (n) => {
    const c = cardOf(n);
    if (!c) throw new Error('the grid is missing the seeded card 本文' + n);
    return c;
  };
  const nameOf = (c) => ((c.textContent || '').match(/本文\d+/) || [])[0] || '?';
  const requireInput = (why) => {
    const el = input();
    if (!el) throw new Error('the inspector has no tag input to ' + why);
    return el;
  };
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  // Reactが入力のvalueを所有しているので、素の.value代入はReactからは見えない＝
  // Reactの自前のテストユーティリティと同じように、ネイティブのsetterを経由する。
  const setInput = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (!desc?.set) throw new Error('the tag input exposes no native value setter to drive');
    desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  // TagFieldのEnterハンドラはDOMの値ではなくReactの"query"状態をコミットする
  // （inspector/TagField.tsx）。そのため、inputイベントの描画が終わる前に発火した
  // Enterは黙って何も起きない。チップが着地するまで押し直すことが、その描画の代わり
  // に以前あった固定80msの観測可能な形（#986）。タグが入ってしまえば欄はqueryを
  // クリアするので、その後の押し直しも何も起きない。
  const typeTag = async (label, text) => {
    const el = requireInput('type a tag into');
    el.focus();
    setInput(el, text);
    return waitFor(label, () => {
      const box = input();
      if (box) key(box, 'Enter');
      return chips().includes(text);
    });
  };

  await waitFor('the grid to show both seeded posts', () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 2);

  // A. カードのコンテキストメニューの「タグを編集」は、P2⑦でホバーの🏷（とそれが
  // 開いていたポップオーバー）が無くなって以降、カードからタグ付けへ入る経路。
  // そのカードのパネルを開き、かつキャレットを欄に入れる＝そうしなければ単に
  // 「詳細」の別名になってしまい、利用者は結局入力欄を自分で探す必要がある。
  requireCard(1).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }));
  const menuItems = () => [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')];
  out.menuOpened = await waitFor('the card context menu to offer its edit-tags item', () => menuItems().some((r) => (r.textContent || '').includes('タグを編集')));
  const tagItem = menuItems().find((r) => (r.textContent || '').includes('タグを編集'));
  if (tagItem) tagItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.menuOpenedPanel = await waitFor("the inspector to open showing that card's tags", () => !!field() && chips().includes('既存タグ'));
  out.tagInputFocused = await waitFor('the caret to land in the tag field', () => !!input() && document.activeElement === input());
  key(document.body, 'Escape'); // dismiss the menu before the rest of the flow

  // B. カードを選択すると、その投稿のタグが欄に入る（tag-bは既に1つ持っている）
  requireCard(1).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.fieldShown = await waitFor('the inspector to show a tag field for the selected card', () => !!field());
  out.chipsForB = chips().join(',');

  // C. 自由文 + Enterで、詳細表示中のカードにタグが追加される
  requireCard(0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await waitFor('the inspector to switch to the untagged card', () => !!field() && chips().length === 0);
  out.hasInput = !!input();
  out.chipAdded = await typeTag('the typed tag to be added as a chip', '新規タグ');
  out.chipsAfterAdd = chips().join(',');
  // 入力したテキストは消費される。欄には残らない
  out.inputCleared = await waitFor('the tag field to clear the text it consumed', () => input()?.value === '');

  // D. ポップアップは未採用のソースハッシュタグとライブラリの語彙を提示する
  const el2 = requireInput('open the suggestion popup from');
  el2.focus();
  el2.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  el2.click();
  const itemTexts = () => [...document.querySelectorAll('[role="option"]')].map((n) => (n.textContent || '').trim());
  // 押下の事後条件は候補ポップアップに行が「そもそもある」こと。「どの」行を提示
  // するかは下で別途検証するので、空で開いたポップアップは、存在するまで待たれる
  // のではなく検査に失敗する。
  out.popupOpened = await waitFor('the tag suggestion popup to open', () => itemTexts().length > 0);
  out.popupItems = itemTexts().join('|');
  // ポップアップは欄（Combobox.InputGroup）に位置を合わせる。その左にある入力欄
  // ではない。チップが存在すると両者は大きく離れるので、左端を比較すれば区別できる:
  // 候補一覧が属すべきなのは欄の端（MUI AutocompleteやAnt Design Selectが従うのと
  // 同じ規則）。レイアウトのノイズになる正確なピクセル値ではなく「入力欄より欄に
  // 近い」として検証する。
  const leftOf = (el) => Math.round(el.getBoundingClientRect().left);
  // このグループこそがこの検査が扱うアンカーそのものなので、それを持たない欄は
  // 黙って何とも比較せず実行を止めなければならない。
  const fieldEl = requireInput('measure the popup anchor from').closest('[role="group"]');
  if (!fieldEl) throw new Error('the tag input is not inside the [role="group"] the popup anchors to');
  out.anchorField = leftOf(fieldEl);
  out.anchorInput = leftOf(el2);
  const optEl = document.querySelector('[role="option"]');
  const popupEl = optEl && optEl.closest('div[class*="bg-popover"]');
  out.anchorPopup = popupEl ? leftOf(popupEl) : null;
  out.popupTracksField = out.anchorPopup !== null && Math.abs(out.anchorPopup - out.anchorField) < Math.abs(out.anchorPopup - out.anchorInput);
  out.offersSourceTag = itemTexts().some((t) => t.includes('ソースタグ'));
  out.offersVocab = itemTexts().some((t) => t.includes('既存タグ'));

  // E. ソースハッシュタグを選ぶと採用される
  const srcItem = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((n) => (n.textContent || '').trim().includes('ソースタグ'));
  if (srcItem) srcItem.click();
  out.adopted = await waitFor('the picked source hashtag to become a chip', () => chips().includes('ソースタグ'));

  // F. タグポップアップが開いている状態でのEscは、インスペクタを道連れにしては
  // いけない。パネルのEscハンドラ（inspector-builder）は、ポップアップが開いている
  // と登録されている間は動作を見送る。欄はまさにこのために自分を登録する。それが
  // 無かった頃は、このEscが開いているポップアップの下でパネル全体を閉じていた。
  //
  // 検証するのは見送りだけ。ポップアップ自身がその後閉じるかどうかはBase UI自身の
  // 却下処理であり、合成したKeyboardEventでは動かせない＝これはBase UI Selectに
  // ついて既に記録済みなのと同じ限界で、そのポップアップも同様に実際の入力にしか
  // 反応しない。その半分は実キーの検証であり、ハーネスの検証ではない。
  out.popupOpenBeforeEsc = !!document.querySelector('[role="option"]');
  key(input(), 'Escape');
  // 「パネルが閉じない」＝時間窓を消費しなければならない。パネルがまだそこにある
  // ことを待つと、何であれ最初のポーリングで通ってしまうため（#986）。
  out.inspectorSurvivedEsc = await neverHappens('Esc with the tag popup open to close the inspector', () => !field(), 250);

  // F. チップの×でタグが削除される
  out.chipsBeforeRemove = chips().join(',');
  const chipEl = [...document.querySelectorAll('[data-slot="inspector"] [data-slot="tag-chip"]')].find((c) => c.getAttribute('data-tag') === '新規タグ');
  const removeBtn = chipEl && chipEl.querySelector('button');
  out.hasRemoveBtn = !!removeBtn;
  if (removeBtn) removeBtn.click();
  out.chipRemoved = await waitFor("the removed tag to disappear from the card's chips", () => chips().length > 0 && !chips().includes('新規タグ'));
  out.chipsFinal = chips().join(',');

  // G. タグ入力欄の中の矢印キーはグリッドではなくキャレットに属する。これは
  // 連続タグ付けループを支える防ぎである: 矢印で次のカードへ、入力し、入力した中で
  // 矢印を動かす＝もしグリッドがそれらを奪ったら、選択が単語の途中で飛んでしまう。
  const el3 = requireInput('type into while the arrows are pressed');
  el3.focus();
  setInput(el3, 'あいう');
  const selectionNow = () =>
    postCards()
      .filter((c) => c.hasAttribute('data-selected'))
      .map(nameOf)
      .join(',');
  const selBefore = selectionNow();
  el3.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  el3.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  // 「グリッドが矢印を奪わない」＝時間窓を消費すること自体が検証（#986）。
  out.selectionHeldWhileTyping = await neverHappens('arrows inside the tag field to move the grid selection', () => selectionNow() !== selBefore, 250);
  setInput(el3, '');
  key(el3, 'Escape');

  // 意図的な固定値: このスイートが検証するタグはMAINが書く（#298/St5でタグ編集は
  // DBへの書き込みになった）が、レンダラーのチップは楽観的に更新される＝つまり
  // アプリが終了する前に書き込みが着地したと言える観測点がここには無い。
  // biome-ignore lint/plugin: the delay IS the spec here — it covers main's DB write, which the renderer cannot observe.
  await sleep(300);
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
  // 永続化こそがこの機能の要点なので、ページ内のチップを信用せずDBから読み戻す
  // ＝#298/St5でタグ編集はDBのみになった（app/src/main/ipc-trash.tsのupdate-tagsは
  // もうsidecarを書き換えない）。
  let persisted: string[] = [];
  try {
    // #176: hologram.db は今は configDir ではなく保存フォルダの中にある。
    const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
    persisted = sqlite
      .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid')
      .all('tag-a')
      .map((r: any) => r.name);
    sqlite.close();
  } catch {
    /* 下の検査失敗として報告される */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = readEvalResult(out);
  if (!r) {
    console.log('INSPECTOR_TAGS_TEST_FAIL（eval結果なし）');
    process.exit(1);
  }
  const checks = [
    ['インスペクタがタグ欄を表示する', r.fieldShown === true && r.hasInput === true],
    ['既にタグ付けされたカードはそのタグをチップとして表示する', r.chipsForB === '既存タグ'],
    ['新しいタグを入力してEnterで追加される', r.chipAdded === true],
    ['追加後、入力したテキストがクリアされる', r.inputCleared === true],
    ['タグ候補のポップアップが開く', r.popupOpened === true],
    ['ポップアップが未採用のソースハッシュタグを提示する', r.offersSourceTag === true],
    ['ポップアップがライブラリの他の場所の語彙を提示する', r.offersVocab === true],
    ['ポップアップはチップの横の入力欄ではなく欄に位置を合わせる', r.popupTracksField === true],
    ['ソースハッシュタグを選ぶと採用される', r.adopted === true],
    ['タグポップアップが開いた状態でのEscはインスペクタを開いたままにする', r.popupOpenBeforeEsc === true && r.inspectorSurvivedEsc === true],
    ['カードのコンテキストメニューが「タグを編集」を提示する', r.menuOpened === true],
    ['「タグを編集」はそのカードのパネルをキャレットが欄に入った状態で開く', r.menuOpenedPanel === true && r.tagInputFocused === true],
    ['チップの×でタグが削除される', r.hasRemoveBtn === true && r.chipRemoved === true],
    ['タグ入力中の矢印キーは選択ではなくキャレットを動かす', r.selectionHeldWhileTyping === true],
    ['残ったタグがDBへ永続化された', persisted.includes('ソースタグ')],
    ['削除したタグがDBから無くなった', !persisted.includes('新規タグ')],
    ['ハンドラが例外を投げなかった', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r) + '\n  persisted: ' + JSON.stringify(persisted));
  console.log(failed ? 'INSPECTOR_TAGS_TEST_FAIL' : 'INSPECTOR_TAGS_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
