'use strict';

// 選択バーからの一括タグ付け（リデザイン P2⑦）を実際のレンダラーで検証する:
//
//   - 2枚以上のカードを選んで「タグを追加」を押すとDialogが開く
//   - 何かがステージされるまでApplyは無効
//   - ステージしたタグはApplyするまで書き込まれない＝キャンセルすると破棄される
//   - 再度開いたダイアログは空から始まる（ステージングは開くたびで、持ち越さない）
//   - Applyはステージしたタグを選択中の全レコードのタグへマージする（DBの
//     post_tags＝#298/St5でタグ編集はDBのみの書き込みになった）。各レコードが
//     既に持っていたタグは保つ（追加だけが唯一のモード）
//
// これはtag-popのmode:'bulk'を置き換えるもので、以前はステージングが専用の
// レンダラーモジュールに住んでいたが、今はダイアログのReact状態に住んでいる。
// 「破棄」と「再度開いたダイアログは空」の検査は、その移行が保ち続けなければ
// ならないことそのもの。検証はチップとディスクに対して行い、Base UIの内部実装
// には対して行わない。
//
// 待機はscripts/lib-wait.cts（#986）から来る: eval全体はそのモジュールの
// WAIT_DEADLINEに縛られていて、それはmainのSMOKE_TIMEOUTより短いので、停止
// してもこのスイートのチェックごとの報告が「eval結果なし」の代わりに返る。
//
//   node e2e/harness/cases/test-app-bulk-tag.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { readEvalResult } = require('../../../scripts/lib-eval-result.cts');

const electronPath = resolveElectron();
const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-bulktag-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// bulk-bは既にタグを1つ持っている: 追加マージはそれに触れてはならない。
const seed = [
  { id: 'bulk-a', tags: [] },
  { id: 'bulk-b', tags: ['既存タグ'] },
];
const records: any[] = [];
seed.forEach((s, i) => {
  fs.writeFileSync(path.join(saveFolder, `${s.id}.jpg`), jpeg);
  records.push({
    captureId: s.id,
    image: `${s.id}.jpg`,
    url: `https://x.com/u${i}/status/${900 + i}`,
    platform: 'x',
    text: `本文${i}`,
    displayName: `人${i}`,
    screenName: `u${i}`,
    capturedAt: `2026-05-0${i + 1}T12:00:00Z`,
    date: `2026-04-0${i + 1}T10:00:00Z`,
    media: [{ file: `${s.id}-orig.jpg`, url: 'https://x.com/i/1.jpg' }],
    tags: s.tags,
    hashtags: [],
  });
});
seedLibrary(configDir, records);

// sleep / waitFor / waitStable / neverHappens は第一引数として入ってくる＝
// scripts/lib-wait.cts（#986）。本体をテンプレートリテラルではなく実際の関数に
// しているのは、Biomeのno-fixed-waitプラグインとtscの両方が読めるようにするため。
// これはシリアライズされるので、このファイルの何にもクロージャしない。
const evalJs = evalSource(async ({ sleep, waitFor, neverHappens }) => {
  // Base UI は閉じるアニメーション中も Popup を残す。存在ではなく開いている状態を
  // 読むことで、閉じたダイアログを開いたものとして扱わない。
  const dialog = () => document.querySelector('[data-slot="dialog-content"][data-open]');
  const chips = () => [...document.querySelectorAll('[data-slot="dialog-content"] [data-slot="tag-chip"]')].map((c) => c.getAttribute('data-tag'));
  const input = () => document.querySelector<HTMLInputElement>('[data-slot="dialog-content"] [data-slot="tag-input"]');
  const btnIn = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test((b.textContent || '').trim()));
  const applyBtn = () => dialog() && btnIn(dialog(), /件に適用/);
  const cancelBtn = () => dialog() && btnIn(dialog(), /^キャンセル$/);
  const barTagBtn = () => document.querySelector<HTMLButtonElement>('button[aria-label="タグを追加"]');
  // オプショナルチェーンではなく名前を付ける: このボタンを押すことこそが
  // このステップそのものなので、バーが無ければ実行を止めてそう言わなければ
  // ならない。次の待機に「ダイアログが一度も開かなかった」と報告させるのではなく。
  const pressBarTagBtn = () => {
    const btn = barTagBtn();
    if (!btn) throw new Error('選択バーに押すべき「タグを追加」ボタンがありません');
    btn.click();
  };
  // カードが言うテキストで特定する（セルにkey属性は無い＝#618）。
  const postCards = () => [...document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]')];
  const cardOf = (n) => postCards().find((c) => (c.textContent || '').includes('本文' + n));
  const requireCard = (n) => {
    const c = cardOf(n);
    if (!c) throw new Error('グリッドにシードしたカード本文' + n + 'がありません');
    return c;
  };
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  // Reactが入力のvalueを所有しているので、素の.value代入はReactからは見えない。
  const setInput = (el, v) => {
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (!desc?.set) throw new Error('タグ入力欄に操作すべきネイティブのvalue setterが無い');
    desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // TagFieldのEnterハンドラはDOMの値ではなくReactの"query"状態をコミットする
  // （inspector/TagField.tsx）。そのため、inputイベントの描画が終わる前に発火した
  // Enterは黙って何も起きない。チップがステージされるまで押し直すことが、その
  // 描画の代わりに以前あった固定50msの観測可能な形（#986）。タグがステージされて
  // しまえば欄はqueryをクリアするので、その後の押し直しも何も起きない。
  const type = async (label, text) => {
    const el = input();
    if (!el) throw new Error('一括タグ付けダイアログに入力すべきタグ入力欄がありません');
    el.focus();
    setInput(el, text);
    return waitFor(label, () => {
      const box = input();
      if (box) box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return chips().includes(text);
    });
  };

  await waitFor('the grid to show both seeded posts', () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length >= 2);

  // A. 両方のカードを選択する（素のクリック=単一選択、Ctrl=追加）→バーが現れる
  requireCard(0).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  requireCard(1).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
  out.barShown = await waitFor('the selection bar to appear for the two picked cards', () => !!barTagBtn());

  // B. 「タグを追加」でダイアログが開き、何もステージされていない状態から始まる
  pressBarTagBtn();
  out.dialogOpened = await waitFor('the bulk tagging dialog to open', () => !!dialog());
  out.chipsAtOpen = chips().join(',');
  out.applyLabel = applyBtn() ? applyBtn().textContent.trim() : '';
  out.applyDisabledWhenEmpty = !!(applyBtn() && applyBtn().disabled);

  // C. タグをステージするとApplyが有効になる＝ただしまだ何も書き込まれない
  out.stagedChip = await type('the typed tag to be staged as a chip', 'すてるタグ');
  out.applyEnabledAfterStage = !!(applyBtn() && !applyBtn().disabled);

  // D. キャンセルするとステージしたリストが破棄される（最後にディスクで検証:
  //    「すてるタグ」はどちらのsidecarにも決して現れてはならない）
  cancelBtn().click();
  out.dialogClosed = await waitFor('the cancelled dialog to close', () => !dialog());

  // E. 再度開くと綺麗な状態から始まる＝ステージングはダイアログ自身の状態なので、
  //    レンダラーモジュールに生き残るのではなくダイアログと共に死ぬ
  pressBarTagBtn();
  out.reopened = await waitFor('the bulk tagging dialog to open a second time', () => !!dialog());
  // 「破棄したタグは戻ってこない」: 事後条件を待つと最初のポーリングで通って
  // しまうので、この時間窓は意図的に消費する（#986）。
  await neverHappens('a chip from the cancelled session to reappear in the reopened dialog', () => chips().length > 0, 250);
  out.chipsAtReopen = chips().join(',');

  // F. Applyはステージしたタグを選択中の全レコードへ書き込む
  out.stagedChip2 = await type('the second typed tag to be staged as a chip', 'まとめタグ');
  applyBtn().click();
  out.dialogClosedOnApply = await waitFor('the dialog to close once Apply was pressed', () => !dialog());

  // 意図的な固定値: このスイートが検証するタグはMAINが書く（#298/St5でタグ編集は
  // DBへの書き込みになった）が、ダイアログが閉じるのはレンダラー自身の状態に
  // よる＝つまりアプリが終了する前に書き込みが着地したと言える観測点がここには
  // 無い。
  // biome-ignore lint/plugin: the delay IS the spec here — it covers main's DB write, which the renderer cannot observe.
  await sleep(400);
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
  // #298/St5: タグ編集はDBのみ（app/src/main/ipc-trash.tsのupdate-tagsはもう
  // sidecarに触れない）ので、永続化はディスクではなくpost_tagsに対して検証する。
  let a: string[] = [];
  let b: string[] = [];
  try {
    // #176: hologram.db は今は configDir ではなく保存フォルダの中にある。
    const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'), { readonly: true });
    const tagsOf = (id: string) =>
      sqlite
        .prepare('SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tagId WHERE pt.postId = ? ORDER BY pt.rowid')
        .all(id)
        .map((r: any) => r.name);
    a = tagsOf('bulk-a');
    b = tagsOf('bulk-b');
    sqlite.close();
  } catch {
    /* 下の検査失敗として報告される */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const r = readEvalResult(out);
  if (!r) {
    console.log('BULK_TAG_TEST_FAIL（eval結果なし）');
    process.exit(1);
  }
  const checks = [
    ['複数カード選択時に選択バーが現れる', r.barShown === true],
    ['「タグを追加」で一括ダイアログが開く', r.dialogOpened === true],
    ['ダイアログは何もステージされていない状態で開く', r.chipsAtOpen === ''],
    ['Applyが選択件数を表示する', r.applyLabel === '2 件に適用'],
    ['何もステージされていない間Applyはdisabled', r.applyDisabledWhenEmpty === true],
    ['タグを入力するとチップとしてステージされる', r.stagedChip === true && r.applyEnabledAfterStage === true],
    ['キャンセルでダイアログが閉じる', r.dialogClosed === true],
    ['キャンセルしたタグは決して書き込まれない', !a.includes('すてるタグ') && !b.includes('すてるタグ')],
    ['再度開くと空のステージングリストから始まる', r.reopened === true && r.chipsAtReopen === ''],
    ['Applyでダイアログが閉じる', r.stagedChip2 === true && r.dialogClosedOnApply === true],
    ['Applyが選択中の全レコードにタグを書き込む', a.includes('まとめタグ') && b.includes('まとめタグ')],
    ['レコードが既に持っていたタグは保たれる（追加のみ）', b.includes('既存タグ')],
    ['ハンドラが例外を投げなかった', Array.isArray(r.errors) && r.errors.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed) console.log('  got: ' + JSON.stringify(r) + '\n  bulk-a: ' + JSON.stringify(a) + '\n  bulk-b: ' + JSON.stringify(b));
  console.log(failed ? 'BULK_TAG_TEST_FAIL' : 'BULK_TAG_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
