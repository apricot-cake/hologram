'use strict';

// ブラウザ風のタブシステムに対する smoke テスト（フェーズ3検証）。
// 検証すること: 初期状態、フィルタ→タイトルの同期、Ctrl+T の新規タブ、
// 切り替え時の状態復元、Ctrl+W のクローズ、最後の1タブのリセット、
// tabs.json の永続化。
//
//   node scripts/test-app-tabs.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tabs-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');

const records: any[] = [];
function addPost(id, text, tags) {
  fs.writeFileSync(path.join(saveFolder, `${id}.jpg`), jpeg);
  records.push({
    captureId: id,
    image: `${id}.jpg`,
    url: `https://x.com/u/status/${id}`,
    platform: 'x',
    text,
    tags: tags || [],
    capturedAt: '2026-01-01T00:00:00.000Z',
    date: '2026-01-01T00:00:00.000Z',
  });
}

addPost('p1', '投稿1', ['alpha']);
addPost('p2', '投稿2', ['alpha', 'beta']);
addPost('p3', '投稿3', ['beta']);
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ sleep, waitFor, waitStable }) => {
  const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const tabItems = () => document.querySelectorAll<HTMLElement>('[data-slot="tab"]');
  const tabCount = () => tabItems().length;
  const tabActiveAt = (i) => {
    const t = tabItems();
    return t.length > i && t[i].hasAttribute('data-active');
  };
  const activeTitle = () => {
    const el = document.querySelector('[data-slot="tab"][data-active] [data-slot="tab-title"]');
    return el ? (el.textContent || '').trim() : '';
  };
  const cardCount = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const chipRow = () => document.querySelector('[data-slot="filter-chips"]');
  const chipText = () => {
    const c = chipRow();
    return c ? c.textContent || '' : '';
  };
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  // タブの切り替えはレンダラーの状態を即座に変えるが、グリッドは IPC 経由で
  // 再充填されるので、以下の各ステップは、数が前のタブの値から「離れる」の
  // を待ち、それから動かなくなるのを待つ — 期待する数を待ってしまうと
  // 何も主張しないことになる。

  await waitFor('グリッドがシードした3件の投稿すべてを表示すること', () => cardCount() >= 3);
  await waitFor('タブバーがアクティブなタブのタイトルを描画すること', () => activeTitle().length > 0);

  // ① 初期状態
  const initTabCount = tabCount();
  const initTitle = activeTitle();

  // ② 「+ フィルタ」の流れで alpha フィルタを加える（filterbar コンポーネント
  //    — qf-pop のフライアウトは P2③以降無くなった）: ポップオーバーを開き、
  //    「タグ」を選び、alpha の行をクリックする。
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  byText('button', 'フィルタ').click();
  await waitFor('フィルタメニューがカテゴリを一覧すること', () => !!byText('[data-slot="command-item"]', 'タグ'));
  byText('[data-slot="command-item"]', 'タグ').click();
  await waitFor('タグエディタが alpha タグを一覧すること', () => !!byText('[data-slot="popover-content"] span', 'alpha'));
  byText('[data-slot="popover-content"] span', 'alpha').click();
  await waitFor('チップ行が適用済みの alpha タグを示すこと', () => chipText().includes('alpha'));
  await waitFor('alpha タグの適用でグリッドが絞られること', () => cardCount() < 3);
  // ピッカーを閉じる（複数の値を切り替えられるよう仕様として開いたまま
  // 残るので）: Escape が正規の閉じ方、外側クリックはフォーカスを保持し
  // 続ける時の代替
  key('Escape');
  document.body.click();
  await waitFor('値ピッカーが閉じること', () => !document.querySelector(POP));
  const filteredTitle = activeTitle();
  const filteredCards = cardCount();

  // ③ Ctrl+T → 新規タブ
  key('t', { ctrlKey: true });
  await waitFor('新規タブが開きフォーカスを得ること', () => tabCount() >= 2 && tabActiveAt(1));
  await waitFor('新規タブがフィルタ後の件数から離れること', () => cardCount() !== filteredCards);
  await waitStable('新規タブのグリッドが動かなくなること', () => cardCount());
  const tab2Count = tabCount();
  const tab2Title = activeTitle();
  const tab2Cards = cardCount();

  // ④ タブ1へ切り替え直す → フィルタが復元される
  const t0 = tabItems()[0];
  if (t0) t0.click();
  await waitFor('タブ1が再びアクティブタブになること', () => tabActiveAt(0));
  await waitFor('グリッドがフィルタ無しの件数から離れること', () => cardCount() !== tab2Cards);
  await waitStable('復元されたグリッドが動かなくなること', () => cardCount());
  const restoredTitle = activeTitle();
  const restoredCards = cardCount();

  // ⑤ タブ2へ切り替え → 空の状態
  const t1 = tabItems()[1];
  if (t1) t1.click();
  await waitFor('タブ2がアクティブタブになること', () => tabActiveAt(1));
  await waitFor('グリッドがフィルタ後の件数から離れること', () => cardCount() !== restoredCards);
  await waitStable('タブ2でグリッドが再び動かなくなること', () => cardCount());
  const tab2RestoredTitle = activeTitle();
  const tab2RestoredCards = cardCount();

  // ⑥ Ctrl+W → タブ2を閉じ、タブ1がアクティブになる
  key('w', { ctrlKey: true });
  await waitFor('閉じたタブの後にタブが1つだけ残ること', () => tabCount() <= 1);
  await waitFor('生き残ったタブが絞られたグリッドを取り戻すこと', () => cardCount() !== tab2RestoredCards);
  await waitStable('タブが閉じた後グリッドが動かなくなること', () => cardCount());
  const afterCloseCount = tabCount();
  const afterCloseTitle = activeTitle();
  const afterCloseCards = cardCount();

  // ⑦ 最後の1タブで Ctrl+W → 状態がリセットされる。ウィンドウは閉じない
  key('w', { ctrlKey: true });
  await waitFor('最後のタブがリセットでフィルタチップを落とすこと', () => chipRow() === null);
  await waitFor('リセットされたグリッドが絞られた件数から離れること', () => cardCount() !== afterCloseCards);
  await waitStable('リセット後グリッドが動かなくなること', () => cardCount());
  const lastTabCount = tabCount();
  const lastTabTitle = activeTitle();
  const lastTabCards = cardCount();

  // ⑧ 永続化はレンダラー内で800msデバウンスされるので、ここではその遅延
  // 自体が仕様: それが経過するまでポーリングできる観測可能なものが無い。
  // biome-ignore lint/plugin: the 800ms renderer debounce before the write is the spec — nothing is observable until it elapses.
  await sleep(1000);
  let ipcOk = false;
  try {
    const data = await (window as any).hologram.getTabs();
    ipcOk = !!(data && Array.isArray(data.tabs) && data.tabs.length >= 1);
  } catch {}

  return {
    initTabCount,
    initTitle,
    filteredTitle,
    filteredCards,
    tab2Count,
    tab2Title,
    tab2Cards,
    restoredTitle,
    restoredCards,
    tab2RestoredTitle,
    tab2RestoredCards,
    afterCloseCount,
    afterCloseTitle,
    afterCloseCards,
    lastTabCount,
    lastTabTitle,
    lastTabCards,
    ipcOk,
  };
});

const shot = path.join(appDir, '.smoke-shot.png');
try {
  fs.unlinkSync(shot);
} catch {}

const env = Object.assign({}, process.env, {
  APPDATA: tmp,
  HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'),
  HOLOGRAM_SMOKE: '1',
  HOLOGRAM_SMOKE_EVAL: evalJs,
  HOLOGRAM_SMOKE_SHOT: shot,
});

const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
let out = '';
child.stdout.on('data', (d) => {
  out += d.toString();
  process.stdout.write(d);
});

child.on('close', () => {
  const m = out.match(/EVAL_RESULT (\{.*\})/);
  let r: Record<string, any> = {};
  try {
    r = JSON.parse((m && m[1]) as string);
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- Tab system smoke test ---\n');
  check('① 初期: 1タブ', r.initTabCount === 1);
  check('① 初期タイトルが "すべて" を含む', r.initTitle && r.initTitle.includes('すべて'));
  check('② alpha フィルタ後: タイトルが "すべて" でない', r.filteredTitle && !r.filteredTitle.startsWith('すべて'));
  check('② alpha フィルタ後: 2件に絞り込まれている', r.filteredCards === 2);
  check('③ Ctrl+T 後: 2タブ', r.tab2Count === 2);
  check('③ 新タブタイトルが "すべて" を含む', r.tab2Title && r.tab2Title.includes('すべて'));
  check('③ 新タブは全件表示 (3件)', r.tab2Cards === 3);
  check('④ タブ1に戻る: フィルタタイトル復元', r.restoredTitle && !r.restoredTitle.startsWith('すべて'));
  check('④ タブ1に戻る: 2件に絞り込まれたまま', r.restoredCards === 2);
  check('⑤ タブ2に戻る: "すべて" タイトル', r.tab2RestoredTitle && r.tab2RestoredTitle.includes('すべて'));
  check('⑤ タブ2に戻る: 3件表示', r.tab2RestoredCards === 3);
  check('⑥ Ctrl+W: 1タブになる', r.afterCloseCount === 1);
  check('⑥ Ctrl+W 後: タブ1 (alpha) がアクティブ', r.afterCloseTitle && !r.afterCloseTitle.startsWith('すべて'));
  check('⑥ Ctrl+W 後: 2件表示 (alpha フィルタ)', r.afterCloseCards === 2);
  check('⑦ 最後の1タブ Ctrl+W: タブ数は1のまま', r.lastTabCount === 1);
  check('⑦ 最後の1タブ Ctrl+W: タイトルが "すべて" にリセット', r.lastTabTitle && r.lastTabTitle.includes('すべて'));
  check('⑦ 最後の1タブ Ctrl+W: 3件 (フィルタ解除)', r.lastTabCards === 3);
  check('⑧ タブがDBへ永続 (IPC 確認)', r.ipcOk);

  console.log('\n' + (ok ? 'TABS_TEST_PASS' : 'TABS_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
});
