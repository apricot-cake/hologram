// 画像閲覧モード (info-plus のタイル表示を移植・Corpus サイドカー対応)。
// 投稿クリック保存はスクショ＋media[]原本、ドラッグ/移行はimage=原画。ここでは
// 「実際の絵」を見せたいので media[] の原本を優先し、無ければ image を使う。
// データは window.corpus.listPosts() / onPostsChanged 経由（post-view と独立ロード。
// 共有データ層への一本化は後の最適化）。eagle.* には一切依存しない。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const imgUrl = (file) => 'psimg://img/' + encodeURIComponent(file);

  let allPosts = [];
  let view = [];     // 現在表示中の (フィルタ+ソート済) レコード配列
  let inited = false;

  let vItems = [];   // 全画面ビューアで開いているレコードの画像URL配列
  let vIdx = 0;

  // 実画像: 原本 media[] があれば優先、無ければ image (スクショ or 原画)。
  function recordImages(p) {
    if (Array.isArray(p.media) && p.media.length) {
      const files = p.media.filter((m) => m && m.file).map((m) => imgUrl(m.file));
      if (files.length) return files;
    }
    return p.image ? [imgUrl(p.image)] : [];
  }

  function fmtNum(n) {
    if (n == null) return '';
    return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(n);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function applyFilters() {
    const q = ($('ivSearch').value || '').trim().toLowerCase();
    const pf = $('ivPlatform').value;
    const sort = $('ivSort').value;
    let list = allPosts.filter((p) => recordImages(p).length); // 描画できる画像がある物だけ
    if (pf) list = list.filter((p) => p.platform === pf);
    if (q) {
      list = list.filter((p) =>
        (p.text || '').toLowerCase().includes(q) ||
        (p.title || '').toLowerCase().includes(q) ||
        (p.displayName || '').toLowerCase().includes(q) ||
        (p.screenName || '').toLowerCase().includes(q) ||
        (Array.isArray(p.hashtags) && p.hashtags.some((h) => String(h).toLowerCase().includes(q))) ||
        (Array.isArray(p.tags) && p.tags.some((t) => String(t).toLowerCase().includes(q)))
      );
    }
    if (sort === 'likes') list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else if (sort === 'date') list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    else list.sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));
    return list;
  }

  function render() {
    view = applyFilters();
    const grid = $('ivGrid');
    $('ivCount').textContent = view.length + ' 件';
    if (!view.length) { grid.innerHTML = ''; $('ivEmpty').style.display = 'block'; return; }
    $('ivEmpty').style.display = 'none';
    const frag = document.createDocumentFragment();
    view.forEach((p, i) => {
      const imgs = recordImages(p);
      const badges = [`<span class="iv-badge ${escapeHtml(p.platform || '')}">${escapeHtml((p.platform || '').toUpperCase())}</span>`];
      if (imgs.length > 1) badges.push(`<span class="iv-badge count">×${imgs.length}</span>`);
      const author = p.displayName || p.screenName || '';
      const likes = p.likes != null ? `❤ ${fmtNum(p.likes)}` : '';
      const card = document.createElement('div');
      card.className = 'iv-card';
      card.dataset.idx = String(i);
      card.innerHTML =
        `<img src="${imgs[0]}" alt="" loading="lazy">` +
        `<div class="iv-badges">${badges.join('')}</div>` +
        `<div class="iv-stats"><div class="iv-author">${escapeHtml(author)}</div>${likes ? `<div>${escapeHtml(likes)}</div>` : ''}</div>`;
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  function openViewer(recIdx) {
    const p = view[recIdx];
    if (!p) return;
    vItems = recordImages(p);
    vIdx = 0;
    renderViewer();
    $('ivViewer').hidden = false;
  }
  function renderViewer() {
    $('ivViewerImg').src = vItems[vIdx] || '';
    $('ivViewerIndex').textContent = vItems.length > 1 ? `${vIdx + 1} / ${vItems.length}` : '';
    const multi = vItems.length > 1;
    $('ivPrev').disabled = vIdx <= 0;
    $('ivNext').disabled = vIdx >= vItems.length - 1;
    $('ivPrev').style.visibility = multi ? '' : 'hidden';
    $('ivNext').style.visibility = multi ? '' : 'hidden';
  }
  function closeViewer() { $('ivViewer').hidden = true; $('ivViewerImg').src = ''; }
  function step(d) { const n = vIdx + d; if (n >= 0 && n < vItems.length) { vIdx = n; renderViewer(); } }

  function bind() {
    $('ivSearch').addEventListener('input', render);
    $('ivPlatform').addEventListener('change', render);
    $('ivSort').addEventListener('change', render);

    const tile = $('ivTile');
    const applyTile = () => { $('mode-image').style.setProperty('--iv-tile', (tile.value || 180) + 'px'); };
    tile.addEventListener('input', applyTile);
    applyTile();

    $('ivGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.iv-card');
      if (card) openViewer(parseInt(card.dataset.idx, 10));
    });
    $('ivPrev').addEventListener('click', () => step(-1));
    $('ivNext').addEventListener('click', () => step(1));
    $('ivViewer').addEventListener('click', (e) => { if (e.target === $('ivViewer') || e.target === $('ivViewerImg')) closeViewer(); });
    document.addEventListener('keydown', (e) => {
      if ($('ivViewer').hidden) return;
      if (e.key === 'Escape') closeViewer();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    });
  }

  async function load() {
    try { const res = await window.corpus.listPosts(); allPosts = (res && res.posts) || []; }
    catch { allPosts = []; }
  }

  async function init() {
    if (inited) return;
    inited = true;
    bind();
    if (window.corpus.onPostsChanged) window.corpus.onPostsChanged(() => { load().then(render); });
    await load();
    render();
  }

  async function refresh() { await load(); render(); }

  window.corpusImageView = { init, refresh };
})();
