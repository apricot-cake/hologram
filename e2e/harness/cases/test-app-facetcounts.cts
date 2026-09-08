'use strict';

// 「+ フィルタ」の値エディタ（filterbar コンポーネント — qf-pop のフライアウトは
// P2③以降無くなった）にわたるファセットの数を検証する。2つの振る舞いを
// 検証する:
//   固定リスト（プラットフォーム）: どの値も数を持ち、数は「現在の」問い合わせを
//     反映し、0 でも自分の場所を保つ（灰色化しない＝順序が安定している）。
//   facetDim リスト（タグ）: 数は問い合わせを反映し「かつ」0の値は灰色化する。
//   「タグなし」（P2⑬）: タグエディタの先頭に固定され、他の値と同じように数え
//     られ、選ぶとタグの無い投稿だけが残る — 引退したタグ付けセッションモード
//     を置き換えた組み合わせの、フィルタ側の半分。
//   シード: p0 x/猫/reply, p1 x/犬, p2 x/猫, p3 bluesky/猫, p4 pixiv/（タグ無し）
//     全プラットフォーム → x=3, bluesky=1, pixiv=1
//     フィルタ tag=猫 → x=2, bluesky=1, pixiv=0（pixiv の行は残る。灰色化
//     しない）; タグエディタ: 犬 の数は0で灰色化
//
//   node e2e/harness/cases/test-app-facetcounts.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-fc-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [
  { plat: 'x', url: 'https://x.com/u0/status/800', tags: ['猫'], isReply: true },
  { plat: 'x', url: 'https://x.com/u1/status/801', tags: ['犬'] },
  { plat: 'x', url: 'https://x.com/u2/status/802', tags: ['猫'] },
  { plat: 'bluesky', url: 'https://bsky.app/profile/u3/post/803', tags: ['猫'] },
  { plat: 'pixiv', url: 'https://www.pixiv.net/artworks/804', tags: [] },
];
const records: any[] = [];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-fc' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: s.url,
    platform: s.plat,
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    isReply: !!s.isReply,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: s.tags,
    hashtags: [],
  });
});
seedLibrary(configDir, records);

const evalJs = evalSource(async ({ waitFor, waitStable }) => {
  const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const posterCards = () => document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length;
  // フィルタバーの流儀（test-app-tabs を参照）: 「+ フィルタ」のポップオーバー
  // → Command のカテゴリ一覧 → ValueEditor の行（ラベルの span と
  // tabular-nums の数を持つ div.cursor-default）。smoke ウィンドウは
  // フォーカスされていないので退出アニメーションは絞られる — ポップアップの
  // 完全なアンマウントを待つと、9秒のハーネス上限に対して秒単位のコストが
  // かかる。代わりに、1回のポップオーバーセッションの中でエディタの 戻る
  // ボタンでカテゴリ間を移動し、すべての問い合わせを開いている
  // （:not([data-closed])）ポップアップへ絞り込む。
  const POP = '[data-slot="popover-content"]:not([data-closed])';
  const byText = (sel: string, text: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' div.cursor-default')];
  const rowEl = (name: string) =>
    edRows().find((el) => {
      const n = el.querySelector('span.truncate');
      return n && n.textContent === name;
    }) || null;
  const cntSpan = (name: string) => {
    const r = rowEl(name);
    return r ? r.querySelector('span.tabular-nums') : null;
  };
  const cntOf = (name: string) => {
    const c = cntSpan(name);
    return c ? c.textContent : null;
  };
  const offOf = (name: string) => {
    const c = cntSpan(name);
    return c ? c.className.includes('/60') : null;
  }; // 灰色化した0の数（ValueRow の off 状態）
  // このハーネスが駆動するコントロールはどれも名前を付けてあり、無い場合は
  // その名前のまま例外を投げる。代わりにクリックをオプショナルチェインに
  // すると、静かに飛ばされてしまい、下の数の主張が、一度も開かれなかった
  // ファセットについて報告することになる。
  const clickByText = (sel: string, text: string) => {
    const el = byText(sel, text);
    if (!el) throw new Error(sel + ' に一致し、テキスト ' + text + ' を持つ要素が無い');
    el.click();
  };
  const openMenu = async () => {
    clickByText('button', 'フィルタ');
    await waitFor('フィルタメニューがカテゴリを一覧すること', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };
  const pickCat = async (label: string) => {
    clickByText(POP + ' [data-slot="command-item"]', label);
    await waitFor(label + ' エディタが値を一覧すること', () => edRows().length > 0);
  };
  const goBack = async () => {
    const back = document.querySelector<HTMLElement>(POP + ' button[aria-label="戻る"]');
    if (!back) throw new Error('開いている値エディタに 戻る ボタンが見つからない');
    back.click();
    await waitFor('カテゴリ一覧が戻ること', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
  };
  // 値の行を切り替えると問い合わせが再実行される。観測可能な事後条件は、
  // グリッドが持っていた数から「離れる」ことであり、期待した数に「達する」
  // ことではない。それは下の検証の役目。
  const pickValue = async (name: string) => {
    const before = cards();
    const row = rowEl(name);
    if (!row) throw new Error('開いている値エディタに ' + name + ' の行が見つからない');
    row.click();
    await waitFor(name + ' を選んだ後でグリッドが再フィルタされること', () => cards() !== before);
    await waitStable(name + ' を選んだ後でグリッドが動かなくなること', cards);
  };
  await waitFor('グリッドがシードした5件の投稿すべてを表示すること', () => cards() >= 5);
  const r: Record<string, unknown> = {};
  // 全プラットフォームの数（固定リスト — 順序保持、数は必ず存在）
  await openMenu();
  await pickCat('サイト'); // #253: プラットフォーム から改名
  r.pfX_all = cntOf('X'); // 3
  r.pfBsky_all = cntOf('Bluesky'); // 1
  r.pfPixiv_all = cntOf('pixiv'); // 1
  // 自分のエディタ経由で tag=猫 を適用する
  await goBack();
  await pickCat('タグ');
  // 「タグなし」（P2⑬）— 先頭に固定され、同じ母集団に対して数えられ、選ぶと
  // タグを一切持たない投稿（p4）だけが残る。2回選んで5件すべてへ戻る:
  // この行も他の値の行と同じようにトグルする。
  const firstRow = edRows()[0];
  const firstLabel = firstRow ? firstRow.querySelector('span.truncate') : null;
  r.noneFirst = firstLabel ? firstLabel.textContent : undefined; // 'タグなし'
  r.noneCount = cntOf('タグなし'); // 1
  await pickValue('タグなし');
  r.noneCards = cards(); // 1 (p4)
  await pickValue('タグなし');
  r.noneOffCards = cards(); // 5 again
  await pickValue('猫');
  r.afterCatCards = cards(); // 3 (p0,p2,p3)
  // プラットフォームへ戻る — 数は今や 猫 の問い合わせを反映する（values() は
  // 生きた木を読む）
  await goBack();
  await pickCat('サイト'); // #253: プラットフォーム から改名
  r.pfX_cat = cntOf('X'); // 2
  r.pfPixiv_cat = cntOf('pixiv'); // 0
  r.pfPixiv_off = offOf('pixiv'); // false（固定リスト: 数はあるが灰色化しない）
  // タグへ戻る — 犬 は今や不在（0）で、facetDim リストでは灰色化される
  await goBack();
  await pickCat('タグ');
  r.tagCat = cntOf('猫'); // 3
  r.tagDog = cntOf('犬'); // 0
  r.tagDogOff = offOf('犬'); // true（facetDim は0を灰色化する）
  r.noneCatCount = cntOf('タグなし'); // 0（タグ無しの投稿で 猫 であるものは無い）
  r.noneCatOff = offOf('タグなし'); // true — 他の不在の値と同じように灰色化される
  // --- 投稿者ビュー: 数は filteredPosters() から来る（母集団＝投稿者） ---
  clickByText('button', 'フィルタ'); // トグルで閉じる
  // ポップアップは去り始めた瞬間に [data-closed] が付く。それが値のある
  // 事後条件で、アンマウント自体はこのフォーカスされていないウィンドウでは
  // アニメーションが絞られ秒単位のコストがかかるので、待つのは
  // （[data-closed] を除外する）POP の方。
  await waitFor('フィルタのポップオーバーが閉じ始めること', () => !document.querySelector(POP));
  clickByText('button', '投稿者');
  await waitFor('投稿者ビューが5人の投稿者すべてを表示すること', () => posterCards() >= 5);
  await openMenu();
  await pickCat('プラットフォーム'); // poster-platform（投稿者モードでも同じラベル）
  r.posterPfX = cntOf('X'); // 3 posters (u0,u1,u2)
  r.posterPfBsky = cntOf('Bluesky'); // 1 (u3)
  r.posterPfPixiv = cntOf('pixiv'); // 1 (u4)
  return r;
});

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram'), HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
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
  const fixed = r.pfX_all === '3' && r.pfBsky_all === '1' && r.pfPixiv_all === '1' && r.afterCatCards === 3 && r.pfX_cat === '2' && r.pfPixiv_cat === '0' && r.pfPixiv_off === false;
  const facetDim = r.tagCat === '3' && r.tagDog === '0' && r.tagDogOff === true;
  const none = r.noneFirst === 'タグなし' && r.noneCount === '1' && r.noneCards === 1 && r.noneOffCards === 5 && r.noneCatCount === '0' && r.noneCatOff === true;
  const poster = r.posterPfX === '3' && r.posterPfBsky === '1' && r.posterPfPixiv === '1';
  const ok = fixed && facetDim && none && poster;
  console.log(`fixed: pfX_all=${r.pfX_all} bsky=${r.pfBsky_all} pixiv=${r.pfPixiv_all} afterCat=${r.afterCatCards} pfX_cat=${r.pfX_cat} pixiv_cat=${r.pfPixiv_cat} pixiv_off=${r.pfPixiv_off}`);
  console.log(`facetDim: tagCat=${r.tagCat} tagDog=${r.tagDog} tagDogOff=${r.tagDogOff}`);
  console.log(`tagNone: first=${r.noneFirst} count=${r.noneCount} cards=${r.noneCards} offCards=${r.noneOffCards} catCount=${r.noneCatCount} catOff=${r.noneCatOff}`);
  console.log(`poster: pfX=${r.posterPfX} bsky=${r.posterPfBsky} pixiv=${r.posterPfPixiv}`);
  console.log(ok ? 'FACETCOUNTS_TEST_PASS' : 'FACETCOUNTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
