// === デザイン実験トグル（隔離・後で消しやすいように1ファイル完結） =========
// グリッド背景 / ガラスサイドバー を手元のパネルで ON/OFF して現状とA/B比較する。
// 本体コードには触らず、body のクラスと注入CSSだけで効かせる。
// 撤去するときは: このファイルを削除 ＋ index.html の <script src="experiments.js"> を1行消すだけ。
(function () {
  'use strict';
  var LS = {
    grid: 'corpus.exp.gridBg',
    glass: 'corpus.exp.glassSidebar',
    collapsed: 'corpus.exp.panelCollapsed'
  };
  function get(k) { try { return localStorage.getItem(k) === '1'; } catch (e) { return false; } }
  function set(k, v) { try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* ignore */ } }

  // --- 注入CSS（style-src 'unsafe-inline' は許可されている） ---
  var css = [
    /* グリッド背景: appBody の地に方眼（控えめ）。線色は --text 混色でテーマ自動追従。
       被る要素（サイドバー/フライアウト）の中だけ別途濃いグリッドを敷いて、
       ガラスが濃いグリッドを透かしているように相対的に見せる（下記）。 */
    'body.exp-grid #appBody {',
    '  background-image:',
    '    linear-gradient(to right, color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px),',
    '    linear-gradient(to bottom, color-mix(in srgb, var(--text) 7%, transparent) 1px, transparent 1px);',
    '  background-size: 26px 26px;',
    /* fixed = viewport 原点にタイル固定。サイドバー/フライアウトの濃いグリッドも fixed に
       すると同じ位相に揃い、1枚の連続グリッドが被る要素だけ濃く見える（=地続き）。 */
    '  background-attachment: fixed;',
    '}',
    /* ガラスサイドバー: 自前の濃いグリッド(26%)を半透明フィル(--sidebar-bg 48%)の下に
       敷き、背後は #glassRefract で屈折させる。=「ガラスが濃いグリッドを透かしている」
       ように見える（被る要素だけ濃く＝相対的に透け感UP）。グローバル(7%)とは別物。
       多層背景は先頭が最前面なので [フィル, 縦線, 横線] の順。 */
    'body.exp-glass-sb #sidebar {',
    '  background-color: transparent;',
    '  background-image:',
    '    linear-gradient(color-mix(in srgb, var(--sidebar-bg) 48%, transparent), color-mix(in srgb, var(--sidebar-bg) 48%, transparent)),',
    '    linear-gradient(to right, color-mix(in srgb, var(--text) 26%, transparent) 1px, transparent 1px),',
    '    linear-gradient(to bottom, color-mix(in srgb, var(--text) 26%, transparent) 1px, transparent 1px);',
    '  background-size: auto, 26px 26px, 26px 26px;',
    '  background-attachment: fixed;',   /* 背景グリッドと同位相に揃える（地続き） */
    '  -webkit-backdrop-filter: url(#glassRefract) saturate(150%);',
    '  backdrop-filter: url(#glassRefract) saturate(150%);',
    '}',
    /* フライアウト/メニューも被る要素なので同様に濃いグリッドを敷く（グリッド背景ON時）。
       基底の --glass-bg 半透明フィルの下に濃いグリッド。backdrop の屈折は基底CSSのまま。 */
    'body.exp-grid .qf-popover, body.exp-grid .fold-menu {',
    '  background-color: transparent;',
    '  background-image:',
    '    linear-gradient(var(--glass-bg), var(--glass-bg)),',
    '    linear-gradient(to right, color-mix(in srgb, var(--text) 24%, transparent) 1px, transparent 1px),',
    '    linear-gradient(to bottom, color-mix(in srgb, var(--text) 24%, transparent) 1px, transparent 1px);',
    '  background-size: auto, 26px 26px, 26px 26px;',
    '  background-attachment: fixed;',   /* 背景グリッドと同位相に揃える（地続き） */
    '}',
    /* 実験パネル */
    '#expPanel {',
    /* bottom:72 keeps clear of #contentTop (back-to-top, right:24 bottom:24, ~36px) */
    '  position: fixed; bottom: 72px; right: 16px; z-index: 9999;',
    '  background: var(--surface, #fff); color: var(--text, #222);',
    '  border: 1px solid var(--border, #ccc); border-radius: 10px;',
    '  box-shadow: var(--shadow-md, 0 6px 20px rgba(0,0,0,.2));',
    '  font: 12px/1.3 system-ui, sans-serif; padding: 9px 11px; min-width: 158px;',
    '  display: flex; flex-direction: column; gap: 8px; user-select: none;',
    '}',
    '#expPanel .exp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; }',
    '#expPanel .exp-title { font-weight: 600; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted, #888); }',
    '#expPanel .exp-collapse { color: var(--text-muted, #888); font-size: 13px; line-height: 1; }',
    '#expPanel .exp-body { display: flex; flex-direction: column; gap: 7px; }',
    '#expPanel.collapsed .exp-body { display: none; }',
    '#expPanel label { display: flex; align-items: center; gap: 8px; cursor: pointer; }',
    '#expPanel input { cursor: pointer; margin: 0; }'
  ].join('\n');
  var style = document.createElement('style');
  style.id = 'expStyle';
  style.textContent = css;
  document.head.appendChild(style);

  // --- body クラスの適用 ---
  function apply() {
    document.body.classList.toggle('exp-grid', get(LS.grid));
    document.body.classList.toggle('exp-glass-sb', get(LS.glass));
  }
  apply();

  // --- パネル生成 ---
  function build() {
    if (document.getElementById('expPanel')) return;
    var p = document.createElement('div');
    p.id = 'expPanel';
    if (get(LS.collapsed)) p.classList.add('collapsed');
    p.innerHTML =
      '<div class="exp-head"><span class="exp-title">デザイン実験</span><span class="exp-collapse">' + (get(LS.collapsed) ? '＋' : '–') + '</span></div>' +
      '<div class="exp-body">' +
      '<label><input type="checkbox" id="expGrid"> グリッド背景</label>' +
      '<label><input type="checkbox" id="expGlass"> ガラスサイドバー</label>' +
      '</div>';
    document.body.appendChild(p);
    var cbGrid = p.querySelector('#expGrid');
    var cbGlass = p.querySelector('#expGlass');
    cbGrid.checked = get(LS.grid);
    cbGlass.checked = get(LS.glass);
    cbGrid.addEventListener('change', function () { set(LS.grid, cbGrid.checked); apply(); });
    cbGlass.addEventListener('change', function () { set(LS.glass, cbGlass.checked); apply(); });
    var head = p.querySelector('.exp-head');
    head.addEventListener('click', function () {
      var c = !p.classList.contains('collapsed');
      p.classList.toggle('collapsed', c);
      set(LS.collapsed, c);
      p.querySelector('.exp-collapse').textContent = c ? '＋' : '–';
    });
  }
  if (document.body) build();
  else document.addEventListener('DOMContentLoaded', build);
})();
