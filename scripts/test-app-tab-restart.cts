'use strict';

// Regression harness for #565. **Launches the real Electron app twice against the same
// config directory** and checks that tabs come back after a restart with more than just
// "count / order / title" restored — the in-tab back/forward history (#144) and the scroll
// position too. The single-launch test-app-tabs.cts only touches in-session (in-memory)
// state, so it completely missed 3 fields that were silently failing to reach the DB.
//
// Splits the work across two tabs (they can't coexist in one tab):
//   Tab 1 = scroll deep with no filter -> the scroll position restored on launch
//   Tab 2 = add one filter to push one entry onto the history -> does "back" work after restore
// Applying a filter shortens the grid and collapses the scroll position to 0, so both
// can't be measured in the same tab.
//
// The image tab's heading (autoTitle) isn't touched here — opening the image view takes
// too many steps in the real renderer and is fragile. The save path itself is covered
// round-trip as a pure unit test by scripts/tabs-persist-roundtrip.test.ts.
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

// Verifying the scroll position requires that it "doesn't fit on one screen" — if it does
// fit, there's no way to tell whether the position was restored or simply had nowhere to
// go (same reason as test-app-overview-zoom). Tag alpha is applied to only the first 2
// records, so the grid gets short after filtering.
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

// Helpers shared by both launches. Kept as a string (rather than function declarations) so it can be embedded in the template.
const PRELUDE = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // One budget per launch (#952). Every wait is capped by it, so a broken step
  // cannot chain timeouts into main's 60s SMOKE_TIMEOUT, which reports "no eval
  // result" and names nothing.
  const DEADLINE = Date.now() + 45000;
  // The loop counts wall clock, not iterations: under load a 50ms sleep lands
  // much later than 50ms, and an iteration-counted loop silently gives up early.
  const waitFor = async (fn, ms = 8000) => {
    const until = Math.min(Date.now() + ms, DEADLINE);
    while (Date.now() < until) { if (fn()) return true; await sleep(50); }
    return fn();
  };
  // Same, for post-conditions that live behind an IPC round trip.
  const waitForAsync = async (fn, ms = 10000) => {
    const until = Math.min(Date.now() + ms, DEADLINE);
    for (;;) {
      if (await fn()) return true;
      if (Date.now() >= until) return false;
      await sleep(100);
    }
  };
  const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
  const scroller = () => document.querySelector('[data-slot="content-scroll"]');
  const tabItems = () => document.querySelectorAll('[data-slot="tab"]');
  const activeTitle = () => { const el = document.querySelector('[data-slot="tab"][data-active] [data-slot="tab-title"]'); return el ? el.textContent.trim() : ''; };
  const cardCount = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
  const backBtn = () => document.querySelector('button[aria-label="戻る"]');
  const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  // Wait until the scroll position stops moving (the virtual grid rebuilds its render window).
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

// First launch: scroll tab 1 deep, add one filter in tab 2, then make tab 1 active before
// exiting. Persistence goes through a two-stage debounce of 400ms (scroll) + 800ms (tabs),
// so wait that long at the end.
const evalBoot1 = `(async () => {
  ${PRELUDE}
  const laidOut = await ready();
  scroller().scrollTop = ${TARGET_SCROLL};
  const scrolled = await waitFor(() => Math.abs(scroller().scrollTop - ${TARGET_SCROLL}) < 2, 3000);
  await settle();
  const savedScroll = Math.round(scroller().scrollTop);

  // Tab 2: add a filter -> pushes one entry onto the in-tab history, so "back" appears.
  key('t', { ctrlKey: true });
  await waitFor(() => tabItems().length === 2, 5000);
  byText('button', 'フィルタ').click();
  await waitFor(() => !!byText('[data-slot="command-item"]', 'タグ'));
  byText('[data-slot="command-item"]', 'タグ').click();
  await waitFor(() => !!byText('[data-slot="popover-content"] span', 'alpha'));
  byText('[data-slot="popover-content"] span', 'alpha').click();
  await waitFor(() => cardCount() === 2);
  key('Escape');
  await waitFor(() => !document.querySelector('[data-slot="popover-content"]'), 3000);
  document.body.click();
  // The tab's heading is rewritten by the filter it now carries; that rename is the
  // post-condition of the whole step (and what the second launch compares against).
  await waitFor(() => !!activeTitle() && !activeTitle().includes('すべて'), 5000);
  const filteredTitle = activeTitle();
  const filteredCards = cardCount();
  const canBackLive = !backBtn().disabled;

  // Switch back to the scrolled tab before exiting (= the active tab after restart).
  tabItems()[0].click();
  await waitFor(() => !!tabItems()[0] && tabItems()[0].hasAttribute('data-active'), 5000);

  // The write goes through a two-stage debounce (400ms scroll + 800ms tabs). Poll
  // what actually reached the DB rather than outlasting the debounce on a clock:
  // getTabs() reads SQLite, so the blob below IS the post-condition (#952).
  let blob = null;
  const readBlob = async () => {
    try {
      const data = await window.hologram.getTabs();
      const t0 = data.tabs[0], t1 = data.tabs[1];
      return {
        tabs: data.tabs.length,
        activeIsFirst: data.activeTabId === t0.id,
        siblings: Object.keys(t0).sort().join(','),
        scrollTop: t0.state && t0.state.scrollTop,
        navLen: t1 && t1.state && t1.state.nav ? t1.state.nav.hist.length : 0,
      };
    } catch (e) { return null; }
  };
  await waitForAsync(async () => {
    const b = await readBlob();
    if (b) blob = b; // keep the last readable shape so a timeout still reports what landed
    return !!b && b.tabs === 2 && b.activeIsFirst === true && Math.abs((b.scrollTop ?? -1) - ${TARGET_SCROLL}) < 40 && b.navLen >= 2;
  }, 12000);

  return { laidOut, scrolled, savedScroll, tabCount: tabItems().length, filteredTitle, filteredCards, canBackLive, blob };
})()`;

// Second launch: boot against the same config and only check the restored side.
const evalBoot2 = `(async () => {
  ${PRELUDE}
  const laidOut = await ready();
  // Does the active tab (the one scrolled in the first launch) get its position back?
  // Restore happens 2 rAFs after the first render, so wait for the actual value.
  const scrollRestored = await waitFor(() => Math.abs(scroller().scrollTop - ${TARGET_SCROLL}) < 12, 8000);
  const restoredScroll = Math.round(scroller().scrollTop);
  const tabCount = tabItems().length;

  // Switch to the filtered tab = the path that adopts the persisted history.
  tabItems()[1].click();
  // The restore is a chain — tab activated, its filter re-queried, its history
  // adopted — and each link is observable, so wait for all three rather than for
  // a number that has to cover the slowest machine.
  await waitFor(() => !!tabItems()[1] && tabItems()[1].hasAttribute('data-active') && cardCount() === 2 && !!backBtn() && !backBtn().disabled);
  const restoredTitle = activeTitle();
  const restoredCards = cardCount();
  const canBack = !backBtn().disabled;
  backBtn().click();
  await waitFor(() => activeTitle().includes('すべて') && cardCount() > 2);
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
  // Did the first launch build the foundation (if this breaks, the second launch's checks are meaningless)
  check('① 1回目: グリッドが1画面に収まらない', !!r1.laidOut && !!r1.scrolled);
  check(`① 1回目: ${TARGET_SCROLL}px までスクロールした`, Math.abs((r1.savedScroll ?? -1) - TARGET_SCROLL) < 4);
  check('① 1回目: 2タブになり、2つ目は alpha で絞り込まれている', r1.tabCount === 2 && r1.filteredCards === 2);
  check('① 1回目: 絞り込んだ直後は「戻る」が押せる', r1.canBackLive === true);
  // The shape of the persisted blob (the heart of #565)
  check('② DB へ 2タブが載り、アクティブはスクロールしていた方', !!r1.blob && r1.blob.tabs === 2 && r1.blob.activeIsFirst === true);
  // The shape main returns = 3 columns + 1 blob. The blob's contents are checked in the
  // next 2 lines (that no siblings got added on the renderer's unpacking side is covered
  // by scripts/tabstate.test.ts).
  check('② DB から返るタブは id/pinned/state/title の4つ', !!r1.blob && r1.blob.siblings === 'id,pinned,state,title');
  check('② スクロール位置が塊の中に入っている', !!r1.blob && Math.abs((r1.blob.scrollTop ?? -1) - TARGET_SCROLL) < 40);
  check('② 戻る/進むの履歴が塊の中に入っている（2コマ）', !!r1.blob && r1.blob.navLen >= 2);
  // After restart = does it actually come back
  check('③ 2回目: タブが2本とも戻る', r2.tabCount === 2);
  check(`③ 2回目: アクティブタブのスクロール位置が戻る (${r2.restoredScroll})`, r2.scrollRestored === true);
  check('③ 2回目: フィルタタブのタイトルが1回目と同じ', !!r2.restoredTitle && r2.restoredTitle === r1.filteredTitle);
  check('③ 2回目: フィルタタブは 2件のまま', r2.restoredCards === 2);
  check('③ 2回目: 「戻る」が押せる（履歴が生きて復元された）', r2.canBack === true);
  check('③ 2回目: 戻ると絞り込み前（すべて）へ帰る', !!r2.afterBackTitle && r2.afterBackTitle.includes('すべて') && r2.afterBackCards > 2);

  console.log('\n' + (ok ? 'TAB_RESTART_TEST_PASS' : 'TAB_RESTART_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
})();
