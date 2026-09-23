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

const BAND: Target = ['タブ列', '[data-slot="tabs-band"]'];
const BAND_CONTROLS: Target[] = [
  ['戻る', 'button[aria-label="戻る"]'],
  ['進む', 'button[aria-label="進む"]'],
  ['新しいタブ', '[data-slot="tab-new"]'],
];

test('タブ列とページ操作を分け、タブ列の中心を揃える', async ({ launchHologram }) => {
  const { page } = await launchHologram();
  await bandReady(page);
  const [band, toolbar, tab, ...controls] = await measure(page, [BAND, ['ページ操作', '[data-slot="page-toolbar"]'], ['タブ', '[data-slot="tab"]'], ...BAND_CONTROLS]);
  expect(band.top).toBe(0);
  expect(toolbar.top).toBe(band.bottom);
  expect(tab.top).toBeGreaterThan(band.top);
  expect(tab.bottom).toBeLessThan(band.bottom);
  for (const control of [tab, ...controls]) expect.soft(control.cy).toBe(band.cy);
  expect(await page.locator('[data-slot="window-control"]').count()).toBe(0);
  await page.screenshot({ path: test.info().outputPath('shell.png') });
  dumpOnFailure('タブ列', [band, toolbar, tab, ...controls]);
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
