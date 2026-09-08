'use strict';

// #810 の投稿者側に対するアプリレベル検証 — 投稿者タグは「実体」として
// 読まれ、#774 の問い合わせ時の親適用がそこにも届く。単体テストスイートは
// 導出（db-write）と述語（query）をカバーしている。ここが固定するのは、
// 動いているアプリにしか存在しない「配線」: 投稿者ファセットの行 → 選択 →
// tagId を持つ葉 → 投稿者の述語 → グリッド。
//
//   シード: 投稿者 u0/u1/u2、それぞれ投稿1件
//   投稿者タグ: u0 = レミリア   u1 = 東方   u2 = （なし）
//   辺: レミリア → 東方
//
//   検証すること:
//     1. 東方 の行は2を数える（u1 が直接名乗り、u0 は レミリア 経由で届く）
//     2. 東方 を選ぶとその投稿者カード2枚が残る — #810 が閉じる非対称性
//        （それ以前は u1 しかマッチしなかった）
//     3. 規則を削除すると次の読み取りで有効集合が縮む（可逆性。
//        get-poster-tags を通してその場で観測する）
//
//   node e2e/harness/cases/test-app-postertagparents.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '../../../app');
const { electronPath: resolveElectron } = require('../../../scripts/lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('../../../scripts/lib-seed-library.cts');
const { evalSource } = require('../../../scripts/lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-ptp-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const records: any[] = [];
for (let i = 0; i < 3; i++) {
  const id = '170000000000' + i + '-ptp' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u' + i + '/status/80' + i,
    platform: 'x',
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: [],
    hashtags: [],
  });
}
// 投稿者タグと親の辺は、test-app-tagparents と同じ理由で DB へ直接シードする:
// それらを書く UI は別の機能であり、ここでそれを操作すると、この導出では
// なくそちらをテストすることになってしまう。posterKey は query.ts の
// userKey — プラットフォーム + プラットフォームのユーザー id が無い場合の
// @ハンドル。
const handle = seedLibrary(configDir, records, { close: false });
const { sqlite } = handle;
const insTag = sqlite.prepare('INSERT INTO tags (name) VALUES (?)');
insTag.run('レミリア');
insTag.run('東方');
const idOf = (name: string) => (sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }).id;
const remiliaId = idOf('レミリア');
const touhouId = idOf('東方');
const insPosterTag = sqlite.prepare('INSERT INTO poster_tags (posterKey, tagId) VALUES (?, ?)');
insPosterTag.run('x:@u0', remiliaId);
insPosterTag.run('x:@u1', touhouId);
sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, 0)').run(remiliaId, touhouId);
sqlite.close();

const evalJs = evalSource(
  async ({ waitFor }, args) => {
    // 本体はシリアライズされるので、ここではこのファイルの何もクロージャとして
    // 捕まえられない — タグの id は `args` 経由で届く。ブリッジは `window`
    // から取る。scripts/ には自前の preload の型定義が無いため。
    const hologram = (window as any).hologram;
    const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
    const posterCards = () => document.querySelectorAll('[data-slot="poster-grid"] [data-slot="poster-card"]').length;
    // test-app-facetcounts と同じフィルタバーの流儀（1回のポップオーバー
    // セッション。smoke ウィンドウは退出アニメーションを絞るので、完全な
    // アンマウントを待つことは決してしない）。
    const POP = '[data-slot="popover-content"]:not([data-closed])';
    const byText = (sel, text) => [...document.querySelectorAll(sel)].find((el) => (el.textContent || '').trim() === text) || null;
    const edRows = () => [...document.querySelectorAll<HTMLElement>(POP + ' div.cursor-default')];
    const rowEl = (name) =>
      edRows().find((el) => {
        const n = el.querySelector('span.truncate');
        return n && n.textContent === name;
      }) || null;
    // オプショナルチェインではなく名前を付けて弾く: 行そのものが各ステップの
    // 主題なので、無い場合は実行を止めてどの行かを言うべき。`?.` だとクリック
    // を飛ばしてしまい、次の主張が別の何かを報告することになる。
    const mustRow = (name) => {
      const el = rowEl(name);
      if (!el) throw new Error(name + ' の行がタグエディタに見つからない');
      return el;
    };
    const cntOf = (name) => {
      const r = rowEl(name);
      const c = r && r.querySelector('span.tabular-nums');
      return c ? c.textContent : null;
    };
    await waitFor('グリッドがシードした3件の投稿すべてを表示すること', () => cards() >= 3);
    const r: Record<string, any> = {};
    byText('button', '投稿者').click();
    await waitFor('投稿者ビューが3人の投稿者すべてを表示すること', () => posterCards() >= 3);
    byText('button', 'フィルタ').click();
    await waitFor('フィルタメニューが開くこと', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
    byText(POP + ' [data-slot="command-item"]', 'タグ').click();
    await waitFor('タグエディタが投稿者タグを一覧すること', () => edRows().length > 0);
    r.rows = edRows()
      .map((el) => {
        const n = el.querySelector('span.truncate');
        return n ? n.textContent : null;
      })
      .filter(Boolean);
    r.touhou = cntOf('東方'); // 2 — u1 が直接名乗り、u0 は レミリア 経由で届く
    r.remilia = cntOf('レミリア'); // 1
    // 「親」の行を選ぶと、投稿者は「子」だけでタグ付けされた状態で残らなければ
    // ならない。どちらの切り替えも投稿者数を変えるので、新しい数を待つことは
    // クリック前の状態ではなく遷移そのものを観測することになる。
    mustRow('東方').click();
    await waitFor('投稿者グリッドが 東方 に届く投稿者へ絞られること', () => posterCards() === 2);
    r.touhouCards = posterCards(); // 2 (u0, u1)
    mustRow('東方').click();
    await waitFor('東方 の葉を外したら投稿者グリッドが再びすべての投稿者を表示すること', () => posterCards() === 3);
    r.backCards = posterCards(); // 3
    byText('button', 'フィルタ').click();
    // POP は [data-closed] を除外するので、閉じることがコミットされた瞬間に
    // ポップオーバーはマッチしなくなる — （絞られた）退出アニメーションを
    // 待つ必要はない。
    await waitFor('フィルタのポップオーバーが閉じること', () => !document.querySelector(POP));
    // 可逆性をその場で読む: 投稿者には何も保存されていないので、辺を削除
    // すると次の読み取りが自分で変わらなければならない。
    const effOf = (snap, key, tag) => ((snap.tags[key] || {}).effectiveTags || []).includes(tag);
    r.effBefore = effOf(await hologram.getPosterTags(), 'x:@u0', '東方');
    await hologram.removeTagParent(args.remiliaId, args.touhouId);
    r.effAfter = effOf(await hologram.getPosterTags(), 'x:@u0', '東方');
    return r;
  },
  { remiliaId, touhouId },
);

const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: configDir, HOLOGRAM_SMOKE: '1', HOLOGRAM_SMOKE_EVAL: evalJs });
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
  const counts = r.touhou === '2' && r.remilia === '1';
  const picking = r.touhouCards === 2 && r.backCards === 3;
  const reversible = r.effBefore === true && r.effAfter === false;
  const ok = counts && picking && reversible;
  console.log(`counts: 東方=${r.touhou} レミリア=${r.remilia} rows=${JSON.stringify(r.rows)}`);
  console.log(`picking: parentCards=${r.touhouCards} back=${r.backCards}`);
  console.log(`reversible: before=${r.effBefore} after=${r.effAfter}`);
  console.log(ok ? 'POSTERTAGPARENTS_TEST_PASS' : 'POSTERTAGPARENTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
