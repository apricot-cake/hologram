// シェルの上端の整列軸を、不変条件として書いたもの（#628）。
//
// なぜこのファイルが存在するか。ウィンドウ上部の2列のコントロールは揃って
// いなければならないが、コードの中にはそれを言うものが何も無かった:
// どのコントロールも自分のサイズと余白を勝手に宣言しており、そのどれか1つを
// 変えても何も失敗しなかった。実際、両方の列は6pxずれていた — ウィンドウの
// ボタンは帯の中心線より6px上に、サイドバートリガーはレールの中心より6px左に
// あった — そしてそれに気付くには、人がウィンドウを見るしかなかった。この
// ファイルは足りていなかった宣言そのもの: 軸は帯とサイドバーの列に属し、
// コントロールはそこへの参加者である。
//
// なぜ e2e/harness/cases/test-app-*.cts ではなくここか。幾何形状は固定されたビュー
// ポートと固定されたデバイススケール係数に対してだけ意味を持ち、lib/
// harness.ts こそがそれらを固定する場所（lib/viewport.ts によるレイアウト
// ブレークポイントの広い側のコンテンツボックス、--force-device-scale-
// factor=1、加えてテーマ/言語/タイムゾーン）。scripts/ 層は自前のデフォルト
// サイズで隠れて起動し、マシンの DPI を引き継ぐので、そこで同じ数値を測っても
// それはマシンの数値でしかない。
//
// 軸は2つ、あえてそれ以上増やさない。3つ目のずれが実際に見つかった時に3つ目を
// 足す価値が出る。どの軸も、意図した変更で失敗するテストでもあるので、実際に
// 起きた間違いの代償を払っている間だけ安上がりでいられる。
//
// 期待値は書き下ろすのではなく計測する。帯の中心は帯から、レールの中心は
// レールから取る。ここにリテラルで22と書いてしまうと、「今は帯の高さが
// 40pxになった」という事実が「コントロールがずれている」と読める失敗に化けて
// しまい、しかも帯の高さを2箇所に置くことになる。
import { expect, test } from '../lib/harness.ts';
import type { Page } from '@playwright/test';

interface Box {
  name: string;
  w: number;
  h: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

/** 計測対象のセレクタ1つを、失敗メッセージで使う名前と組にしたもの。 */
type Target = [name: string, selector: string, index?: number];

/**
 * `targets` のクライアント rect を整数ピクセルに丸めたもの — そうしないと、
 * 端数の帯の高さのせいで視覚的には正確な軸が失敗してしまう。一方、この
 * ファイルが扱っているずれ（6px）は丸めても無傷で生き残る。
 */
async function measure(page: Page, targets: Target[]): Promise<Box[]> {
  const boxes = await page.evaluate((list: Target[]) => {
    return list.map(([name, selector, index]) => {
      const el = document.querySelectorAll(selector)[index ?? 0];
      if (!el) return { name, w: -1, h: -1, left: -1, top: -1, right: -1, bottom: -1, cx: -1, cy: -1, missing: true };
      const r = el.getBoundingClientRect();
      const round = Math.round;
      return { name, w: round(r.width), h: round(r.height), left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom), cx: round(r.left + r.width / 2), cy: round(r.top + r.height / 2), missing: false };
    });
  }, targets);
  const missing = boxes.filter((b) => b.missing).map((b) => b.name);
  // 画面に無い参加者は、軸が壊れているのではなくテストが壊れている — 主張が
  // それを「閉じるボタンの中心が -1」に化けさせる前に、そう言っておく。
  if (missing.length) throw new Error(`採寸できない要素があります（セレクタが古い可能性）: ${missing.join(' / ')}`);
  return boxes;
}

/** 失敗ログの本体: この issue が書かれた元になったのと同じ表を、失敗した実行について出す。 */
function table(boxes: Box[]): string {
  const width = Math.max(...boxes.map((b) => [...b.name].length));
  return boxes.map((b) => `  ${b.name.padEnd(width)}  ${String(b.w).padStart(4)}×${String(b.h).padEnd(4)} @${b.left},${b.top}  中心=(${b.cx},${b.cy})  下端=${b.bottom}`).join('\n');
}

/**
 * このケースが soft failure を1件以上集めていたら計測表を出力する。ソフトな
 * assert のおかげで、1回の実行で軸から外れたすべての参加者を報告できる —
 * サイズを1つ変えると大抵は複数がまとめてずれるので、最初の1つで止まると
 * まるでコントロールが1つだけ迷子になったように読めてしまう。
 */
function dumpOnFailure(title: string, boxes: Box[]): void {
  if (!test.info().errors.length) return;
  console.log(`\n${title}\n${table(boxes)}\n`);
}

/** 帯のコントロールは、タブのモデルが読み込まれて初めて存在する。 */
async function bandReady(page: Page): Promise<void> {
  await page.locator('[data-slot="tab-strip"]').waitFor();
  await page.locator('[data-slot="tab-new"]').waitFor();
}

const BAND: Target = ['帯', '[data-slot="titlebar-band"]'];
// 帯のアイコンコントロール。所有者は3者: タブストリップが最初の1つを描き、
// シェルが2つ目を、アプリが描くキャプションストリップ（body へポータルされ、
// 帯の flex 行の完全に外にある）が最後の3つを描く。その散らばり方こそ、
// この軸を宣言する必要がある理由 — 単一のコンテナが5つ全部をレイアウトして
// いるわけではない。サイドバーの折りたたみトリガーはかつて最も左の参加者
// だったが、#981 が展開列と一緒にそれを撤去した。
const BAND_CONTROLS: Target[] = [
  ['新しいタブ', '[data-slot="tab-new"]'],
  ['詳細パネルのトグル', '[data-slot="inspector-toggle"]'],
  ['最小化', '[data-slot="window-control"]', 0],
  ['最大化', '[data-slot="window-control"]', 1],
  ['閉じる', '[data-slot="window-control"]', 2],
];

test('帯のアイコン軸: 上端の帯のアイコンコントロールは帯の中心 y を共有する', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await bandReady(page);

  const [viewport, band, ...controls] = await measure(page, [['ウィンドウ', 'html'], BAND, ...BAND_CONTROLS]);
  for (const c of controls) {
    expect.soft(c.cy, `帯のアイコン軸: 〈${c.name}〉の中心 y は帯の中心 y (${band.cy}) と一致すること`).toBe(band.cy);
  }
  // キャプションストリップは、帯の中で中央に揃うのではなく帯と同じ高さを
  // 持つことでこの軸に届いている唯一の参加者（Windows のキャプションボタンは
  // タイトルバーの全高を貫く）ので、その高さ自体が独立した主張になる —
  // 「中央だが低い」だと上の行は満たしてしまうが、閉じるボタンを狙って
  // 投げられる（右上の角に構える）性質は失われてしまう。
  const close = controls[controls.length - 1];
  expect.soft(close.h, `帯のアイコン軸: 〈閉じる〉は帯の高さいっぱい (${band.h}) であること`).toBe(band.h);
  expect.soft(close.top, '帯のアイコン軸: 〈閉じる〉は帯の上端に接していること').toBe(band.top);
  expect.soft(close.right, `帯のアイコン軸: 〈閉じる〉はウィンドウの右上隅 (x=${viewport.right}) に接していること`).toBe(viewport.right);

  dumpOnFailure('帯のアイコン軸 — 採寸', [viewport, band, ...controls]);
});

test('帯のアイコン軸: タブ本体は対象外＝帯の下端に接する別の軸に乗る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await bandReady(page);

  // 見落としではない: タブはあえて下端揃えにしてある（Chrome の解剖学 —
  // アクティブなタブはその下の面へつながっていなければならない）ので、
  // その中心は帯の中心より「下」にある。無言のまま放置せず主張しておくことで、
  // 「タブも中央に揃えよう」という変更は、黙って通るのではなくテストと
  // 議論しなければならなくなる。
  const [band, tab] = await measure(page, [BAND, ['タブ本体', '[data-slot="tab"]']]);
  expect.soft(tab.bottom, `タブ本体の軸: タブは帯の下端 (${band.bottom}) に接していること`).toBe(band.bottom);
  expect.soft(tab.cy, 'タブ本体の軸: タブの中心 y は帯の中心とは一致しない（下端揃えの別の軸）').not.toBe(band.cy);

  dumpOnFailure('タブ本体の軸 — 採寸', [band, tab]);
});

test('サイドバー列の軸: ナビ行が左端と幅を共有し、レールの中心 x に乗る', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await bandReady(page);

  // 今や計測対象は1つの形だけ（#981）— レール。軸そのものは変わっていない:
  // 各行は左端と幅を共有し、それがレール自身の中心線の上に乗せている。
  // 無くなったのは2つ目の計測（展開列）と、そもそもこの軸を宣言する価値が
  // あった理由となった参加者 — そこから6pxずれていた折りたたみトリガー。
  const navSelector = '[data-slot="sidebar"] [data-sidebar="menu-button"]';
  const count = await page.locator(navSelector).count();
  expect(count).toBeGreaterThan(1);
  const NAV: Target[] = Array.from({ length: count }, (_, i) => [`ナビ行[${i}]`, navSelector, i]);

  await expect(page.locator('[data-slot="sidebar"]')).toHaveAttribute('data-state', 'collapsed');
  const rail = await measure(page, [['レール', '[data-slot="sidebar"]'], ...NAV]);
  const [railBox, first, ...rest] = rail;
  for (const row of rest) {
    expect.soft(row.left, `サイドバー列の軸: 〈${row.name}〉の左端は〈${first.name}〉の左端 (${first.left}) と一致すること`).toBe(first.left);
    expect.soft(row.w, `サイドバー列の軸: 〈${row.name}〉の幅は〈${first.name}〉の幅 (${first.w}) と一致すること`).toBe(first.w);
  }
  for (const row of [first, ...rest]) {
    expect.soft(row.cx, `サイドバー列の軸: 〈${row.name}〉の中心 x はレールの中心 (${railBox.cx}) と一致すること`).toBe(railBox.cx);
  }
  dumpOnFailure('サイドバー列の軸 — 採寸', rail);
});
