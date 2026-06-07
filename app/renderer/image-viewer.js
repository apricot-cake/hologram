// 画像閲覧モード (info-plus のタイル表示を移植・Corpus サイドカー対応・ライトシェル)。
// 投稿クリック保存はスクショ＋media[]原本、ドラッグ/移行はimage=原画。ここでは
// 「実際の絵」を見せたいので media[] の原本を優先し、無ければ image を使う。
// データは window.corpus.listPosts() / onPostsChanged 経由（post-view と独立ロード。
// 共有データ層への一本化は後の最適化）。eagle.* には一切依存しない。
//
// フィルタは post-view と同じ sb-section スタイル、グリッドは info+ のタイル＋ホバー
// アクション（詳細/元投稿/削除）＋右インスペクタ。タイルは psimg のサムネ(?w=480)で
// 描画してスクロールを軽く保つ（全画面ビューアのみ原寸）。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const imgUrl = (file) => 'psimg://img/' + encodeURIComponent(file);
  // Tiles request a downscaled thumbnail (main resizes + caches) so scrolling a
  // grid of full-resolution originals stays smooth. The fullscreen viewer uses
  // the full-res imgUrl. 480px is sharp up to the max tile size with one cache size.
  const thumbUrl = (file) => imgUrl(file) + '?w=480';

  let allPosts = [];
  let view = [];     // 現在表示中の (フィルタ+ソート済) レコード配列
  let inited = false;

  let vItems = [];   // 全画面ビューアで開いているレコードの画像URL配列
  let vIdx = 0;

  const state = { search: '', platform: '', sort: 'captured', minLikes: 0, multiOnly: false, tags: new Set() };
  let tagGroups = [];   // [{ id, name, tags:[] }] migrated from Eagle (tag-groups.json)

  // 画像閲覧に出す「実際の絵」のファイル名配列。
  //  - media[] の原本があれば常にそれ（投稿キャプチャの原寸画像・pixiv原寸など＝表示OK）。
  //  - media が無い場合に image を出すのは「絵そのもの」のときだけ（ドラッグ保存/Eagle移行の
  //    イラストレコード）。投稿キャプチャの image はスクショなので出さない。
  //    スクショは常に .jpg。ドラッグ/移行は source で明示判別、非JPEGなら確実に原画。
  const SCREENSHOT_EXT = /\.jpe?g$/i;
  function imageIsArtwork(p) {
    return p.source === 'drag' || p.source === 'eagle-migration' || (!!p.image && !SCREENSHOT_EXT.test(p.image));
  }
  function recordImageFiles(p) {
    if (Array.isArray(p.media) && p.media.length) {
      const files = p.media.filter((m) => m && m.file).map((m) => m.file);
      if (files.length) return files;
    }
    return (p.image && imageIsArtwork(p)) ? [p.image] : [];
  }
  // 全画面ビューア用の原寸 URL 配列。
  function recordImages(p) { return recordImageFiles(p).map(imgUrl); }

  function fmtNum(n) {
    if (n == null) return '';
    return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : String(n);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // いいねのパーセンタイル順 (info+ の likesPercentile)。プラットフォームごとに順位化し、
  // 「そのSNSの中で相対的に伸びた投稿」を上位に。実数だとXばかり上位に来る問題を緩和。
  function percentileFn(list) {
    const byPlat = {};
    list.forEach((p) => { const k = p.platform || ''; (byPlat[k] || (byPlat[k] = [])).push(p.likes || 0); });
    Object.values(byPlat).forEach((a) => a.sort((x, y) => x - y));
    return (p) => {
      const arr = byPlat[p.platform || ''] || [];
      if (arr.length <= 1) return 1;
      const v = p.likes || 0;
      let lo = 0, hi = arr.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m + 1; else hi = m; }
      return (lo - 1) / (arr.length - 1);
    };
  }

  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    let list = allPosts.filter((p) => recordImageFiles(p).length || p.video); // 描画できる画像、または動画(ポスター無しでも)
    if (state.platform) list = list.filter((p) => p.platform === state.platform);
    if (state.minLikes > 0) list = list.filter((p) => (p.likes || 0) >= state.minLikes);
    if (state.multiOnly) list = list.filter((p) => recordImageFiles(p).length > 1);
    if (state.tags.size) {
      list = list.filter((p) => {                          // AND: must have every selected tag
        const ts = new Set(p.tags || []);
        for (const t of state.tags) if (!ts.has(t)) return false;
        return true;
      });
    }
    if (q) {
      list = list.filter((p) =>
        (p.text || '').toLowerCase().includes(q) ||
        (p.title || '').toLowerCase().includes(q) ||
        (p.eagleName || '').toLowerCase().includes(q) ||
        (p.displayName || '').toLowerCase().includes(q) ||
        (p.screenName || '').toLowerCase().includes(q) ||
        (Array.isArray(p.hashtags) && p.hashtags.some((h) => String(h).toLowerCase().includes(q))) ||
        (Array.isArray(p.tags) && p.tags.some((t) => String(t).toLowerCase().includes(q)))
      );
    }
    if (state.sort === 'likes') list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    else if (state.sort === 'likesPct') { const pct = percentileFn(list); list.sort((a, b) => pct(b) - pct(a)); }
    else if (state.sort === 'date') list.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    else if (state.sort === 'updated') list.sort((a, b) => new Date(b.updatedAt || b.capturedAt || 0) - new Date(a.updatedAt || a.capturedAt || 0));
    else list.sort((a, b) => new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));
    return list;
  }

  // タグ絞り込み（Eagleのタグ）。タググループ単位で並べ、グループ外は「その他」。
  // 各タグに件数を出し、クリックで AND 絞り込み。データに1件も無いタグは隠す。
  function renderTagFilter() {
    const host = $('ivTagGroups');
    const section = $('ivTagSection');
    if (!host || !section) return;
    const counts = {};
    allPosts.forEach((p) => {
      if (!recordImageFiles(p).length) return;
      (Array.isArray(p.tags) ? p.tags : []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; });
    });
    const present = new Set(Object.keys(counts));
    if (!present.size) { section.style.display = 'none'; host.innerHTML = ''; return; }
    section.style.display = '';
    const chip = (t) => `<button class="sb-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)}<span class="iv-tagn">${counts[t]}</span></button>`;
    const grouped = new Set();
    let html = '';
    for (const g of tagGroups) {
      const tags = (g.tags || []).filter((t) => present.has(t));
      tags.forEach((t) => grouped.add(t));
      if (!tags.length) continue;
      html += `<div class="sb-subtitle">${escapeHtml(g.name)}</div><div class="sb-chips">${tags.map(chip).join('')}</div>`;
    }
    const other = [...present].filter((t) => !grouped.has(t)).sort((a, b) => counts[b] - counts[a]);
    if (other.length) html += `<div class="sb-subtitle">その他</div><div class="sb-chips">${other.map(chip).join('')}</div>`;
    host.innerHTML = html;
    host.querySelectorAll('.sb-chip').forEach((c) => c.classList.toggle('active', state.tags.has(c.dataset.tag)));
  }

  function render() {
    view = applyFilters();
    const grid = $('ivGrid');
    $('ivCount').textContent = view.length + ' 件';
    if (!view.length) { grid.innerHTML = ''; $('ivEmpty').style.display = 'block'; return; }
    $('ivEmpty').style.display = 'none';
    const frag = document.createDocumentFragment();
    view.forEach((p, i) => {
      const files = recordImageFiles(p);
      const badges = [`<span class="iv-badge ${escapeHtml(p.platform || '')}">${escapeHtml((p.platform || '').toUpperCase())}</span>`];
      if (files.length > 1) badges.push(`<span class="iv-badge count">×${files.length}</span>`);
      const author = p.displayName || p.screenName || p.title || '';
      const likes = p.likes != null ? `❤ ${fmtNum(p.likes)}` : '';
      const openBtn = p.url ? `<button class="iv-act" data-act="open" title="元投稿を開く">↗</button>` : '';
      const playOverlay = (p.mediaType === 'video' || p.mediaType === 'gif')
        ? `<div class="iv-play"><span>${p.mediaType === 'gif' ? 'GIF' : '▶'}</span></div>` : '';
      const card = document.createElement('div');
      card.className = 'iv-card';
      card.dataset.idx = String(i);
      // poster-less video (e.g. recovered orphan mp4): no thumbnail to show → placeholder tile.
      const thumb = files.length
        ? `<img src="${thumbUrl(files[0])}" alt="" loading="lazy" decoding="async">`
        : `<div class="iv-noposter"></div>`;
      card.innerHTML =
        thumb + playOverlay +
        `<div class="iv-badges">${badges.join('')}</div>` +
        `<div class="iv-actions">` +
          `<button class="iv-act" data-act="detail" title="詳細">ℹ</button>${openBtn}` +
          `<button class="iv-act del" data-act="del" title="削除">🗑</button>` +
        `</div>` +
        `<div class="iv-stats"><div class="iv-author">${escapeHtml(author)}</div>${likes ? `<div>${escapeHtml(likes)}</div>` : ''}</div>`;
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  // === inspector (選択タイルのメタデータ) ===
  function showInspector(p) {
    if (!p) return;
    const insp = $('ivInspector');
    const files = recordImageFiles(p);
    const row = (k, v) => (v != null && v !== '') ? `<div class="iv-insp-row"><span class="iv-insp-k">${k}</span><span class="iv-insp-v">${escapeHtml(v)}</span></div>` : '';
    const eng = [];
    if (p.likes != null) eng.push('❤ ' + fmtNum(p.likes));
    if (p.reposts != null) eng.push('🔁 ' + fmtNum(p.reposts));
    if (p.replies != null) eng.push('💬 ' + fmtNum(p.replies));
    if (p.bookmarks != null) eng.push('🔖 ' + fmtNum(p.bookmarks));
    if (p.views != null) eng.push('👁 ' + fmtNum(p.views));
    const tags = (Array.isArray(p.hashtags) ? p.hashtags : []).concat(Array.isArray(p.tags) ? p.tags : []);
    const tagsHtml = tags.length
      ? `<div class="iv-insp-row"><span class="iv-insp-k">タグ</span><span class="iv-insp-v"><div class="iv-insp-tags">${tags.map((t) => `<span class="iv-insp-tag">${escapeHtml(t)}</span>`).join('')}</div></span></div>`
      : '';
    const heading = p.title || p.text || '';
    insp.innerHTML =
      `<button class="iv-insp-close" id="ivInspClose" title="閉じる">×</button>` +
      (heading ? `<div class="iv-insp-title">${escapeHtml(heading)}</div>` : '') +
      `<img class="iv-insp-thumb" src="${thumbUrl(files[0])}" alt="">` +
      row('プラットフォーム', (p.platform || '').toUpperCase()) +
      row('作者', p.displayName || '') +
      row('ユーザー', p.screenName ? '@' + p.screenName : '') +
      row('反応', eng.join('   ')) +
      row('投稿日', p.date ? new Date(p.date).toLocaleString() : '') +
      row('保存日', p.capturedAt ? new Date(p.capturedAt).toLocaleString() : '') +
      row('更新日', p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '') +
      row('画像数', files.length > 1 ? files.length + ' 枚' : '') +
      tagsHtml +
      (p.url ? `<a class="iv-insp-open" id="ivInspOpen">元投稿を開く ↗</a>` : '');
    insp.hidden = false;
    const c = $('ivInspClose'); if (c) c.onclick = () => { insp.hidden = true; };
    const o = $('ivInspOpen'); if (o) o.onclick = () => window.corpus.openExternal(p.url);
  }

  async function doDelete(p) {
    if (!p || !p.image) return;
    if (!window.confirm('この画像を削除しますか？（取り消せません）')) return;
    try { await window.corpus.deletePost(p.image); } catch { /* ignore */ }
    const insp = $('ivInspector'); if (insp) insp.hidden = true;
    await refresh();
  }

  // === 全画面ビューア ===
  let vIsVideo = false;
  function openViewer(recIdx) {
    const p = view[recIdx];
    if (!p) return;
    if (p.video) { vItems = [imgUrl(p.video)]; vIsVideo = true; }   // 動画は原寸で再生
    else { vItems = recordImages(p); vIsVideo = false; }
    vIdx = 0;
    renderViewer();
    $('ivViewer').hidden = false;
  }
  function renderViewer() {
    const img = $('ivViewerImg'), vid = $('ivViewerVid');
    if (vIsVideo) {
      img.hidden = true; img.src = '';
      vid.hidden = false; vid.src = vItems[0] || ''; vid.play().catch(() => { /* autoplay may be blocked */ });
      $('ivViewerIndex').textContent = '';
      $('ivPrev').style.visibility = 'hidden'; $('ivNext').style.visibility = 'hidden';
      return;
    }
    vid.hidden = true; try { vid.pause(); } catch { /* ignore */ } vid.src = '';
    img.hidden = false;
    img.src = vItems[vIdx] || '';
    $('ivViewerIndex').textContent = vItems.length > 1 ? `${vIdx + 1} / ${vItems.length}` : '';
    const multi = vItems.length > 1;
    $('ivPrev').disabled = vIdx <= 0;
    $('ivNext').disabled = vIdx >= vItems.length - 1;
    $('ivPrev').style.visibility = multi ? '' : 'hidden';
    $('ivNext').style.visibility = multi ? '' : 'hidden';
  }
  function closeViewer() {
    $('ivViewer').hidden = true;
    $('ivViewerImg').src = '';
    const vid = $('ivViewerVid'); try { vid.pause(); } catch { /* ignore */ } vid.src = '';
  }
  function step(d) { if (vIsVideo) return; const n = vIdx + d; if (n >= 0 && n < vItems.length) { vIdx = n; renderViewer(); } }

  function resetFilters() {
    state.search = ''; state.platform = ''; state.sort = 'captured'; state.minLikes = 0; state.multiOnly = false;
    state.tags.clear();
    $('ivSearch').value = ''; $('ivSort').value = 'captured'; $('ivMinLikes').value = ''; $('ivMultiOnly').checked = false;
    $('ivPlatformChips').querySelectorAll('.sb-chip').forEach((c) => c.classList.remove('active'));
    $('ivTagGroups').querySelectorAll('.sb-chip').forEach((c) => c.classList.remove('active'));
    render();
  }

  function bind() {
    $('ivSearch').addEventListener('input', (e) => { state.search = e.target.value || ''; render(); });
    $('ivSort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
    $('ivMinLikes').addEventListener('input', (e) => { state.minLikes = parseInt(e.target.value, 10) || 0; render(); });
    $('ivMultiOnly').addEventListener('change', (e) => { state.multiOnly = e.target.checked; render(); });
    $('ivReset').addEventListener('click', resetFilters);

    // プラットフォームチップ: 単一選択 (同じものを再クリックで解除)。
    $('ivPlatformChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.sb-chip');
      if (!chip) return;
      const pf = chip.dataset.pf;
      const next = state.platform === pf ? '' : pf;
      state.platform = next;
      $('ivPlatformChips').querySelectorAll('.sb-chip').forEach((c) => c.classList.toggle('active', c.dataset.pf === next));
      render();
    });

    // タグチップ: 複数選択 (AND)。クリックでトグル。
    $('ivTagGroups').addEventListener('click', (e) => {
      const chip = e.target.closest('.sb-chip');
      if (!chip) return;
      const tag = chip.dataset.tag;
      if (state.tags.has(tag)) state.tags.delete(tag); else state.tags.add(tag);
      chip.classList.toggle('active', state.tags.has(tag));
      render();
    });

    const tile = $('ivTile');
    const applyTile = () => { $('mode-image').style.setProperty('--iv-tile', (tile.value || 180) + 'px'); };
    tile.addEventListener('input', applyTile);
    applyTile();

    $('ivGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.iv-card');
      if (!card) return;
      const idx = parseInt(card.dataset.idx, 10);
      const p = view[idx];
      const act = e.target.closest('.iv-act');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'open' && p && p.url) window.corpus.openExternal(p.url);
        else if (act.dataset.act === 'detail') showInspector(p);
        else if (act.dataset.act === 'del') doDelete(p);
        return;
      }
      openViewer(idx);
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

  async function loadTagGroups() {
    try { const r = await window.corpus.getTagGroups(); tagGroups = (r && r.groups) || []; }
    catch { tagGroups = []; }
  }

  async function init() {
    if (inited) return;
    inited = true;
    bind();
    if (window.corpus.onPostsChanged) window.corpus.onPostsChanged(() => { load().then(() => { render(); renderTagFilter(); }); });
    await Promise.all([load(), loadTagGroups()]);
    render();
    renderTagFilter();
  }

  async function refresh() { await load(); render(); renderTagFilter(); }

  window.corpusImageView = { init, refresh };
})();
