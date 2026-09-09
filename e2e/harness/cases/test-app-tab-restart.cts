'use strict';

// #565 の回帰ハーネス。**同じ設定ディレクトリに対して実際の Electron アプリを
// 2回起動し**、再起動後にタブが「件数/順序/タイトル」の復元だけでなく、
// タブ内の戻る/進む履歴（#144）とスクロール位置も戻ることを検証する。単発
// 起動の test-app-tabs.cts はセッション内（メモリ上）の状態にしか触れないので、
// DB に届くのに静かに失敗していた3つのフィールドを完全に見逃していた。
//
// 作業を2つのタブに分ける（1つのタブでは両立できないため）:
//   タブ1＝フィルタ無しで深くスクロール -> 起動時にスクロール位置が戻るか
//   タブ2＝フィルタを1つ加えて履歴に1件積む -> 復元後に「戻る」が効くか
// フィルタを適用するとグリッドが短くなりスクロール位置が0に潰れるので、
// 両方を同じタブで計測することはできない。
//
// 画像タブの見出し（autoTitle）はここでは触れない — 実際のレンダラーで画像
// ビューを開くにはステップが多すぎて壊れやすい。保存の経路自体は
// tests/integration/tabs-persist-roundtrip.test.ts が純粋な単体テストとして往復を
// カバーしている。
//
//   node e2e/harness/cases/test-app-tab-restart.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const electronPath = resolveElectron();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tab-restart-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

// スクロール位置の検証には「1画面に収まらない」ことが必要 — 収まってしまうと、
// 位置が復元されたのか単に動く先が無かっただけなのか見分けが付かない
// （test-app-overview-zoom と同じ理由）。タグ alpha は最初の2件だけに付けて
// あるので、フィルタ後のグリッドは短くなる。
const records: any[] = [];
for (let i = 0; i < 200; i++) {
  const captureId = `171760000000${i}-abcd`;
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), Buffer.from(jpegB64, 'base64'));
  records.push({
    captureId,
    image: `${captureId}.jpg`,
    media: [{ file: `${captureId}.jpg`, url: `https://pbs.twimg.com/media/${captureId}.jpg` }],
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

// かつて2つの起動は、両方のテンプレートリテラルへ継ぎ込んだ PRELUDE 文字列
// 経由で UI ヘルパーを共有していた。それこそが、その中の待ちを Biome が
// 見えなくしていた原因そのもの（#986）: evalSource() へ渡す関数はシリアライズ
// されるので、このファイルの何かをクロージャとして捕まえることはできない
// — 普通の、lint できるコードでいることの代償は、各起動がそれぞれ使う
// わずかなヘルパーを自分のコピーとして持つこと。
//
// 最初の起動: タブ1を深くスクロールし、タブ2に1つフィルタを加え、それから
// 終了前にタブ1をアクティブにする。永続化は2段階のデバウンス、400ms
// （スクロール）+ 800ms（タブ）を経る。この起動の最後は、そのデバウンスを
// 時計で待ちきるのではなく、実際に DB へ届いたものをポーリングする
// （下の readBlob を参照）。
const evalBoot1 = evalSource(
  async ({ waitFor, waitStable }, args) => {
    const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
    // `!` ではなく名前を付けて弾く: 以下の計測はすべてスクローラーを読むので、
    // それが無い場合は間違った数値を報告するのではなく、実行を止めて要素の
    // 名前を言うべき。
    const scroller = () => {
      const el = document.querySelector('[data-slot="content-scroll"]');
      if (!el) throw new Error('コンテンツのスクローラーがドキュメントに見つからない');
      return el;
    };
    const tabItems = () => document.querySelectorAll<HTMLElement>('[data-slot="tab"]');
    const activeTitle = () => {
      const el = document.querySelector('[data-slot="tab"][data-active] [data-slot="tab-title"]');
      return el ? (el.textContent || '').trim() : '';
    };
    const cardCount = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
    const backBtn = () => document.querySelector<HTMLButtonElement>('button[aria-label="戻る"]');
    const key = (k, opts = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
    const ready = async () => {
      await waitFor('グリッドが最初のカードを描画すること', () => cardCount() > 0);
      return await waitFor('グリッドがスクロールできるよう1画面を超えて伸びること', () => scroller().scrollHeight > scroller().clientHeight * 2);
    };

    const laidOut = await ready();
    scroller().scrollTop = args.targetScroll;
    const scrolled = await waitFor('スクローラーが目標位置に達すること', () => Math.abs(scroller().scrollTop - args.targetScroll) < 2, 3000);
    // 仮想グリッドは描画ウィンドウを再構築し、位置を再び動かし得るので、
    // 観測可能な事後条件は「特定の数値に達した」ことではなく「計測値が
    // 繰り返される」こと。
    await waitStable('仮想グリッドの再構築でスクロール位置が動かなくなること', () => Math.round(scroller().scrollTop));
    const savedScroll = Math.round(scroller().scrollTop);

    // タブ2: フィルタを加える -> タブ内履歴に1件積まれるので「戻る」が現れる。
    key('t', { ctrlKey: true });
    await waitFor('2つ目のタブが開くこと', () => tabItems().length === 2, 5000);
    byText('button', 'フィルタ').click();
    await waitFor('フィルタメニューがカテゴリを一覧すること', () => !!byText('[data-slot="command-item"]', 'タグ'));
    byText('[data-slot="command-item"]', 'タグ').click();
    await waitFor('タグピッカーが alpha タグを一覧すること', () => !!byText('[data-slot="popover-content"] span', 'alpha'));
    byText('[data-slot="popover-content"] span', 'alpha').click();
    await waitFor('グリッドが alpha の2件に絞られること', () => cardCount() === 2);
    key('Escape');
    await waitFor('タグピッカーが閉じること', () => !document.querySelector('[data-slot="popover-content"]'), 3000);
    document.body.click();
    // タブの見出しは今持っているフィルタで書き換わる。その改名がこのステップ
    // 全体の事後条件（そして2回目の起動が比較する対象）。
    await waitFor('タブの見出しが今持っているフィルタで書き換わること', () => !!activeTitle() && !activeTitle().includes('すべて'), 5000);
    const filteredTitle = activeTitle();
    const filteredCards = cardCount();
    // `!` ではなく名前を付けて弾く: ここでの主張は「戻る」が生きていることなので、
    // ページに存在すらしないボタンは「無効ではない」と読まれるのではなく、
    // それをそのまま言うべき。
    const backAfterFilter = backBtn();
    if (!backAfterFilter) throw new Error('フィルタを適用した直後に「戻る」ボタンが見つからない');
    const canBackLive = !backAfterFilter.disabled;

    // 終了前にスクロールしたタブへ戻す（＝再起動後のアクティブタブ）。
    tabItems()[0].click();
    await waitFor('スクロールしたタブが再びアクティブタブになること', () => !!tabItems()[0] && tabItems()[0].hasAttribute('data-active'), 5000);

    // 書き込みは2段階のデバウンス（400msのスクロール＋800msのタブ）を経る。
    // そのデバウンスを時計で待ちきるのではなく、実際に DB へ届いたものを
    // ポーリングする: getTabs() は SQLite を読むので、下の blob 自体が事後
    // 条件（#952）。
    let blob: Record<string, any> | null = null;
    const readBlob = async () => {
      try {
        const data = await (window as any).hologram.getTabs();
        const t0 = data.tabs[0];
        const t1 = data.tabs[1];
        return {
          tabs: data.tabs.length,
          activeIsFirst: data.activeTabId === t0.id,
          siblings: Object.keys(t0).sort().join(','),
          scrollTop: t0.state && t0.state.scrollTop,
          navLen: t1 && t1.state && t1.state.nav ? t1.state.nav.hist.length : 0,
        };
      } catch {
        return null;
      }
    };
    await waitFor(
      '2つのタブとスクロール位置と戻る/進む履歴がデータベースへ届くこと',
      async () => {
        const b = await readBlob();
        if (b) blob = b; // 最後に読めた形を保持し、タイムアウトしても実際に届いたものを報告する
        return !!b && b.tabs === 2 && b.activeIsFirst === true && Math.abs((b.scrollTop ?? -1) - args.targetScroll) < 40 && b.navLen >= 2;
      },
      12000,
    );

    return { laidOut, scrolled, savedScroll, tabCount: tabItems().length, filteredTitle, filteredCards, canBackLive, blob };
  },
  { targetScroll: TARGET_SCROLL },
);

// 2回目の起動＝同じ設定で立ち上げ、復元された側だけを見る。
const evalBoot2 = evalSource(
  async ({ waitFor }, args) => {
    // 最初の起動と同じヘルパーだが、使わない2つを除いてある — 共有せず
    // 繰り返す理由は evalBoot1 の上の注記を参照。
    const scroller = () => {
      const el = document.querySelector('[data-slot="content-scroll"]');
      if (!el) throw new Error('コンテンツのスクローラーがドキュメントに見つからない');
      return el;
    };
    const tabItems = () => document.querySelectorAll<HTMLElement>('[data-slot="tab"]');
    const activeTitle = () => {
      const el = document.querySelector('[data-slot="tab"][data-active] [data-slot="tab-title"]');
      return el ? (el.textContent || '').trim() : '';
    };
    const cardCount = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
    const backBtn = () => document.querySelector<HTMLButtonElement>('button[aria-label="戻る"]');
    const ready = async () => {
      await waitFor('グリッドが最初のカードを描画すること', () => cardCount() > 0);
      return await waitFor('グリッドがスクロールできるよう1画面を超えて伸びること', () => scroller().scrollHeight > scroller().clientHeight * 2);
    };

    const laidOut = await ready();
    // アクティブなタブ（最初の起動でスクロールしたもの）は位置を取り戻すか?
    // 復元は最初の描画から2 rAF 後に起きるので、実際の値を待つ。
    const scrollRestored = await waitFor('復元されたタブが保存済みのスクロール位置を示すこと', () => Math.abs(scroller().scrollTop - args.targetScroll) < 12, 8000);
    const restoredScroll = Math.round(scroller().scrollTop);
    const tabCount = tabItems().length;

    // フィルタ済みのタブへ切り替える＝永続化された履歴を引き継ぐ経路。
    tabItems()[1].click();
    // 復元は連鎖している — タブが有効化され、フィルタが再問い合わせされ、
    // 履歴が引き継がれる — その各段が観測可能なので、最も遅いマシンを
    // カバーしなければならない数値を待つのではなく、3つすべてを待つ。
    await waitFor('フィルタ済みタブが投稿と履歴を復元して有効化すること', () => {
      const back = backBtn();
      return !!tabItems()[1] && tabItems()[1].hasAttribute('data-active') && cardCount() === 2 && !!back && !back.disabled;
    });
    const restoredTitle = activeTitle();
    const restoredCards = cardCount();
    // `!` ではなく名前を付けて弾く: 復元された履歴こそが主張なので、ボタンが
    // 無い場合は無効なボタンとして読まれるのではなく、実行を止めるべき。
    const backRestored = backBtn();
    if (!backRestored) throw new Error('フィルタ済みタブの復元後に「戻る」ボタンが見つからない');
    const canBack = !backRestored.disabled;
    const backToClick = backBtn();
    if (!backToClick) throw new Error('クリックする前に「戻る」ボタンが消えた');
    backToClick.click();
    await waitFor('戻るとタブがフィルタ無しの表示へ帰ること', () => activeTitle().includes('すべて') && cardCount() > 2);
    const afterBackTitle = activeTitle();
    const afterBackCards = cardCount();

    return { laidOut, scrollRestored, restoredScroll, tabCount, restoredTitle, restoredCards, canBack, afterBackTitle, afterBackCards };
  },
  { targetScroll: TARGET_SCROLL },
);

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
  // 最初の起動が土台を築けたか（これが崩れていると2回目の起動の検証は無意味）
  check('① 1回目: グリッドが1画面に収まらない', !!r1.laidOut && !!r1.scrolled);
  check(`① 1回目: ${TARGET_SCROLL}px までスクロールした`, Math.abs((r1.savedScroll ?? -1) - TARGET_SCROLL) < 4);
  check('① 1回目: 2タブになり、2つ目は alpha で絞り込まれている', r1.tabCount === 2 && r1.filteredCards === 2);
  check('① 1回目: 絞り込んだ直後は「戻る」が押せる', r1.canBackLive === true);
  // 永続化された塊の形（#565 の核心）
  check('② DB へ 2タブが載り、アクティブはスクロールしていた方', !!r1.blob && r1.blob.tabs === 2 && r1.blob.activeIsFirst === true);
  // main が返す形＝3列＋塊1個。塊の中身は次の2行で検証する（レンダラー側の
  // 展開でよけいな兄弟フィールドが増えていないことは app/src/renderer/src/services/tabstate.test.ts
  // がカバーしている）。
  check('② DB から返るタブは id/pinned/state/title の4つ', !!r1.blob && r1.blob.siblings === 'id,pinned,state,title');
  check('② スクロール位置が塊の中に入っている', !!r1.blob && Math.abs((r1.blob.scrollTop ?? -1) - TARGET_SCROLL) < 40);
  check('② 戻る/進むの履歴が塊の中に入っている（2コマ）', !!r1.blob && r1.blob.navLen >= 2);
  // 再起動後＝実際に戻ってくるか
  check('③ 2回目: タブが2本とも戻る', r2.tabCount === 2);
  check(`③ 2回目: アクティブタブのスクロール位置が戻る (${r2.restoredScroll})`, r2.scrollRestored === true);
  check('③ 2回目: フィルタタブのタイトルが1回目と同じ', !!r2.restoredTitle && r2.restoredTitle === r1.filteredTitle);
  check('③ 2回目: フィルタタブは 2件のまま', r2.restoredCards === 2);
  check('③ 2回目: 「戻る」が押せる（履歴が生きて復元された）', r2.canBack === true);
  check('③ 2回目: 戻ると絞り込み前（すべて）へ帰る', !!r2.afterBackTitle && r2.afterBackTitle.includes('すべて') && r2.afterBackCards > 2);

  console.log('\n' + (ok ? 'TAB_RESTART_TEST_PASS' : 'TAB_RESTART_TEST_FAIL'));
  process.exit(ok ? 0 : 1);
})();
