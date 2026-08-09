'use strict';

// #774 のアプリレベル検証 — タグの親子関係を問い合わせ時に適用する処理を、
// 注入したスタブではなく実際のレンダラーと実際の DB を通して駆動する
// （ロジック自体は単体テストスイートがカバーしている。ここが固定するのは
// 「配線」: ファセットの行 → 選択 → 葉 → 述語という連鎖と、有効集合が保存
// されるのではなく毎回の読み取りで導出されるという事実）。
//
//   シード: p0 レミリア / p1 レミリア / p2 東方 / p3 風景 / p4（タグなし）
//   辺: レミリア → 紅魔郷 → 東方（紅魔郷 は語彙としてのみ存在する）
//
//   検証すること:
//     1. 東方 の行は3を数える（p2 が直接名乗り、p0/p1 は紅魔郷 経由で届く）
//     2. 東方 を選ぶとその3枚のカードが残る — 親の葉が子の投稿にマッチする
//     3. 紅魔郷 は、どの投稿も直接それを持っていなくても自分の行を得る
//     4. 規則を削除すると、次の読み取りで有効集合が縮む（可逆性。listPosts
//        を通してその場で観測する）
//     5. #815: アプリが「動いている最中」に行われた編集が画面へ届く —
//        グリッドとファセットは再起動なしに追加/削除/分割へ追従する。上の
//        すべては起動前に辺をシードするか main を直接読むかのどちらかなので、
//        レンダラー自身が持つレコードのコピーは一度も試されていない。まさに
//        そこに #815 が隠れていた（tag_parents への書き込みは posts の行を
//        1件も動かさないので、list-posts-delta のベースラインは何も変わって
//        いないと報告していた）。
//
//   node scripts/test-app-tagparents.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tp-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', language: 'ja' }));

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==', 'base64');
const seeds = [{ tags: ['レミリア'] }, { tags: ['レミリア'] }, { tags: ['東方'] }, { tags: ['風景'] }, { tags: [] }];
const records: any[] = [];
seeds.forEach((s, i) => {
  const id = '170000000000' + i + '-tp' + i;
  fs.writeFileSync(path.join(saveFolder, id + '.jpg'), jpeg);
  records.push({
    captureId: id,
    image: id + '.jpg',
    url: 'https://x.com/u' + i + '/status/90' + i,
    platform: 'x',
    text: '本文' + i,
    displayName: '人' + i,
    screenName: 'u' + i,
    likes: 10 + i,
    capturedAt: '2026-04-0' + (i + 1) + 'T12:00:00Z',
    date: '2026-04-0' + (i + 1) + 'T10:00:00Z',
    media: [],
    tags: s.tags,
    hashtags: [],
  });
});
// 親の辺をシードするためにハンドルを開いたままにする: どの機能もレコード
// ライタ経由で tag_parents を書くことはなく、タグ管理ページ（#21）だけが
// それを書く唯一の UI — ここでそれを操作すると、この導出ではなくそのページを
// テストすることになってしまう。
const handle = seedLibrary(configDir, records, { close: false });
const { sqlite } = handle;
sqlite.prepare('INSERT INTO tags (name, kind, reading) VALUES (?, ?, ?)').run('紅魔郷', null, null);
const idOf = (name: string) => (sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }).id;
const remiliaId = idOf('レミリア');
const scarletId = idOf('紅魔郷');
const touhouId = idOf('東方');
const insEdge = sqlite.prepare('INSERT INTO tag_parents (tagId, parentTagId, isDisplay) VALUES (?, ?, ?)');
insEdge.run(remiliaId, scarletId, 0);
insEdge.run(scarletId, touhouId, 0);
sqlite.close();

const evalJs = evalSource(
  async ({ waitFor }, args) => {
    // 本体はシリアライズされるので、ここではこのファイルの何もクロージャとして
    // 捕まえられない — タグの id とシードした captureId は `args` 経由で届く。
    // ブリッジは `window` から取る。scripts/ には自前の preload の型定義が
    // 無いため。
    const hologram = (window as any).hologram;
    const cards = () => document.querySelectorAll('[data-slot="post-grid"] [data-slot="post-card"]').length;
    // test-app-facetcounts と同じフィルタバーの流儀（1回のポップオーバー
    // セッション、カテゴリ間は 戻る で移動 — smoke ウィンドウは退出アニメー
    // ションを絞る）。
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
    await waitFor('グリッドがシードした5件の投稿すべてを表示すること', () => cards() >= 5);
    const r: Record<string, any> = {};
    byText('button', 'フィルタ').click();
    await waitFor('フィルタメニューが開くこと', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
    byText(POP + ' [data-slot="command-item"]', 'タグ').click();
    await waitFor('タグエディタが語彙を一覧すること', () => edRows().length > 0);
    r.rows = edRows()
      .map((el) => {
        const n = el.querySelector('span.truncate');
        return n ? n.textContent : null;
      })
      .filter(Boolean);
    r.touhou = cntOf('東方'); // 3 — p2 が直接名乗り、p0/p1 は 紅魔郷 経由で届く
    r.scarlet = cntOf('紅魔郷'); // 2 — 直接持つものは無く、p0/p1 から示唆される
    r.remilia = cntOf('レミリア'); // 2
    r.scenery = cntOf('風景'); // 1
    // 「親」の行を選ぶと、子タグの付いた投稿が残らなければならない（これが
    // 全体の要点）。以下の葉の切り替えはどれもカード数を変えるので、新しい
    // 数を待つことは、クリック前の状態ではなく遷移そのものを観測することに
    // なる。
    mustRow('東方').click();
    await waitFor('グリッドが 東方 に届く投稿へ絞られること', () => cards() === 3);
    r.touhouCards = cards(); // 3 (p0,p1,p2)
    mustRow('東方').click();
    await waitFor('東方 の葉を外したら再びすべての投稿が表示されること', () => cards() === 5);
    r.backCards = cards(); // 5
    byText('button', 'フィルタ').click();
    // POP は [data-closed] を除外するので、閉じることがコミットされた瞬間に
    // ポップオーバーはマッチしなくなる — （絞られた）退出アニメーションを
    // 待つ必要はない。
    await waitFor('フィルタのポップオーバーが閉じること', () => !document.querySelector(POP));
    // 可逆性をその場で読む: 紅魔郷→東方 の辺を削除し、ライブラリを読み直す。
    // 何も保存されたことは無いので、次の SELECT だけでその変化が見えなければ
    // ならない。
    const edges = await hologram.getTagParentEdges();
    const scarletEdge = edges.find((e) => e.parentTagName === '東方' || e.parentTagId === args.touhouId);
    r.sawEdge = !!scarletEdge;
    const before = await hologram.listPosts();
    const effOf = (snap, tag) => (snap.posts || snap.records || snap).filter((p) => (p.effectiveTags || []).includes(tag)).length;
    r.effTouhouBefore = effOf(before, '東方'); // 3
    await hologram.removeTagParent(args.scarletId, args.touhouId);
    const after = await hologram.listPosts();
    r.effTouhouAfter = effOf(after, '東方'); // 1 — only the post that names it
    r.effScarletAfter = effOf(after, '紅魔郷'); // 2 — the レミリア→紅魔郷 edge survives

    // --- #815: 同じ編集を、main ではなく「画面」で判定する ---
    // 上の削除は、アプリがすでに動いている状態で起きた。これはどのテストも
    // カバーしていなかったケース: main は毎回の読み取りで再導出するので一度も
    // 間違っていなかった — 古くなっていたのは「レンダラー」が持つレコードの
    // 方で、tag_parents への書き込みは posts の行を動かさないので
    // list-posts-delta には気付けない。カード数はここでは誠実な証人:
    // ポップオーバーを必要としないので、開いた時に画面が作り直されたという
    // だけの理由で新しく見えることがない。
    const settle = async (label, want) => {
      await waitFor(label, () => cards() === want);
      return cards();
    };
    byText('button', 'フィルタ').click();
    await waitFor('フィルタメニューが再び開くこと', () => !!document.querySelector(POP + ' [data-slot="command-item"]'));
    byText(POP + ' [data-slot="command-item"]', 'タグ').click();
    await waitFor('タグエディタが再び語彙を一覧すること', () => edRows().length > 0);
    mustRow('東方').click(); // 葉 ON
    r.liveRemovedCards = await settle('グリッドが 東方 自身を名乗る投稿だけを保つこと', 1);
    await hologram.addTagParent(args.scarletId, args.touhouId, false);
    r.liveAddedCards = await settle('規則が戻ったらグリッドが子の投稿を取り戻すこと', 3);
    mustRow('東方').click(); // 葉 OFF
    await waitFor('東方 の行が再び子の投稿を数えること', () => cntOf('東方') === '3');
    r.liveTouhouCount = cntOf('東方'); // 3 — ファセット自身の数値も追従する

    // #777: 分割は「新しい」タグ実体を鋳造し、それも再起動なしにファセットへ
    // 届かなければならない。p0 は レミリア から離れ、紅魔郷 の下に表示される
    // 同名の実体へ移るので、「元の」レミリア の葉は2枚から1枚へ減り、隣に
    // 2つ目の行が現れる。
    mustRow('レミリア').click(); // 葉 ON
    r.liveSplitBefore = await settle('グリッドが2件の レミリア 投稿へ絞られること', 2);
    await hologram.splitTag(args.remiliaId, args.scarletId, [args.firstCaptureId]);
    r.liveSplitCards = await settle('分割で新しいタグへ移った投稿をグリッドが失うこと', 1);
    mustRow('レミリア').click(); // 葉 OFF — 語彙全体を読む
    await waitFor('分割で切り出されたタグが自分の行を得ること', () => !!rowEl('レミリア(紅魔郷)'));
    r.liveSplitRows = edRows()
      .map((el) => {
        const n = el.querySelector('span.truncate');
        return n ? n.textContent : null;
      })
      .filter(Boolean);
    return r;
  },
  { remiliaId, scarletId, touhouId, firstCaptureId: records[0].captureId },
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
  const counts = r.touhou === '3' && r.scarlet === '2' && r.remilia === '2' && r.scenery === '1';
  const picking = r.touhouCards === 3 && r.backCards === 5;
  const vocab = Array.isArray(r.rows) && r.rows.includes('紅魔郷');
  const reversible = r.sawEdge === true && r.effTouhouBefore === 3 && r.effTouhouAfter === 1 && r.effScarletAfter === 2;
  // #815: 起動後に行われた編集を、画面で判定する。
  const live = r.liveRemovedCards === 1 && r.liveAddedCards === 3 && r.liveTouhouCount === '3';
  const liveSplit = r.liveSplitBefore === 2 && r.liveSplitCards === 1 && Array.isArray(r.liveSplitRows) && r.liveSplitRows.includes('レミリア(紅魔郷)');
  const ok = counts && picking && vocab && reversible && live && liveSplit;
  console.log(`counts: 東方=${r.touhou} 紅魔郷=${r.scarlet} レミリア=${r.remilia} 風景=${r.scenery}`);
  console.log(`picking: parentCards=${r.touhouCards} back=${r.backCards}`);
  console.log(`vocab: rows=${JSON.stringify(r.rows)}`);
  console.log(`reversible: sawEdge=${r.sawEdge} before=${r.effTouhouBefore} after=${r.effTouhouAfter} scarletAfter=${r.effScarletAfter}`);
  console.log(`live edit: removed=${r.liveRemovedCards} added=${r.liveAddedCards} facet東方=${r.liveTouhouCount}`);
  console.log(`live split: before=${r.liveSplitBefore} after=${r.liveSplitCards} rows=${JSON.stringify(r.liveSplitRows)}`);
  console.log(ok ? 'TAGPARENTS_TEST_PASS' : 'TAGPARENTS_TEST_FAIL');
  process.exit(ok ? 0 : 1);
});
