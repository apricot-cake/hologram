'use strict';

// captureバナーのレイアウト契約を、実際のエンジンで計測する（#158）。
//
// なぜこれにブラウザがそもそも必要か: バナーはshrink-to-fitのflexピルで、
// それが持ちうる不具合は全て計算幅の不具合。jsdomはレイアウトを一切しないので、
// capture-overlay.extension-bundle.test.tsはどのボタンが存在しどう書かれているかは検証できても、
// それらが横並びであることは決して検証できない＝2つの選択肢が画面上で縦に
// 積まれている間もスイート全体が緑のままだった。
//
// 何が壊れていたか、そしてなぜ検査がこう書かれているか: ピルは以前
// `left: 50%` + `translateX(-50%)`で中央寄せしていた。それは見た目上は箱を
// 中央に寄せるが、レイアウトはそれでもビューポートの真ん中から始まると考える
// ので、shrink-to-fitの幅はそこから右端までしか伸びられない＝`max-width`が
// 何を言おうとビューポートの半分。すると、余裕があるように見えるピルの中で
// コンテンツが折り返した: 選択肢の行は積み重なり、その下のオプトアウトも
// 折り返した。だから固定しておく価値があるのは (1) 現実的なウィンドウサイズで
// 行が積み重ならないこと、(2) ピルが実際にビューポートの半分より広くなれる
// こと＝これは古い中央寄せが黙って否定していた性質。
//
// 意図的に拡張機能を読み込まない: 検証対象はcomponents.cssのレイアウト契約が
// ask状態のDOMに対して持つものであり、そのDOMを直接マウントすることで失敗が
// 読みやすいまま保たれる（「保存フローがどこかへ行ってしまった」ではなく
// 「行が積み重なった」）。シートとトークンは出荷されるファイルそのもので、
// ディスクから読む＝そしてDOMはstatus-surface.ts + duplicate-guard.tsに合わせて
// 組み立てる。この2つがずれたら、それに気付くのはjsdomのスイートの役目。
// これは幾何を担当する。
//
//   node scripts/e2e-extension-banner-layout.cts

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const utils = path.join(__dirname, '..', 'extension', 'utils');
const CSS = fs.readFileSync(path.join(utils, 'tokens.generated.css'), 'utf8') + '\n' + fs.readFileSync(path.join(utils, 'components.css'), 'utf8');

// 普通の中でも狭めのウィンドウ。1文と2つのボタンを持つピルが本当に窮屈という
// わけではない広さ＝だからここで行が積み重なるのは、小さい画面への正直な対応
// ではなくレイアウトの不具合。
const VIEWPORT = { width: 960, height: 900 };

// 実際に出荷されるask状態のバナー。ラベルは実際の文字列（ゴミ箱通知の2つの形の
// うち長い方）で、計測がプレースホルダではなくユーザーが見るピルについての
// ものになるようにする。
const TRASH_LABEL = 'この投稿はゴミ箱にあります（2026/7/26 に削除）。Hologram で元に戻せます';
const DUP_LABEL = 'この投稿はもう保存されています';
const TWO = ['コピー', 'スキップ'];
const THREE = ['コピー', '置換', 'スキップ'];

const PAGE = `<!doctype html><meta charset="utf-8"><title>banner layout</title>
<div id="host"></div>
<script>
const root = document.getElementById('host').attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = ${JSON.stringify(CSS)};
root.appendChild(style);
window.__measure = (labelText, choiceNames) => {
  root.querySelectorAll('.surface').forEach((e) => e.remove());
  const s = document.createElement('div');
  s.className = 'surface';
  s.dataset.variant = 'banner';
  s.dataset.state = 'ask';
  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = '!';
  s.appendChild(badge);
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = labelText;
  s.appendChild(label);
  const choices = document.createElement('div');
  choices.className = 'choices';
  const row = document.createElement('div');
  row.className = 'choice-row';
  for (const name of choiceNames) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice';
    b.textContent = name;
    row.appendChild(b);
  }
  choices.appendChild(row);
  const optOut = document.createElement('label');
  optOut.className = 'opt-out';
  const box = document.createElement('input');
  box.type = 'checkbox';
  optOut.appendChild(box);
  const span = document.createElement('span');
  span.textContent = '今後この確認を出さない';
  optOut.appendChild(span);
  choices.appendChild(optOut);
  s.appendChild(choices);
  root.appendChild(s);
  const box2 = (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, left: r.left, top: r.top }; };
  const buttons = [...s.querySelectorAll('.choice')].map((b) => ({ text: b.textContent, ...box2(b) }));
  return { viewport: innerWidth, surface: box2(s), optOut: box2(s.querySelector('.opt-out')), buttons };
};
</script>`;

// __measureは上のPAGEによってページ側に置かれるので、この（node側の）window
// 型には存在しない。evaluateに渡すコールバックはページ上で動くので、その形は
// そちら側でだけ宣言する。
interface Box {
  w: number;
  h: number;
  left: number;
  top: number;
}
interface Measured {
  viewport: number;
  surface: Box;
  optOut: Box;
  buttons: Array<Box & { text: string }>;
}
type MeasureWindow = Window & { __measure: (label: string, choices: string[]) => Measured };

const failures: string[] = [];
function check(ok: boolean, message: string) {
  if (!ok) failures.push(message);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.setContent(PAGE);

  const cases: Array<{ name: string; label: string; choices: string[] }> = [
    { name: 'ゴミ箱の告知（2択・#158）', label: TRASH_LABEL, choices: TWO },
    { name: '重複の警告（3択・#34）', label: DUP_LABEL, choices: THREE },
    // 現実的な最悪ケース＝通知文に3択が付いた場合。この組み合わせは実際には
    // 同時に起きないが、これが1行に収まるなら、実際の2つのケースは余裕を
    // 持って収まる。
    { name: '最長の組み合わせ（告知の文言＋3択）', label: TRASH_LABEL, choices: THREE },
  ];

  for (const c of cases) {
    const m: Measured = await page.evaluate(([l, ch]) => (window as unknown as MeasureWindow).__measure(l as string, ch as string[]), [c.label, c.choices] as [string, string[]]);
    const tops = m.buttons.map((b) => Math.round(b.top));
    const oneRow = new Set(tops).size === 1;
    check(oneRow, `${c.name}: 選択肢が1行に収まっていない（各ボタンの top=${tops.join(',')}）`);
    // 選択肢が縮められていないことの自己チェック＝オプトアウトのチェック
    // ボックスの行が折り返していない。ボタンだけを見ていてはこれを捉えられ
    // ない。行が縮んでもボタン自体はnowrapのままだから。
    check(m.optOut.h < 24, `${c.name}: 「今後この確認を出さない」が折り返している（h=${Math.round(m.optOut.h)}）＝選択肢の側が縮められている`);
    // 中央寄せは依然として保たれているか（修正でtransformからmarginへ変えた
    // ため）？
    const centred = Math.abs(m.surface.left - (m.viewport - m.surface.w) / 2) <= 1;
    check(centred, `${c.name}: 中央寄せが崩れている（left=${Math.round(m.surface.left)} w=${Math.round(m.surface.w)} viewport=${m.viewport}）`);
    console.log(`  ${c.name}: pill ${Math.round(m.surface.w)}x${Math.round(m.surface.h)} / ボタン ${m.buttons.length}個 ${oneRow ? '1行' : `${new Set(tops).size}行`}`);
  }

  // ビューポート半分という天井が無い＝それは古い中央寄せが黙って課していた
  // 上限。もしこれが480あたりで頭打ちになるなら、`left: 50%`方式へ退行して
  // いる。
  const long: Measured = await page.evaluate(([l, ch]) => (window as unknown as MeasureWindow).__measure(l as string, ch as string[]), [DUP_LABEL + 'あ'.repeat(200), THREE] as [string, string[]]);
  const half = long.viewport / 2;
  check(long.surface.w > half + 1, `長い文言でも幅がビューポートの半分（${half}px）を超えられない（w=${Math.round(long.surface.w)}）＝shrink-to-fit の使える幅が left の位置から右端に限られている`);
  console.log(`  ビューポートの半分を超えられる: ${Math.round(long.surface.w)}px > ${half}px`);

  await browser.close();

  if (failures.length) {
    for (const f of failures) console.error(`FAIL ${f}`);
    console.log('BANNER_LAYOUT_FAIL');
    process.exit(1);
  }
  console.log('PASS e2e-extension-banner-layout: ask 状態の選択肢は1行・中央寄せ維持・幅の半分制限なし');
  process.exit(0);
})();
