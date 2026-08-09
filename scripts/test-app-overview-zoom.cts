'use strict';

// 隔離したインスタンスで俯瞰ズーム（#141）の挙動を検証する。Ctrl+ホイールが
// サイズ軸を1ノッチ動かすか、セルが下限まできちんと縮むか、落ち着いたら
// gridSize が確定・永続化されるか。下限では ×N バッジのような chrome が
// 引っ込む（サムネイルを覆わないように）。ズームがカーソル下の投稿を画面上で
// 同じ高さに保つかどうかも計測する（#282）。これは本物のアプリではなく、
// 別の設定を持つ独立した HOLOGRAM_SMOKE プロセスなので、利用者がメインの
// アプリを操作中でも衝突しない（docs/build.md）。test-app-tagtypes.cts と
// 同じハーネス。
//
//   node scripts/test-app-overview-zoom.cts

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const appDir = path.join(__dirname, '..', 'app');
const { electronPath: resolveElectron } = require('./lib-electron-path.cts');

const electronPath = resolveElectron();
const { seedLibrary } = require('./lib-seed-library.cts');
const { evalSource } = require('./lib-wait.cts');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-overview-zoom-'));
const configDir = path.join(tmp, 'Hologram');
const saveFolder = path.join(tmp, 'saves');
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(saveFolder, { recursive: true });
// 正方形サムネイル・情報非表示のグリッドで起動する（下限48まで数ノッチの
// 余裕がある位置から始まる）。「情報を表示」が ON だと下限は200pxになり、
// 俯瞰の下限そのものが計測できなくなる（#618）。
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ saveFolder, extensionId: 'x', layoutMode: 'grid', squareThumbs: true, showInfo: false, gridSize: 180 }));

const jpegB64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

// 列数のトラックは1ノッチ＝1列なので、サイズ軸そのものは件数に関わらず動作する。
// 大量の件数が要るのはアンカー保持（#282）の方 — 全部が1画面に収まってしまうと
// スクロール位置は一切動かず、位置が保たれたのか単に動く先が無かっただけなのか
// 見分けが付かない。180px タイルが数十行に及ぶだけの数を仕込む。
const records: any[] = [];
for (let i = 0; i < 200; i++) {
  const captureId = `171750000000${i}-abcd`;
  fs.writeFileSync(path.join(saveFolder, `${captureId}.jpg`), Buffer.from(jpegB64, 'base64'));
  records.push({
    captureId,
    image: `${captureId}.jpg`,
    url: `https://x.com/testuser/status/${i}`,
    platform: 'x',
    text: `俯瞰ズーム検証用のダミー投稿 ${i}`,
    displayName: 'てすと太郎',
    screenName: 'testuser',
    date: '2026-04-04T10:30:00Z',
    capturedAt: '2026-04-04T12:00:00Z',
  });
}
seedLibrary(configDir, records);

// グリッドの上でホイールイベントを発火する（ハンドラはスクロール面の内側しか
// 見ない）。window に直接発火すると target === window になり、スクロール
// 領域の外として無視されてしまう。
const evalJs = evalSource(async ({ waitFor, waitStable, neverHappens }) => {
  const grid = document.querySelector('[data-slot="post-grid"]');
  // オプショナルチェインではなく名前を付けて弾く: 以下の計測はすべてこの要素を
  // 読むので、グリッドが無い場合はその名前のまま実行を止めるべきで、値の検証が
  // 「セルが一度も縮まなかった」と誤読する NaN に化けさせてはいけない。
  if (!grid) throw new Error('投稿グリッドが見つからない');
  // サイズ軸は外からは「セルがどれだけ大きいか」としてしか観測できない
  // （CSS 変数へ書き込む経路は #618 で撤去された）— 実際に描画されたカードの
  // 幅を計測する。列は幅いっぱいに伸びるので、これは生の最小列幅ではなく
  // 「その設定で何列入るか」の結果を読むことになる。
  const size = () => {
    const c = grid.querySelector('[data-slot="post-card"]');
    return c ? Math.round(c.getBoundingClientRect().width) : Number.NaN;
  };
  const fire = (deltaY: number, x?: number, y?: number) => {
    const r = grid.getBoundingClientRect();
    grid.dispatchEvent(new WheelEvent('wheel', { deltaY, ctrlKey: true, clientX: x == null ? r.left + 20 : x, clientY: y == null ? r.top + 20 : y, bubbles: true, cancelable: true }));
  };

  // ここで、それを閉じ込める待ちより前に解決しておく — グリッドと同じ理屈:
  // スクロール面はアンカーの計測すべてが読む対象なので、それが無い場合は
  // その名前のまま実行を止めるべき。
  const scroller = document.querySelector('[data-slot="content-scroll"]');
  if (!scroller) throw new Error('コンテンツのスクロール面が見つからない');

  // --- アンカー保持（#282） ---
  // ズームの前後で、見ていた投稿は画面上の同じ高さに留まるか。位置合わせは
  // グリッド島が自身のレイアウトを読んで行うので、ここで計測するのはあくまで
  // 結果＝カードの画面上の上端だけ。
  //
  // 待ち方には注意がいる: 固定 sleep だと最初のレイアウトパスが終わる前に
  // 計測してしまい、まだコンテンツが短くスクロールが起きた状態（＝どのみち
  // 動く先が無かっただけ）を「ずれなかった」と誤読する。実際、固定 sleep 版は
  // 3回に2回この壊れ方をした。そこで代わりに状態そのものを待つ。
  //
  // スクロール位置が動かなくなるまで待つ（変更は rAF で適用され、150ms 後に
  // 確定し、その後さらに計測用の再レイアウト・落ち着きパスが続く）。
  const settle = () => waitStable('the scroll position to stop moving', () => Math.round(scroller.scrollTop), 3000);
  // 上の settle() の双子だが、scrollTop ではなくサイズ軸のためのもの — しかも
  // 単純な安定ポーリングと違い、「まだ値が動いていない」を「落ち着いた」と
  // 決して誤読してはならない。このハーネスが繰り返しはまっていた罠がこれ。
  //
  // ノッチの一群は、その150msのコミットが発火し、かつグリッドが新しい列幅で
  // 再描画される（grid-density-builder.ts の handleZoomWheel）まで見えるように
  // ならない。それより前のフレームは生きた列幅を運んでいるが、このハーネスの
  // ウィンドウは隠されているので何も描画せず、それらを適用するはずの rAF は
  // 走らない: 実測では、1ノッチ分の rAF はホイールから422ms後に発火し、一方
  // サイズは165msの時点でコミットの setTimeout を経由して動いていた
  // （フレームを経由してはいない）。したがって待つべきは150msに加えて描画
  // ウィンドウの完全な再レイアウトであり、混んだランナーではその再レイアウトは
  // タダではない。
  //
  // #618 以前はサイズを状態層が書く CSS 変数から読んでいたので、コミットだけ
  // 待てば済み、固定 ~300ms の sleep でまかなえていた。実カードの box を読む
  // ようにしたことで再描画が上乗せされ、それが夜間の Windows ランナーを
  // 崖から押し出した（7/30 グリーン、7/31 と 8/1 は同じ値でレッド）。その
  // sleep を安定性ポーリングに置き換えても解決しなかった。ポーリングは
  // 「まだ何も起きていない」時に「最速で」返ってしまうから。
  //
  // そこで: まずサイズがホイール前の値から「離れる」のを待ち、それから
  // 動きが止まるのを待つ。
  const settleFrom = async (label: string, from: number, ms: number) => {
    const moved = await waitFor(
      'セルサイズが ' + label + ' の後で ' + from + 'px から離れること',
      () => {
        const s = size();
        return Number.isFinite(s) && s !== from;
      },
      ms,
    );
    if (!moved) return from;
    await waitStable('セルサイズが ' + label + ' の後で動かなくなること', size, ms);
    return size();
  };
  // 逆の主張 — ノッチがサイズを「動かさない」こと — は settle では検証できない:
  // 「変わっていない」はまさに settle が最速で報告する内容なので、コミットを
  // 一度も生き延びずに通ってしまう。代わりに neverHappens が観測窓全体を
  // 保持し、サイズが離れた瞬間を報告する。
  const holdSize = (from: number, ms: number) =>
    neverHappens(
      'トラックがすでに端にある状態でセルサイズが動くこと',
      () => {
        const s = size();
        return Number.isFinite(s) && s !== from;
      },
      ms,
    );
  // 全コンテンツの高さが立ち上がるまで、つまり仮想グリッドが最初のレイアウト
  // パスを終えるまで待つ。
  const laidOut = await waitFor('仮想グリッドがフル長のスクロール高さを立ち上げること', () => scroller.scrollHeight > scroller.clientHeight * 4, 8000);
  scroller.scrollTop = 2000;
  const scrolled = await waitFor('スクロール位置が2000pxに着地すること', () => Math.abs(scroller.scrollTop - 2000) < 2, 3000);
  const sr = scroller.getBoundingClientRect();
  const seen = () => [...grid.querySelectorAll('[data-slot="post-card"]')].map((c): [Element, DOMRect] => [c, c.getBoundingClientRect()]).filter(([, box]) => box.bottom > sr.top && box.top < sr.bottom);
  // scrollTop を直接代入するのは「大ジャンプ」— 仮想グリッドが描画ウィンドウを
  // 再構築するまでは、前の位置のセルを持ったままになる。scrollTop 単体が
  // 落ち着いた直後に読むと、空の画面が見えることがある（#282 自身の本文で
  // 指摘された罠。実測で3回に2回踏んだ）ので、セルが実際に見えるようになる
  // まで待つ。
  const windowed = await waitFor('仮想グリッドが新しいスクロール位置で描画ウィンドウを再構築すること', () => seen().length > 0, 8000);
  await settle();
  // ベースラインはこのスクリプトの先頭ではなく「ここで」採る。カードの box が
  // サイズ軸を運ぶのは、仮想グリッドが本当にレイアウトを終えた後だけ。その
  // 最初のパスより前は幅数ピクセルしかなく、そこでベースラインを読むと、
  // 以降のすべての比較にグリッドが一度も持ったことのない数値を渡すことになる。
  // それが8/2にランナーが報告した内容で（start=2）、「セルが縮む」検証は51と2を
  // 比較して失敗し、ズーム自体はちゃんと動いていた（#818）。ローカル実行では
  // 最初の文が走る前にレイアウトが着地していたため一度も見えなかった。
  // ランナーが単に遅いだけであり、それは上の待ちがそもそも存在する理由と
  // 同じ。
  const sized = await waitFor(
    'サイズ軸を運ぶ実カードの box が現れること（ベースラインの計測）',
    () => {
      const s = size();
      return Number.isFinite(s) && s >= 48;
    },
    8000,
  );
  const start = size();
  const scrolledTo = Math.round(scroller.scrollTop);
  const midY = sr.top + sr.height / 2;
  // 画面に見えているカードのうち、ビューポート中央に最も近いものを対象にする。
  const visible = seen();
  visible.sort((a, b) => Math.abs(a[1].top + a[1].height / 2 - midY) - Math.abs(b[1].top + b[1].height / 2 - midY));
  const target = visible.length ? visible[0][0] : null;
  const r0 = visible.length ? visible[0][1] : null;
  // 「情報を表示」が OFF だとセルはテキストを持たないので、掴んだものは
  // 代わりに「表示中の画像」で識別する（セルはキー属性を持たない — #618）。
  // サムネイル幅はサイズ軸に応じて変わるので、URL のクエリを外してどのファイル
  // かだけを比較する。
  const srcOf = (c: Element | null) => {
    const el = c && c.querySelector('[data-slot="post-card-media"]');
    return el ? (el.getAttribute('src') || '').split('?')[0] : null;
  };
  const anchorKey = srcOf(target);
  // `target` と `r0` は同じ探索の2つの半分 — カードが見えていた時にちょうど
  // 両方がセットされるので、ここで両方をテストするのは同じ条件を tsc に
  // 見える形で書いているだけ。
  if (target && r0) fire(-120, r0.left + r0.width / 2, r0.top + r0.height / 2); // 1ノッチズームイン
  // 位置合わせはサイズを適用するそのコミットに乗っているので、スクロール位置を
  // 落ち着かせる前にサイズが実際に動くのを待つ — そうしないと、一群がまだ
  // 適用されていないうちに「動いた」を読んでしまう。
  if (target) await settleFrom('1ノッチズームイン', start, 8000);
  await settle();
  const moved = Math.round(scroller.scrollTop) !== scrolledTo; // 位置合わせが実際に効いたか
  const held = anchorKey ? [...grid.querySelectorAll('[data-slot="post-card"]')].find((c) => srcOf(c) === anchorKey) : null;
  const drift = held && r0 ? Math.round(held.getBoundingClientRect().top - r0.top) : 9999;
  const anchorReady = laidOut && scrolled && windowed && !!anchorKey;
  // 下の一連の操作に入る前に元のサイズへ戻す（start はすでに上で読んである）。
  const zoomed = size();
  fire(120);
  await settleFrom('開始サイズまでズームアウトして戻す', zoomed, 8000);
  await settle();

  // 下限までいっぱいに引く（トラックの端で止まる — それ以上ノッチを送っても
  // 何もしない）。ノッチは1フレームにまとめて適用されるので、同期的に読むと
  // 変更前の値を読んでしまう — 読む前に150msの落ち着きを待つ。
  const beforePull = size();
  for (let i = 0; i < 40; i++) fire(120);
  const small = await settleFrom('下限までいっぱいに引く', beforePull, 8000);
  // gridSize の永続化は、サイズが見えるようになるのとは「別の」後発イベント:
  // セルは生きた列幅の上で新しい幅に達するが、設定値が書き込まれるのは一群が
  // 落ち着いた時だけ。サイズが着地した直後に一度だけ読むと、遅いランナーでは
  // 引く前の値を読んでしまう。代わりに設定値が画面上のものに追いつくのを
  // 待つ（伸縮が丸め落とす1pxの範囲内で一致する）。
  let persistedSize = Number.NaN;
  // window.hologram は preload のブリッジ。scripts/ にはこれの宣言が無いので、
  // このハーネスがそれを読む唯一の場所で形を名指ししている。
  const prefs = () => (window as unknown as { hologram: { getPrefs(): Promise<{ gridSize: number }> } }).hologram.getPrefs();
  await waitFor(
    '永続化された gridSize が画面上のセルに追いつくこと',
    async () => {
      persistedSize = (await prefs()).gridSize;
      return Math.abs(persistedSize - small) <= 1;
    },
    8000,
  );
  // 端に張り付いた状態でさらに回してもサイズはもう動かない。「確定処理が
  // 走っていないこと」自体はここでは実際には検証できない — この規模
  // （200件）では確定処理はほぼタダで、DOM ノードの入れ替えもサムネイルの
  // 再要求も引き起こさないので、通っても無意味な主張になってしまう（両方の
  // 実装でグリーンになることを確認済み）。実ライブラリ規模での目視と計測が
  // ここでの拠り所。
  for (let i = 0; i < 10; i++) fire(120);
  // 1.5秒は、混んだランナーでも150msのコミットと再レイアウトを上回る長さなので、
  // 本当にサイズを動かしたノッチは、この観測窓の中に隠れることができない。
  const stableAtLimit = await holdSize(small, 1500);
  // ズームイン方向へ戻す（ズームインは deltaY<0）
  for (let i = 0; i < 3; i++) fire(-120);
  const back = await settleFrom('3ノッチズームインして戻す', small, 8000);
  return [start, small, persistedSize, back, stableAtLimit, anchorReady ? 1 : 0, drift, moved ? 1 : 0, sized ? 1 : 0].join(',');
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
  fs.rmSync(tmp, { recursive: true, force: true });
  const m = out.match(/EVAL_RESULT "([^"]*)"/);
  if (!m) {
    console.log('OVERVIEW_ZOOM_TEST_FAIL (no EVAL_RESULT)');
    process.exit(1);
  }
  const [start, small, persisted, back, stableAtLimit, anchored, drift, moved, sized] = m[1].split(',');
  const checks = [
    // 下の値の検証とは別立てにしてある: 「グリッドが一度もレイアウトしなかった」
    // と「グリッドが間違ったサイズでレイアウトした」は別の失敗であり、機能
    // そのものに関わるのは後者だけ。この行が無いと前者が後者の顔をして
    // 届いてしまう（#818）。
    ['開始サイズの採寸前提が整っている（グリッドの初回レイアウト完了）', sized === '1'],
    ['開始サイズは復元された180あたり', Number(start) >= 180],
    ['Ctrl+ホイール下でセルが縮む', Number(small) < Number(start)],
    ['下限は48（それ以下へ落ちない）', Number(small) >= 48],
    ['俯瞰サイズまで引ける（<96）', Number(small) < 96],
    ['停止後に gridSize が確定・永続化', Number(persisted) >= 48 && Number(persisted) < 96],
    ['端で回し続けてもサイズが動かない', stableAtLimit === 'true'],
    ['Ctrl+ホイール上でズームインして戻る', Number(back) > Number(small)],
    // #282: 掴んだ投稿が生き延び、画面上でほぼ同じ高さに留まる。8px はタイル間の
    // 隙間1つ分に相当し、「1行分丸ごとずれた」場合は必ず失敗させつつ、1〜2px の
    // 丸め誤差は通す広さ。
    ['アンカー計測の前提が整っている（レイアウト完了・スクロール成立・掴めた）', anchored === '1'],
    ['掴んだ投稿がズーム後も同じ高さに残る', Math.abs(Number(drift)) <= 8],
    ['位置合わせが実際にスクロールを動かしている', moved === '1'],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed++;
  }
  console.log(`values: start=${start} small=${small} persisted=${persisted} back=${back} drift=${drift} moved=${moved} sized=${sized}`);
  console.log(failed ? 'OVERVIEW_ZOOM_TEST_FAIL' : 'OVERVIEW_ZOOM_TEST_PASS');
  process.exit(failed ? 1 : 0);
});
