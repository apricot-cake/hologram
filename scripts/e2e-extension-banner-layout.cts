'use strict';

// The capture banner's LAYOUT CONTRACT, measured in a real engine (#158).
//
// Why this needs a browser at all: the banner is a shrink-to-fit flex pill, and
// every defect it can have is a computed-width defect. jsdom does no layout, so
// capture-overlay.test.ts can assert which buttons exist and what they say but
// never that they are side by side — the whole suite stayed green while the two
// choices were stacked in a column on screen.
//
// What broke, and why the check is phrased as it is: the pill used to be centred
// with `left: 50%` + `translateX(-50%)`. That centres the box visually, but
// layout still thinks it begins at the middle of the viewport, so a shrink-to-fit
// width can only grow from there to the right edge — half the viewport, no matter
// what `max-width` says. Content then wrapped inside a pill that looked like it
// had room to spare: the choice row stacked, and the opt-out under it wrapped
// too. So the two things worth pinning are (1) the row does not stack at a
// realistic window size, and (2) the pill can actually get wider than half the
// viewport, which is the property the old centring silently denied.
//
// Deliberately NOT loading the extension: what is under test is components.css's
// layout contract against the ask-state DOM, and mounting that DOM directly keeps
// the failure legible (a stacked row, not "the save flow ended up somewhere").
// The sheet and the tokens are the shipped files, read off disk — and the DOM is
// built to match status-surface.ts + duplicate-guard.ts. If those two drift, the
// jsdom suites are what notice; this one owns geometry.
//
//   node scripts/e2e-extension-banner-layout.cts

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const utils = path.join(__dirname, '..', 'extension', 'utils');
const CSS = fs.readFileSync(path.join(utils, 'tokens.generated.css'), 'utf8') + '\n' + fs.readFileSync(path.join(utils, 'components.css'), 'utf8');

// A window on the narrow side of ordinary. Wide enough that a pill holding one
// sentence and two buttons is not genuinely cramped — so a stacked row here is a
// layout defect and not an honest response to a small screen.
const VIEWPORT = { width: 960, height: 900 };

// The ask-state banner as it actually ships. Labels are the real strings (the
// longest of the trash notice's two forms) so the measurement is about the pill
// the user sees, not about a placeholder.
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

// __measure は上の PAGE がページ側に置くので、こちら（node 側）の window 型には
// 無い。evaluate に渡すコールバックはページで動くため、その中でだけ形を名乗る。
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
    // 現実的にありうる最長＝告知の文言に3択が付いた形。実際には同時に起きない組み
    // 合わせだが、ここが1行に収まるなら本物の2つは余裕を持って収まる。
    { name: '最長の組み合わせ（告知の文言＋3択）', label: TRASH_LABEL, choices: THREE },
  ];

  for (const c of cases) {
    const m: Measured = await page.evaluate(([l, ch]) => (window as unknown as MeasureWindow).__measure(l as string, ch as string[]), [c.label, c.choices] as [string, string[]]);
    const tops = m.buttons.map((b) => Math.round(b.top));
    const oneRow = new Set(tops).size === 1;
    check(oneRow, `${c.name}: 選択肢が1行に収まっていない（各ボタンの top=${tops.join(',')}）`);
    // 選択肢が縮められていない自己検査＝取り消しのチェックボックスの行が折り返して
    // いないこと。ボタンだけを見ると、行が縮んでもボタン自身は nowrap なので気付けない。
    check(m.optOut.h < 24, `${c.name}: 「今後この確認を出さない」が折り返している（h=${Math.round(m.optOut.h)}）＝選択肢の側が縮められている`);
    // 中央寄せは維持されているか（直し方を transform から margin へ替えたので）。
    const centred = Math.abs(m.surface.left - (m.viewport - m.surface.w) / 2) <= 1;
    check(centred, `${c.name}: 中央寄せが崩れている（left=${Math.round(m.surface.left)} w=${Math.round(m.surface.w)} viewport=${m.viewport}）`);
    console.log(`  ${c.name}: pill ${Math.round(m.surface.w)}x${Math.round(m.surface.h)} / ボタン ${m.buttons.length}個 ${oneRow ? '1行' : `${new Set(tops).size}行`}`);
  }

  // 半分の壁が無いこと＝旧 centring が黙って課していた上限。ここが 480 付近で
  // 止まるなら、`left: 50%` 方式へ戻っている。
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
