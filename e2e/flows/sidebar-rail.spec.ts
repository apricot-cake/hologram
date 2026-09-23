// 左サイドバー――ラベル付きのレールだけで、他には何も無い（#678が既定にし、#981が唯一の
// 形にした）。実際のポインタ・実際のキーで確かめる。
//
// #628の幾何学的不変条件（shell-axes.spec.ts）と#245の一括切り替え
// （tests/integration/panels-pref.test.tsのCtrl+Shift+Bの検証）はここでは重複させない。
// このファイルが見るもの＝最初の描画、ホバーなしでの発見しやすさ、レールがユーザー生成の
// 一覧を自分では持たないこと、その代わりに一覧を保持するフライアウト、そして展開カラムが
// かつて持っていたすべての経路（Ctrl+B、トリガーボタン、ドラッグ端、幅連動の変形）が
// 無いこと。
import path from 'node:path';
import { expect, test } from '../lib/harness.ts';

const appDir = path.join(__dirname, '..', '..', 'app');

const FOLDERS = [{ id: 'f-a', name: '資料', kind: 'static', created: 1, parentId: null, items: [] }];

function seedFolder({ saveFolder }: { saveFolder: string }) {
  const { openDatabase } = require(path.join(appDir, 'src', 'main', 'lib-db.ts'));
  const { createDbWriter } = require(path.join(appDir, 'src', 'main', 'lib-db-write.ts'));
  // #176: hologram.dbは今、configDirではなく保存フォルダの中にある。
  const { sqlite } = openDatabase(path.join(saveFolder, 'hologram.db'));
  createDbWriter(sqlite).setFolders({ folders: FOLDERS, activeId: null });
  sqlite.close();
}

test('初回起動はラベル付きレール（#678 受け入れ条件1・2）', async ({ launchHologram }) => {
  const { page } = await launchHologram();

  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');

  // ホバーは一切しない――最初からラベルが読めることそのものが受け入れ条件2だ。
  // DOM順で書く――下の一覧はこのテストの最後にある順序つきアサーションでもある。
  const expectedLabels: Record<string, string> = {
    browsePosts: 'ホーム',
    browsePosters: '投稿者',
    // #965: フォルダツリーをフライアウトとして開く固定行――フォルダの一覧そのものでは
    // ない。一覧そのものは#678の受け入れ条件3（下でアサート）が禁じているものだ。
    // その行が代表するグループと同じく常に存在する＝ツリーは最初のフォルダが作られる
    // 場所なので、既にフォルダがあることを条件にはできない。
    qfCatFolder: 'フォルダ',
    trashTitle: 'ゴミ箱',
    // #145のグローバル履歴行は、設定の上にある無条件のフッターエントリだ
    // （shell/LeftSidebar.tsx）――レールはアプリレベルの入口が追加されるたびに増える。
    // この一覧が、受け入れ条件3がどれを正当と見なすかを述べているものだ。
    historyTitle: '履歴',
    tabSettings: '設定',
  };
  for (const text of Object.values(expectedLabels)) {
    const label = page.locator('[data-slot="menu-label"]', { hasText: text });
    await expect(label).toBeVisible();
    await expect(label).toHaveText(text);
  }
  // レールにはこれ以外は何も乗ってはいけない――ユーザー生成のグループが紛れ込むことを
  // 受け入れ条件3が禁じている。件数ではなく順序つき一覧としてアサートする＝夜間ランナーが
  // 「6件、期待は5件」と報告した際、どの行が現れたのかを知る手立てが無かった（#818）。
  // テキスト一致なら実際に見つかった一覧を出力するので、次に失敗したときは件数だけでなく
  // 侵入者の名前がわかる。
  await expect(page.locator('[data-slot="menu-label"]')).toHaveText(Object.values(expectedLabels));
});

test('フォルダ一覧はフライアウトを開くまで表示されない', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolder });

  // #678はこれらの行をCSSスイッチの裏に隠し、展開カラムがそれをオフにしていた。カラムが
  // 無くなった今（#981）は、フライアウトが開くまで一切描画されない――だからここでは
  // 「ドキュメントに存在しない」ことをアサートする。旧来の「付いてはいるが見えない」では
  // これを区別できなかった。
  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  await expect(page.locator('[data-folder-id="f-a"]')).toHaveCount(0);
});

// レールのフォルダボタンから一覧を開き、フォルダを選んで絞り込む。
test('レールのフォルダ行はフライアウトでツリーを出し、選ぶと適用して閉じる（#965）', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolder });
  const sidebar = page.locator('[data-slot="sidebar"]');
  const flyout = page.locator('[data-slot="popover-content"]');
  // ボタンではなくラベルを通して特定する＝Base UIのTriggerは自分が描画するものに
  // 自前のdata-slotを刻印するので、これらの行は`sidebar-menu-button`ではなく
  // `popover-trigger`になる。正規表現をアンカーする＝ただの「フォルダ」だと
  // 投稿者フォルダにもマッチしてしまう。
  const railRow = (label: string) => page.locator('[data-slot="menu-label"]', { hasText: new RegExp(`^${label}$`) });

  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  await expect(flyout).toHaveCount(0);

  // この行は、カラムが隠していたフォルダを添えて、レールの脇にツリーを開く。
  await railRow('フォルダ').click();
  await expect(flyout).toBeVisible();
  await expect(flyout.locator('[data-folder-id="f-a"]')).toBeVisible();

  // Escは何も適用せずに閉じる。
  await page.keyboard.press('Escape');
  await expect(flyout).toHaveCount(0);
  await expect(page.locator('[data-slot="filter-chip"]')).toHaveCount(0);

  // フォルダを選ぶと現在地になり、自分は退く。
  await railRow('フォルダ').click();
  await flyout.locator('[data-folder-id="f-a"] [data-slot="sidebar-menu-button"]').click();
  await expect(page.locator('[data-slot="filter-chip"]')).toHaveCount(1);
  await expect(flyout).toHaveCount(0);

  // ……そして今いる場所に対応する行は選択済みとして読める。
  await railRow('フォルダ').click();
  await expect(flyout.locator('[data-folder-id="f-a"] [data-slot="sidebar-menu-button"][data-active]')).toBeVisible();
});

// フライアウトはピッカーであるだけでなく管理者でもなければならない（#41の確定判断D＝
// ツリーそのものが管理者であり、その裏にモーダルは無い）――さもなければカラムを畳んだ
// ことで、作成・改名・削除まで黙って一緒に失われてしまう。
test('フライアウトからフォルダを作れる（#965 / #41 確定D）', async ({ launchHologram }) => {
  const { page } = await launchHologram({ seed: seedFolder });
  const flyout = page.locator('[data-slot="popover-content"]');

  await page.locator('[data-slot="menu-label"]', { hasText: /^フォルダ$/ }).click();
  await expect(flyout).toBeVisible();
  await flyout.locator('[data-sidebar="group-action"]').click();

  const dialog = page.locator('[data-slot="dialog-content"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('input').fill('新しい入れ物');
  await dialog.getByRole('button', { name: 'OK' }).click();

  await expect.poll(async () => (await page.evaluate(async () => (await window.hologram.getFolders()).folders.map((f) => f.name))).includes('新しい入れ物')).toBe(true);
});

// #981の受け入れ条件を、旧来の経路が無いことという形で述べる。1つのケースとして
// 書くのは、これらが1つの主張だからだ――どんな手段でも、たどり着ける第二の形は無い。
test('展開する手段が無い（#981）', async ({ launchHologram }) => {
  const { app, page } = await launchHologram();
  const sidebar = page.locator('[data-slot="sidebar"]');
  const railWidth = () => page.locator('[data-slot="sidebar-container"]').evaluate((el) => el.getBoundingClientRect().width);

  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  const width = await railWidth();

  // かつて展開に使っていたキーを、2回押す――トグルなら、1回目が飲み込まれても
  // 2回目で表れるはずだ。
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+b');
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  expect(await railWidth()).toBe(width);

  // トリガーボタンとドラッグ端は、単に隠れているのではなくDOMから無くなっている。
  await expect(page.locator('[data-slot="sidebar-trigger"]')).toHaveCount(0);
  await expect(page.locator('[data-slot="sidebar-rail"]')).toHaveCount(0);

  // ……そしてウィンドウの幅は、どちらの方向にもこれの形を変えない（#259の退避は、
  // それが退避していた形そのものと一緒に無くなった）。720はウィンドウ自身の最小値＝
  // shadcnの`md`より下で、そこでは本家ならパネルを開き口の無いモバイルSheetに
  // 差し替えていたはずの領域だ。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(720, 800));
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAttribute('data-state', 'collapsed');
  expect(await railWidth()).toBe(width);
});

test('行き先を押すとそのビューのフィルタがリセットされる（#812）', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  const postCards = page.locator('[data-slot="post-grid"] [data-slot="post-card"]');
  const posterCards = page.locator('[data-slot="poster-grid"] [data-slot="poster-card"]');
  const chips = page.locator('[data-slot="filter-chip"]');
  const search = page.getByRole('combobox', { name: 'ライブラリ内を検索', exact: true });
  const home = page.getByRole('button', { name: 'ホーム', exact: true });
  const posters = page.getByRole('button', { name: '投稿者', exact: true });

  await expect(postCards).toHaveCount(4);

  // モードをまたいだ到達＝投稿を絞り込み、投稿者へ飛び（未フィルタのまま手を付けず）、
  // それからホームへ戻る――ホームに着地すると投稿側がリセットされる。
  await search.fill('青');
  await expect(postCards).toHaveCount(1);
  await expect(search).toHaveValue('青');
  await posters.click();
  await expect(posterCards).toHaveCount(4);
  await home.click();
  await expect(postCards).toHaveCount(4);
  await expect(chips).toHaveCount(0);
  await expect(search).toHaveValue('');

  // 同じモードでの押し直し＝既に開いている行き先を押すのは、以前はストアの
  // 同値ガードによる純粋なno-opだった。フィルタがかかっている今は代わりに
  // リセットされる。
  await posters.click();
  await search.fill('akane');
  await expect(posterCards).toHaveCount(1);
  await posters.click();
  await expect(posterCards).toHaveCount(4);
  await expect(search).toHaveValue('');
});
