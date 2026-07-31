'use strict';

// #565 の回帰ハーネス。**同じ config ディレクトリで実 Electron を2回起動**して、
// 再起動をまたいでタブが「本数・順序・タイトル」より先まで戻ることを見る＝
// タブ内の戻る/進むの履歴（#144）とスクロール位置。1回起動の
// test-app-tabs.cts はセッション中の記憶（メモリ上）しか触れないので、
// DB へ書かれずに落ちていた3フィールドをまるごと見逃していた。
//
// 2本のタブに役割を分ける（1本には同居できない）:
//   タブ1 = 絞り込まずに深くスクロール → 起動時に復元されるスクロール位置
//   タブ2 = フィルタを1つ足して履歴を1コマ積む → 復元後に「戻る」が効くか
// 絞り込むとグリッドが短くなってスクロール位置が 0 に潰れるため、同じタブで
// 両方は測れない。
//
// 画像タブの見出し（autoTitle）はここでは触らない＝画像ビューを開く操作は
// 実レンダラだと手数が多くて壊れやすい。保存経路そのものは
// scripts/tabs-persist-roundtrip.test.ts が純ユニットで往復まで見ている。
//
//   node scripts/test-app-tab-restart.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');
const { seedLibrary } = require('./lib-seed-library.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tab-restart-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

// スクロール位置の検証には「1画面に収まらない」ことが要る＝収まっていると、
// 位置が戻ったのか動きようが無かったのかを区別できない（test-app-overview-zoom
// と同じ理由）。タグ alpha は先頭2件だけに付け、フィルタ後は短いグリッドになる。
const records: any[] = [];
for (let i = 0; i < 200; i++) {
  const captureId = `171760000000${i}-abcd`;
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), Buffer.from(jpegB64, 'base64'));
  records.push({
    captureId,
    image: `${captureId}.jpg`,
    url: `https://x.com/testuser/status/${i}`,
    platform: 'x',
    text: `タブ復元検証用のダミー投稿 ${i}`,
    tags: i < 2 ? ['alpha'] : ['beta'],
    displayName: 'てすと太郎',
    screenName: 'testuser',
    date: '2026-04-04T10:30:00Z',
    capturedAt: '2026-04-04T12:00:00Z',
  });
}
seedLibrary(configDir, records);

const TARGET_SCROLL = 800;

// 両方の起動で使う小道具。テンプレートに埋め込むので関数宣言のまま文字列で持つ。
const PRELUDE = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 8000) => { for (let i = 0; i * 50 < ms; i++) { if (fn()) return true; await sleep(50); } return false; };
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const scroller = () => document.querySelector('[data-slot="content-scroll"]');
  const tabItems = () => document.querySelectorAll('[data-slot="tab"]');
  const activeTitle = () => { const el = document.querySelector('[data-slot="tab"][data-active] [data-slot="tab-title"]'); return el ? el.textContent.trim() : ''; };
  const cardCount = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const backBtn = () => document.querySelector('button[aria-label="戻る"]');
  const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  // スクロール位置が動かなくなるまで待つ（仮想グリッドは描画窓を作り直す）。
  const settle = async () => {
    let last = Number.NaN, stable = 0;
    for (let i = 0; i < 60 && stable < 3; i++) {
      await sleep(50);
      const s = Math.round(scroller().scrollTop);
      if (s === last) stable++; else { stable = 0; last = s; }
    }
  };
  const ready = async () => {
    await waitFor(() => cardCount() > 0);
    return await waitFor(() => scroller().scrollHeight > scroller().clientHeight * 2);
  };
`;

// 1回目: タブ1を深くスクロールし、タブ2でフィルタを1つ足してから、タブ1を
// アクティブにして終了する。永続化は 400ms(スクロール) + 800ms(タブ) の二段
// デバウンス越しなので、最後にその分待つ。
const evalBoot1 = `(async () => {
  ${PRELUDE}
  const laidOut = await ready();
  scroller().scrollTop = ${TARGET_SCROLL};
  const scrolled = await waitFor(() => Math.abs(scroller().scrollTop - ${TARGET_SCROLL}) < 2, 3000);
  await settle();
  const savedScroll = Math.round(scroller().scrollTop);

  // タブ2: フィルタを足す＝タブ内履歴に1コマ積まれ、「戻る」が生える。
  key('t', { ctrlKey: true });
  await sleep(400);
  byText('button', 'フィルタ').click();
  await waitFor(() => !!byText('[data-slot="command-item"]', 'タグ'));
  byText('[data-slot="command-item"]', 'タグ').click();
  await waitFor(() => !!byText('[data-slot="popover-content"] span', 'alpha'));
  byText('[data-slot="popover-content"] span', 'alpha').click();
  await sleep(300);
  key('Escape'); await sleep(60);
  document.body.click(); await sleep(300);
  const filteredTitle = activeTitle();
  const filteredCards = cardCount();
  const canBackLive = !backBtn().disabled;

  // スクロールしていたタブへ戻してから終了（＝再起動後のアクティブタブ）。
  tabItems()[0].click();
  await sleep(500);
  await sleep(1400); // 400ms(scroll) + 800ms(tabs) デバウンスを越える

  let blob = null;
  try {
    const data = await window.hologram.getTabs();
    const t0 = data.tabs[0], t1 = data.tabs[1];
    blob = {
      tabs: data.tabs.length,
      activeIsFirst: data.activeTabId === t0.id,
      siblings: Object.keys(t0).sort().join(','),
      scrollTop: t0.state && t0.state.scrollTop,
      navLen: t1 && t1.state && t1.state.nav ? t1.state.nav.hist.length : 0,
    };
  } catch (e) {}

  return { laidOut, scrolled, savedScroll, tabCount: tabItems().length, filteredTitle, filteredCards, canBackLive, blob };
})()`;

// 2回目: 同じ config を読ませて起動し、復元された側だけを見る。
const evalBoot2 = `(async () => {
  ${PRELUDE}
  const laidOut = await ready();
  // アクティブタブ（1回目にスクロールしていた方）の位置が戻るか。復元は初回
  // 描画後の rAF×2 なので、値そのものを待つ。
  const scrollRestored = await waitFor(() => Math.abs(scroller().scrollTop - ${TARGET_SCROLL}) < 12, 8000);
  const restoredScroll = Math.round(scroller().scrollTop);
  const tabCount = tabItems().length;

  // フィルタタブへ切り替え＝永続化された履歴を adopt する経路。
  tabItems()[1].click();
  await sleep(700);
  const restoredTitle = activeTitle();
  const restoredCards = cardCount();
  const canBack = !backBtn().disabled;
  backBtn().click();
  await sleep(700);
  const afterBackTitle = activeTitle();
  const afterBackCards = cardCount();

  return { laidOut, scrollRestored, restoredScroll, tabCount, restoredTitle, restoredCards, canBack, afterBackTitle, afterBackCards };
})()`;

function boot(evalJs: string): Promise<Record<string, any>> {
  const env = Object.assign({}, process.env, {
    APPDATA: tmp,
    HOLOGRAM_CONFIG_DIR: configDir,
    HOLOGRAM_SMOKE: '1',
    HOLOGRAM_SMOKE_EVAL: evalJs,
  });
  return new Promise((resolve) => {
    const child = spawn(electronPath, ['.'], { cwd: appDir, env, stdio: ['inherit', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
      process.stdout.write(d);
    });
    child.on('close', () => {
      const m = out.match(/EVAL_RESULT (\{.*\})/);
      try {
        resolve(JSON.parse((m && m[1]) as string));
      } catch {
        resolve({});
      }
    });
  });
}

(async () => {
  const r1 = await boot(evalBoot1);
  const r2 = await boot(evalBoot2);
  fs.rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  const check = (label, cond) => {
    console.log((cond ? 'PASS' : 'FAIL') + '  ' + label);
    if (!cond) ok = false;
  };

  console.log('\n--- Tab restart restore (#565) ---\n');
  // 1回目が土台を作れたか（ここが崩れると2回目の判定に意味が無い）
  check('① 1回目: グリッドが1画面に収まらない', !!r1.laidOut && !!r1.scrolled);
  check(`① 1回目: ${TARGET_SCROLL}px までスクロールした`, Math.abs((r1.savedScroll ?? -1) - TARGET_SCROLL) < 4);
  check('① 1回目: 2タブになり、2つ目は alpha で絞り込まれている', r1.tabCount === 2 && r1.filteredCards === 2);
  check('① 1回目: 絞り込んだ直後は「戻る」が押せる', r1.canBackLive === true);
  // 永続化された塊の形（#565 の本体）
  check('② DB へ 2タブが載り、アクティブはスクロールしていた方', !!r1.blob && r1.blob.tabs === 2 && r1.blob.activeIsFirst === true);
  // main が返す形＝列3つ＋塊1つ。塊の中身は下の2行で見る（レンダラーの払い出し側で
  // 兄弟が増えていないことは scripts/tabstate.test.ts が見る）。
  check('② DB から返るタブは id/pinned/state/title の4つ', !!r1.blob && r1.blob.siblings === 'id,pinned,state,title');
  check('② スクロール位置が塊の中に入っている', !!r1.blob && Math.abs((r1.blob.scrollTop ?? -1) - TARGET_SCROLL) < 40);
  check('② 戻る/進むの履歴が塊の中に入っている（2コマ）', !!r1.blob && r1.blob.navLen >= 2);
  // 再起動後＝実際に戻るか
  check('③ 2回目: タブが2本とも戻る', r2.tabCount === 2);
  check(`③ 2回目: アクティブタブのスクロール位置が戻る (${r2.restoredScroll})`, r2.scrollRestored === true);
  check('③ 2回目: フィルタタブのタイトルが1回目と同じ', !!r2.restoredTitle && r2.restoredTitle === r1.filteredTitle);
  check('③ 2回目: フィルタタブは 2件のまま', r2.restoredCards === 2);
  check('③ 2回目: 「戻る」が押せる（履歴が生きて復元された）', r2.canBack === true);
  check('③ 2回目: 戻ると絞り込み前（すべて）へ帰る', !!r2.afterBackTitle && r2.afterBackTitle.includes('すべて') && r2.afterBackCards > 2);

  console.log('\n' + (ok ? 'TAB_RESTART_TEST_PASS' : 'TAB_RESTART_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
})();
