'use strict';

// リデザインされたシェル（#154 P2⑧ / #41）に対してフォルダ機能を検証する。
// そこではサイドバーの木そのものがライブラリフォルダのマネージャで —
// このスイートがかつて操作していたモーダルは無くなっている:
//  - グループ見出しの + はルートフォルダを作る（命名ダイアログ）
//  - 行のコンテキストメニューはその下に「子」フォルダを作り、親が開いて
//    新しい行が実際に見えるようになる
//  - 投稿はカードメニュー経由で「子」に加わる。その行は今やパスでラベル
//    付けされている。裸の名前ではもうフォルダを識別できないため
//  - 「親」をクリックすると子の投稿が表示される: フォルダは部分木を開く現在地で、
//    選択状態はサイドバーに残る。フィルタチップには移らない
//  - 親を削除すると子も道連れになるが、投稿はライブラリに残る
//
// このスイートの clip 側は clip の画面自体と一緒に無くなった（リデザイン
// されたサイドバーには clip の行が無い。機能の撤去は #135）。
//
//   node e2e/harness/cases/test-app-folders.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-fold-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

// 既知の captureId を使い、DOM を漁らずに id で所属を操作できるようにする。
// DB が正本（#298/#302）: メディアは保存フォルダへ、レコードはそのまま
// データベースへ入る。2階層の木を、投稿が「子」に座る形でシードすることで、
// 下の集約の主張が実際の部分木を運動させる。
const CIDS: any[] = [];
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-f0' + i;
  CIDS.push(id);
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://www.pixiv.net/artworks/' + (200 + i),
    platform: 'pixiv',
    title: '作品' + i,
    displayName: '絵師' + i,
    screenName: '80000' + i,
    likes: 1000 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
    source: 'eagle-migration',
  });
}

{
  const handle = seedLibrary(configDir, records, { close: false });
  createDbWriter(handle.sqlite).setFolders({
    folders: [
      { id: 'f-root', name: '一次資料', kind: 'static', created: 1, parentId: null, items: [] },
      { id: 'f-kid', name: 'スケッチ', kind: 'static', created: 2, parentId: 'f-root', items: [CIDS[0]] },
    ],
    activeId: null,
  });
  handle.sqlite.close();
}

const evalJs = evalSource(async ({ waitFor }) => {
  const grid = document.querySelector('[data-slot="post-grid"]');
  const click = (el) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const rclick = (el) => el && el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
  // `!` ではなく名前を付けて弾く: 以下すべてがカードを数えるので、グリッドが
  // 無い場合は実行を止めてどの要素が無かったかを言うべき。
  const cards = () => {
    if (!grid) throw new Error('投稿グリッドがドキュメントに見つからない');
    return grid.querySelectorAll('[data-slot="post-card"]').length;
  };
  const rows = () => [...document.querySelectorAll('[data-slot="folder-row"]')];
  const rowNamed = (name) => rows().find((r) => (r.textContent || '').trim() === name);
  // #981: サイドバーはレールでしかなく、フォルダの木はレールのフォルダ行の
  // 裏にあるフライアウトの中に住んでいる — その行がクリックされるまでは
  // ドキュメントに存在しない。（Base UI の Trigger は描画するものに自前の
  // data-slot を刻むので、レールの行は sidebar-menu-button ではなく
  // popover-trigger になる。）フォルダを選ぶと仕様どおりフライアウトが閉じる
  // ので、その後木が必要な箇所ではこれを再度呼ぶ。
  const railRow = (label) => [...document.querySelectorAll('[data-slot="popover-trigger"]')].find((b) => (b.textContent || '').trim() === label);
  const openTree = async () => {
    if (rows().length) return true;
    click(railRow('フォルダ'));
    return await waitFor('レールのフライアウトでフォルダの木が開くこと', () => rows().length > 0);
  };
  // menu.ts はすべてのコンテキストメニューを共有の DropdownMenu コンポーネント
  // 経由で描画する。
  const menuRow = (txt) => [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')].find((r) => (r.textContent || '').includes(txt));
  const chips = () => [...document.querySelectorAll('[data-slot="filter-chip"]')];
  const getFolders = () => (window as any).hologram.getFolders();
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(String((e && e.message) || e)));
  const out: Record<string, any> = {};

  // React がダイアログの input を所有しているので、素の .value 代入はそれには
  // 見えない。
  const setInput = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    // `!` ではなく名前を付けて弾く: このヘルパーの目的そのものが React 自身の
    // セッターを走らせることなので、それを持たないプロトタイプは実行を止めて
    // そう言うべき。
    const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setValue = valueDesc && valueDesc.set;
    if (!setValue) throw new Error('ダイアログの input のプロトタイプに、React を駆動するための value セッターが無い');
    setValue.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // 命名ダイアログ。その OK は位置ではなく「ラベル」で照合する — レイアウトの
  // 変更が静かに Cancel を押してしまい、それでもこのスイートが通り続けると
  // いうことがあってはならない。
  const okBtn = () => [...document.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-content"] button')].find((b) => (b.textContent || '').trim() === 'OK');
  const nameIt = async (name) => {
    if (!(await waitFor('命名ダイアログがテキスト欄を表示すること', () => !!document.querySelector('[data-slot="dialog-content"] input')))) return false;
    setInput(document.querySelector('[data-slot="dialog-content"] input'), name);
    // prompt/Prompt.tsx は欄が空の間 OK を無効化するので、「OK が有効になった」
    // ことが React が値を受け取った観測可能な証拠になる — コミットのタイミング
    // を推測する必要はない。
    const okLive = await waitFor(
      'React が入力された名前を受け取り OK ボタンが有効になること',
      () => {
        const b = okBtn();
        return !!b && !b.disabled;
      },
      3000,
    );
    if (!okLive) return false;
    click(okBtn());
    // OK でダイアログはアンマウントされる。それが去るのを待つことで、次の
    // ステップが木を読む前にクリックが届いたと分かる。
    await waitFor('OK の後で命名ダイアログが閉じること', () => !document.querySelector('[data-slot="dialog-content"]'), 3000);
    return true;
  };

  await waitFor('グリッドがシードした3件の投稿すべてを表示すること', () => cards() >= 3);
  out.totalBefore = cards(); // 3

  // --- A. シードした子は入れ子: 親が開かれるまで隠れている ---
  out.treeOpened = await openTree();
  out.parentShown = await waitFor('木にルートフォルダの行が現れること', () => !!rowNamed('一次資料'));
  out.childHiddenAtFirst = !rowNamed('スケッチ');
  click(document.querySelector('[data-slot="folder-twisty"]'));
  out.childShownAfterTwisty = await waitFor('親が展開されたら子フォルダの行が現れること', () => !!rowNamed('スケッチ'));

  // --- B. 行のコンテキストメニューはその下に「子」フォルダを作る ---
  rclick(rowNamed('スケッチ'));
  out.rowMenuOpened = await waitFor('行のコンテキストメニューがサブフォルダ作成を提示すること', () => !!menuRow('サブフォルダを作成'));
  click(menuRow('サブフォルダを作成'));
  out.namedSub = await nameIt('線画');
  // 作成すると親が開く: 折りたたまれた親の中に隠れた新しい行は、何も起きな
  // かったのと見分けが付かない。まず木を開き直す — #981 以降、フライアウトは
  // その上で閉じたダイアログと一緒に消えるので、閉じたフライアウトは新しい
  // フォルダがどこへ行ったかについて何も語らない。
  out.treeAfterCreate = await openTree();
  out.newSubShown = await waitFor('新しく作ったサブフォルダの行が木に現れること', () => !!rowNamed('線画'));
  const c1 = await getFolders();
  const made = c1.folders.find((f) => f.name === '線画');
  const child = c1.folders.find((f) => f.name === 'スケッチ');
  out.newSubHasParent = !!made && !!child && made.parentId === child.id;

  // --- C. 「ルート」をクリックすると孫の投稿が表示される。現在地も一覧を絞っている
  //        有効な条件なので、フォルダ名をフィルタバーへ表示する。 ---
  // オプショナルチェインではなく名前を付けて弾く: ルートの行こそがこの
  // ステップが操作する対象なので、それが無い場合は次の主張の誤報告に任せず
  // 実行を止めるべき。
  const rootRow = rowNamed('一次資料');
  if (!rootRow) throw new Error('フォルダの木に 一次資料 の行が見つからない');
  click(rootRow.querySelector('[data-slot="sidebar-menu-button"]'));
  await waitFor('グリッドがフォルダの部分木へ切り替わり、現在地がフィルタバーに現れること', () => cards() === 1 && chips().some((c) => (c.textContent || '').includes('一次資料')));
  out.aggregated = cards(); // 1 — 2階層下に保持されていた
  out.treeAfterNavigation = await openTree();
  const rootButton = rowNamed('一次資料')?.querySelector('[data-slot="sidebar-menu-button"]');
  out.sidebarShowsCurrentFolder = !!(rootButton && rootButton.hasAttribute('data-active') && rootButton.getAttribute('data-active') !== 'false');

  // --- D. 「ライブラリ」を押すと根の場所に戻り、フォルダのチップも消える。 ---
  click([...document.querySelectorAll('[data-slot="sidebar-menu-button"]')].find((b) => (b.textContent || '').trim() === 'ライブラリ'));
  await waitFor('ライブラリへ戻ると投稿3件を表示すること', () => cards() === 3 && !chips().some((c) => (c.textContent || '').includes('一次資料')));
  out.backToAll = cards(); // 3

  // --- E. ルートを削除すると子孫も両方道連れになる ---
  out.treeReopened = await openTree();
  rclick(rowNamed('一次資料'));
  await waitFor('行のコンテキストメニューが 削除 を提示すること', () => !!menuRow('削除'));
  click(menuRow('削除'));
  // ダイアログはいくつのサブフォルダも一緒に行くかを言う: フォルダ1つと9つ
  // では判断が違い、件数だけがそれを見分けられる。
  const desc = () => document.querySelector('[data-slot="alert-dialog-description"]');
  out.cascadeWarned = await waitFor('削除ダイアログが一緒に消えるサブフォルダの数を名指すこと', () => {
    const el = desc();
    return !!el && (el.textContent || '').includes('2');
  });
  click(document.querySelector('[data-slot="alert-dialog-action"]'));
  // 木が空になることではなく DB を待つ: #981 以降、木はそれ自身の理由で閉じる
  // フライアウトの中に住んでいるので、サイドバーが空であることはもはや連鎖
  // 削除が届いたことを意味しない。getFolders() はどのみち下の主張が読む対象。
  await waitFor('連鎖削除でフォルダテーブルが空になり、投稿は残ること', async () => (await getFolders()).folders.length === 0 && cards() === 3);
  const c2 = await getFolders();
  out.leftAfterDelete = c2.folders.length; // 0 — all three went
  out.postsKept = cards(); // 3 — the posts stay in the library
  out.noErrors = errors.length === 0;
  return out;
});

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
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
  let r: Record<string, any> = {};
  const m = out.match(/EVAL_RESULT (.+)/);
  if (m) {
    try {
      r = JSON.parse(m[1]);
    } catch {
      /* ignore */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const expect = {
    totalBefore: 3,
    treeOpened: true,
    parentShown: true,
    childHiddenAtFirst: true,
    childShownAfterTwisty: true,
    rowMenuOpened: true,
    namedSub: true,
    treeAfterCreate: true,
    newSubShown: true,
    newSubHasParent: true,
    aggregated: 1,
    treeAfterNavigation: true,
    sidebarShowsCurrentFolder: true,
    backToAll: 3,
    treeReopened: true,
    cascadeWarned: true,
    leftAfterDelete: 0,
    postsKept: 3,
    noErrors: true,
  };
  const keys = Object.keys(expect);
  const ok = keys.every((k) => r[k] === expect[k]);
  console.log(keys.map((k) => k + '=' + r[k]).join(' '));
  console.log(ok ? 'FOLDERS_TEST_PASS' : 'FOLDERS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
