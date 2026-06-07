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
  // 表示中のタイル一辺×DPR 相当の幅でサムネを要求する。原画→固定幅サムネをブラウザが
  // 小さいセルへ大幅縮小すると線画でエッジがジャギる主因になるため、main 側に best 品質で
  // 「表示サイズに近い解像度」へ縮小させる。60px刻みでキャッシュ種別を抑える。
  function thumbW() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    return Math.min(960, Math.max(180, Math.ceil((tileSize * dpr) / 60) * 60));
  }
  const thumbUrl = (file) => imgUrl(file) + '?w=' + thumbW();

  let allPosts = [];
  let view = [];     // 現在表示中の (フィルタ+ソート済) レコード配列
  let inited = false;

  let vItems = [];   // 全画面ビューアで開いているレコードの画像URL配列
  let vIdx = 0;

  const state = { search: '', platform: '', sort: 'captured', minLikes: 0, multiOnly: false, expandAll: false, tags: new Set(), tagMode: 'and', folder: '' };
  let tagGroups = [];   // [{ id, name, tags:[] }] migrated from Eagle (tag-groups.json)
  let ungrouped = new Set();    // 永続: グループ化しない投稿キー（ungrouped.json）
  let manualGroups = [];        // 永続: 手動グループ [[captureId,…],…]（manual-groups.json）
  // ユーザーフォルダ（作成/デフォルト/メンバーシップ）は共有モジュール window.corpusFolders が所有。
  // ここでは state.folder（絞り込み対象）だけローカルに持つ。
  const CF = () => window.corpusFolders;
  const TILE_MIN = 120, TILE_MAX = 400, TILE_STEP = 40;
  let tileSize = 180;           // 画像タイルの一辺px（−/＋ボタンで増減、prefに記憶）
  let selectMode = false;       // 選択モード（手動グループ化用）
  const selected = new Set();   // 選択中のグループキー
  let selectAnchor = null;      // Shift範囲選択の起点（view内インデックス）

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

  // 投稿の一意キー（同じ投稿の複数画像＝別レコードを1タイルにまとめるため）。
  // metadata.js parsePostUrl と同じURLパターンを踏襲（renderer 用の自前実装）。null=グループ化しない。
  function postKeyOf(url) {
    if (!url) return null;
    let u; try { u = new URL(url); } catch { return null; }
    const host = u.hostname, pa = u.pathname; let m;
    if (host === 'bsky.app' && (m = pa.match(/^\/profile\/([^/]+)\/post\/([^/?#]+)/))) return 'bluesky:' + m[1] + '/' + m[2];
    if ((host === 'x.com' || host === 'twitter.com') && (m = pa.match(/\/status\/(\d+)/))) return 'x:' + m[1];
    if ((m = pa.match(/^\/@[^/]+\/(\d[\w-]*)\/?$/))) return 'mastodon:' + host + ':' + m[1];
    if ((m = pa.match(/^\/notes\/([^/?#]+)/))) return 'misskey:' + host + ':' + m[1];
    if ((host === 'www.pixiv.net' || host === 'pixiv.net') && (m = pa.match(/^(?:\/[a-z]{2})?\/artworks\/(\d+)/))) return 'pixiv:' + m[1];
    return null;
  }

  // 同じ投稿(postKey)のレコードを1グループに集約。url無し/parse不可は各自単独グループ。
  // グループ内のページ順は captureId（≒保存順）でソート。返り値: [{ rep, records[], files[], isVideo }]
  function groupRecords(list) {
    const manualOf = new Map();   // captureId → 'manual:idx'（手動グループ優先）
    manualGroups.forEach((members, idx) => members.forEach((cid) => manualOf.set(cid, 'manual:' + idx)));
    const map = new Map(); const order = []; let solo = 0;
    for (const p of list) {
      let key;
      const mg = manualOf.get(p.captureId);
      if (mg && !state.expandAll) key = mg;                 // 手動グループ最優先
      else {
        const k = state.expandAll ? null : postKeyOf(p.url); // expandAll=全展開 / ungrouped=個別指定
        key = (k && !ungrouped.has(k)) ? k : ('__solo' + (solo++));
      }
      let g = map.get(key);
      if (!g) { g = { key, records: [] }; map.set(key, g); order.push(g); }
      g.records.push(p);
    }
    for (const g of order) {
      g.records.sort((a, b) => String(a.captureId || '').localeCompare(String(b.captureId || '')));
      g.rep = g.records[0];
      g.files = g.records.flatMap(recordImageFiles);
      g.isVideo = g.records.length === 1 && !!g.rep.video;
    }
    return order;
  }

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
    if (state.folder) { const f = CF() && CF().byId(state.folder); const set = new Set(f ? f.items : []); list = list.filter((p) => set.has(p.captureId)); }
    if (state.platform) list = list.filter((p) => p.platform === state.platform);
    if (state.minLikes > 0) list = list.filter((p) => (p.likes || 0) >= state.minLikes);
    if (state.tags.size) {
      list = list.filter((p) => {
        const ts = new Set(p.tags || []);
        if (state.tagMode === 'or') { for (const t of state.tags) if (ts.has(t)) return true; return false; }  // OR: any selected tag
        for (const t of state.tags) if (!ts.has(t)) return false; return true;                                 // AND: every selected tag
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
    let groups = groupRecords(applyFilters());          // 同一投稿の複数画像を1タイルに集約
    if (state.multiOnly) groups = groups.filter((g) => g.files.length > 1);
    view = groups;
    const grid = $('ivGrid');
    $('ivCount').textContent = view.length + ' 件';
    if (!view.length) { grid.innerHTML = ''; $('ivEmpty').style.display = 'block'; return; }
    $('ivEmpty').style.display = 'none';
    const frag = document.createDocumentFragment();
    view.forEach((g, i) => {
      const p = g.rep;
      // 画像モードではプラットフォーム表示は不要（ユーザー要望でタイルのバッジを撤去）。
      const ntag = g.files.length > 1 ? `<div class="iv-ntag">×${g.files.length}</div>` : '';
      const author = p.displayName || p.screenName || p.title || '';
      const likes = p.likes != null ? `❤ ${fmtNum(p.likes)}` : '';
      const openBtn = p.url ? `<button class="iv-act" data-act="open" title="元投稿を開く">↗</button>` : '';
      // 📁 = add this tile to the default folder in one click (hover → click). 'in' if already there.
      const hasDefault = !!(CF() && CF().defaultId());
      const inDefault = CF() && CF().inDefault(p.captureId);
      const foldBtn = `<button class="iv-act fold${inDefault ? ' in' : ''}" data-act="fold" title="${hasDefault ? 'デフォルトフォルダに追加/解除' : 'フォルダを作成して追加'}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>`;
      const playOverlay = (g.isVideo || p.mediaType === 'gif')
        ? `<div class="iv-play"><span>${g.isVideo ? '▶' : 'GIF'}</span></div>` : '';
      const card = document.createElement('div');
      card.className = 'iv-card' + (selected.has(g.key) ? ' selected' : '');
      card.dataset.idx = String(i);
      // poster-less video (recovered orphan mp4): no thumbnail to show → placeholder tile.
      const thumb = g.files.length
        ? `<img src="${thumbUrl(g.files[0])}" alt="" loading="lazy" decoding="async">`
        : `<div class="iv-noposter"></div>`;
      card.innerHTML =
        thumb + playOverlay + ntag +
        `<div class="iv-actions">` +
          `${foldBtn}<button class="iv-act" data-act="detail" title="詳細">ℹ</button>${openBtn}` +
          `<button class="iv-act del" data-act="del" title="削除">🗑</button>` +
        `</div>` +
        `<div class="iv-stats"><div class="iv-author">${escapeHtml(author)}</div>${likes ? `<div>${escapeHtml(likes)}</div>` : ''}</div>` +
        `<div class="iv-selcircle" title="選択"></div>`;
      frag.appendChild(card);
    });
    grid.innerHTML = '';
    grid.appendChild(frag);
  }

  // === detail popup (ℹボタン → 中央モーダル。サイドバーでも新規ウィンドウでもない) ===
  function closeDetail() { $('ivDetail').hidden = true; $('ivDetailBox').innerHTML = ''; }
  function showDetail(g) {
    if (!g) return;
    const p = g.rep;
    const box = $('ivDetailBox');
    const files = g.files;
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
    // このタイルの投稿に「まとめられる別レコード」が存在するか（グループ化解除/再開ボタンの可否）
    const gkey = postKeyOf(p.url);
    const potential = gkey ? allPosts.filter((q) => postKeyOf(q.url) === gkey).length : 0;
    const isManual = !!(g.key && g.key.indexOf('manual:') === 0);
    const groupBtn = isManual
      ? `<a class="iv-insp-open" id="ivUngroupManual">🔗 グループ解除（手動グループ）</a>`
      : (potential > 1
        ? (ungrouped.has(gkey)
          ? `<a class="iv-insp-open" id="ivRegroup">🔗 この投稿をまとめる（再グループ化）</a>`
          : `<a class="iv-insp-open" id="ivUngroup">✂ この投稿のグループ化を解除（個別表示）</a>`)
        : '');
    box.innerHTML =
      `<button class="iv-insp-close" id="ivInspClose" title="閉じる">×</button>` +
      (heading ? `<div class="iv-insp-title">${escapeHtml(heading)}</div>` : '') +
      (files.length ? `<img class="iv-insp-thumb" src="${thumbUrl(files[0])}" alt="">` : '') +
      row('プラットフォーム', (p.platform || '').toUpperCase()) +
      row('作者', p.displayName || '') +
      row('ユーザー', p.screenName ? '@' + p.screenName : '') +
      row('反応', eng.join('   ')) +
      row('投稿日', p.date ? new Date(p.date).toLocaleString() : '') +
      row('保存日', p.capturedAt ? new Date(p.capturedAt).toLocaleString() : '') +
      row('更新日', p.updatedAt ? new Date(p.updatedAt).toLocaleString() : '') +
      row('画像数', files.length > 1 ? files.length + ' 枚' : '') +
      tagsHtml +
      (p.url ? `<a class="iv-insp-open" id="ivInspOpen">元投稿を開く ↗</a>` : '') +
      groupBtn;
    $('ivDetail').hidden = false;
    const c = $('ivInspClose'); if (c) c.onclick = closeDetail;
    const o = $('ivInspOpen'); if (o) o.onclick = () => window.corpus.openExternal(p.url);
    const ug = $('ivUngroup'); if (ug) ug.onclick = () => setGroupKey(gkey, true);
    const rg = $('ivRegroup'); if (rg) rg.onclick = () => setGroupKey(gkey, false);
    const um = $('ivUngroupManual'); if (um) um.onclick = () => ungroupManual(parseInt(g.key.split(':')[1], 10));
  }

  // 投稿キーのグループ化解除/再開（永続）。
  function setGroupKey(key, ungroup) {
    if (!key) return;
    if (ungroup) ungrouped.add(key); else ungrouped.delete(key);
    if (window.corpus.setUngrouped) window.corpus.setUngrouped([...ungrouped]).catch(() => { /* best-effort */ });
    closeDetail();
    render();
  }

  // === 手動グループ化（選択モードで任意の画像をまとめる） ===
  function persistManual() { if (window.corpus.setManualGroups) window.corpus.setManualGroups(manualGroups).catch(() => { /* best-effort */ }); }

  // === ユーザーフォルダ（共有モジュール corpusFolders 経由。タグとは別の明示的なコンテナ） ===
  // サイドバーのフォルダチップ（件数つき・★=デフォルト・クリックで単一フィルタ）。
  function renderFolderFilter() {
    const host = $('ivFolderChips'); if (!host) return;
    const cf = CF(); const list = cf ? cf.all() : [];
    const existing = new Set(allPosts.filter((p) => recordImageFiles(p).length || p.video).map((p) => p.captureId));
    if (!list.length) { host.innerHTML = '<span class="iv-folder-empty">なし</span>'; return; }
    host.innerHTML = list.map((f) => {
      const n = f.items.filter((c) => existing.has(c)).length;
      return `<button class="sb-chip${state.folder === f.id ? ' active' : ''}" data-fid="${escapeHtml(f.id)}">${escapeHtml(f.name)}<span class="iv-tagn">${n}</span></button>`;
    }).join('');
  }
  // タイルの 📁 ワンクリック: デフォルトフォルダへ追加/解除（グループ全レコードに適用）。
  function toggleFolder(g, btn) {
    if (!g || !CF()) return;
    const ids = g.records.map((r) => r.captureId);
    const res = CF().toggleDefault(ids, g.rep.captureId);   // persists + toast + notify; null=デフォ未設定→管理を開く
    if (!res) return;
    if (btn) {                                              // 即時の見た目反映（フルrender無し＝ホバーが外れない）
      btn.classList.toggle('in', res === 'added');
      if (res === 'added') { btn.classList.add('added'); setTimeout(() => btn.classList.remove('added'), 500); }
    }
    // このフォルダで絞り込み中に解除したら、そのタイル1枚だけ取り除く（全再描画しない）。
    // view[] からも除去して残りカードの data-idx を振り直す（後続クリックのindexズレ防止）。
    if (res === 'removed' && state.folder === CF().defaultId() && btn) {
      const card = btn.closest('.iv-card');
      if (card) {
        const ri = parseInt(card.dataset.idx, 10);
        card.remove();
        if (ri >= 0 && ri < view.length) view.splice(ri, 1);
        $('ivGrid').querySelectorAll('.iv-card').forEach((c, i) => { c.dataset.idx = String(i); });
        $('ivCount').textContent = view.length + ' 件';
      }
    }
  }
  function updateSelBar() {
    $('ivSelCount').textContent = selected.size + ' 件選択';
    $('ivGroupBtn').disabled = selected.size < 2;
  }
  function clearSelectClasses() { $('ivGrid').querySelectorAll('.iv-card.selected').forEach((c) => c.classList.remove('selected')); }
  function setSelectMode(on) {
    selectMode = on;
    $('ivGrid').classList.toggle('selecting', on);   // CSS: show every ○ while selecting
    $('ivSelectBtn').textContent = on ? '選択終了' : '選択';
    $('ivSelectBtn').classList.toggle('active', on);
    ['ivSelCount', 'ivGroupBtn', 'ivSelClear'].forEach((id) => { $(id).hidden = !on; });
    if (!on) { selected.clear(); selectAnchor = null; clearSelectClasses(); }
    updateSelBar();
  }
  function toggleSelect(g, card) {
    if (selected.has(g.key)) { selected.delete(g.key); card.classList.remove('selected'); }
    else { selected.add(g.key); card.classList.add('selected'); }
    updateSelBar();
    if (selectMode && selected.size === 0) setSelectMode(false);   // 全解除したら選択モードを抜ける
  }
  // クリック=トグル＋起点更新 / Shift+クリック=起点〜現在を範囲選択（ctrl不要）
  function selectAt(idx, g, card, shift) {
    if (shift && selectAnchor != null) {
      const lo = Math.min(selectAnchor, idx), hi = Math.max(selectAnchor, idx);
      for (let i = lo; i <= hi; i++) {
        const gi = view[i]; if (!gi) continue;
        selected.add(gi.key);
        const c = $('ivGrid').querySelector('.iv-card[data-idx="' + i + '"]');
        if (c) c.classList.add('selected');
      }
      updateSelBar();
    } else {
      toggleSelect(g, card);
      selectAnchor = idx;
    }
  }
  function groupSelected() {
    if (selected.size < 2) return;
    const members = [];
    view.forEach((g) => { if (selected.has(g.key)) g.records.forEach((r) => members.push(r.captureId)); });
    if (members.length < 2) return;
    // 対象 captureId を既存の手動グループから外してから新グループを追加（重複所属を防止）
    manualGroups = manualGroups.map((grp) => grp.filter((c) => !members.includes(c))).filter((grp) => grp.length > 1);
    manualGroups.push(members);
    persistManual();
    setSelectMode(false);
    render();   // 集約後のグリッドを再描画
  }
  function ungroupManual(idx) {
    if (!(idx >= 0 && idx < manualGroups.length)) return;
    manualGroups.splice(idx, 1);
    persistManual();
    closeDetail();
    render();
  }

  async function doDelete(g) {
    const records = g && g.records ? g.records : (g ? [g] : []);   // group → all its records
    if (!records.length) return;
    const n = records.length;
    const msg = n > 1 ? `この投稿（${n}枚）を削除しますか？（取り消せません）` : 'この画像を削除しますか？（取り消せません）';
    if (!window.confirm(msg)) return;
    for (const r of records) {
      const target = r.image || r.video;           // poster-less videos have no image; delete by video
      if (target) { try { await window.corpus.deletePost(target); } catch { /* ignore */ } }
    }
    closeDetail();
    await refresh();
  }

  // === 全画面ビューア ===
  let vIsVideo = false;
  function openViewer(idx) {
    const g = view[idx];
    if (!g) return;
    if (g.isVideo) { vItems = [imgUrl(g.rep.video)]; vIsVideo = true; }   // 単独動画は原寸で再生
    else { vItems = g.files.map(imgUrl); vIsVideo = false; }              // グループの全ページを順送り
    vIdx = 0;
    renderViewer();
    $('ivViewer').hidden = false;
  }
  function renderViewer() {
    const img = $('ivViewerImg'), vid = $('ivViewerVid');
    if (vIsVideo) {
      img.hidden = true; img.src = '';
      vid.hidden = false; vid.muted = true; vid.src = vItems[0] || ''; vid.play().catch(() => { /* autoplay may be blocked */ });
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
    state.search = ''; state.platform = ''; state.sort = 'captured'; state.minLikes = 0; state.multiOnly = false; state.expandAll = false;
    state.tags.clear(); state.folder = ''; state.tagMode = 'and';
    $('ivSearch').value = ''; $('ivSort').value = 'captured'; $('ivMinLikes').value = ''; $('ivMultiOnly').checked = false; $('ivExpandAll').checked = false;
    $('ivTagMode').textContent = 'すべて含む'; $('ivTagMode').classList.remove('or');
    $('ivPlatformChips').querySelectorAll('.sb-chip').forEach((c) => c.classList.remove('active'));
    $('ivTagGroups').querySelectorAll('.sb-chip').forEach((c) => c.classList.remove('active'));
    renderFolderFilter();
    render();
  }

  function bind() {
    $('ivSearch').addEventListener('input', (e) => { state.search = e.target.value || ''; render(); });
    $('ivSort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
    $('ivMinLikes').addEventListener('input', (e) => { state.minLikes = parseInt(e.target.value, 10) || 0; render(); });
    $('ivMultiOnly').addEventListener('change', (e) => { state.multiOnly = e.target.checked; render(); });
    $('ivExpandAll').addEventListener('change', (e) => { state.expandAll = e.target.checked; render(); });
    $('ivReset').addEventListener('click', resetFilters);
    $('ivSelectBtn').addEventListener('click', () => setSelectMode(!selectMode));
    $('ivGroupBtn').addEventListener('click', groupSelected);
    $('ivSelClear').addEventListener('click', () => setSelectMode(false));   // 全クリア=選択モード終了

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

    // タグチップ: 複数選択。クリックでトグル。結合(AND/OR)は ivTagMode で切替。
    $('ivTagGroups').addEventListener('click', (e) => {
      const chip = e.target.closest('.sb-chip');
      if (!chip) return;
      const tag = chip.dataset.tag;
      if (state.tags.has(tag)) state.tags.delete(tag); else state.tags.add(tag);
      chip.classList.toggle('active', state.tags.has(tag));
      render();
    });
    $('ivTagMode').addEventListener('click', () => {
      state.tagMode = state.tagMode === 'and' ? 'or' : 'and';
      $('ivTagMode').textContent = state.tagMode === 'and' ? 'すべて含む' : 'いずれか';
      $('ivTagMode').classList.toggle('or', state.tagMode === 'or');
      render();
    });

    // フォルダチップ: 単一選択フィルタ（同じものを再クリックで解除）。
    $('ivFolderChips').addEventListener('click', (e) => {
      const chip = e.target.closest('.sb-chip');
      if (!chip) return;
      const fid = chip.dataset.fid;
      state.folder = state.folder === fid ? '' : fid;
      renderFolderFilter();
      render();
    });
    // 作成/改名/削除/デフォルト設定は共有モジュールの管理モーダルが担当。
    $('ivFolderManage').addEventListener('click', () => { if (CF()) CF().openManager(); });

    const applyTile = () => {
      tileSize = Math.max(TILE_MIN, Math.min(TILE_MAX, tileSize));
      $('mode-image').style.setProperty('--iv-tile', tileSize + 'px');
      $('ivTileVal').textContent = String(tileSize);
      $('ivTileMinus').disabled = tileSize <= TILE_MIN;
      $('ivTilePlus').disabled = tileSize >= TILE_MAX;
    };
    const stepTile = (d) => {
      tileSize += d; applyTile(); render();   // re-render so tiles re-request a thumb at the new display size (sharper, less aliasing)
      if (window.corpus.setPref) window.corpus.setPref('imageTileSize', tileSize).catch(() => { /* best-effort */ });
    };
    $('ivTileMinus').addEventListener('click', () => stepTile(-TILE_STEP));
    $('ivTilePlus').addEventListener('click', () => stepTile(TILE_STEP));
    applyTile();

    $('ivGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.iv-card');
      if (!card) return;
      const idx = parseInt(card.dataset.idx, 10);
      const g = view[idx];
      const act = e.target.closest('.iv-act');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'open' && g && g.rep.url) window.corpus.openExternal(g.rep.url);
        else if (act.dataset.act === 'detail') showDetail(g);
        else if (act.dataset.act === 'del') doDelete(g);
        else if (act.dataset.act === 'fold') toggleFolder(g, act);
        return;
      }
      // 右下の〇: 押すと選択モードに入る。既に選択モード中はトグル/Shift範囲選択
      if (e.target.closest('.iv-selcircle')) {
        e.stopPropagation();
        if (!selectMode) setSelectMode(true);
        selectAt(idx, g, card, e.shiftKey);
        return;
      }
      if (selectMode) { selectAt(idx, g, card, e.shiftKey); return; }   // 選択モード中はクリックで選択/Shift範囲選択
      openViewer(idx);
    });
    $('ivPrev').addEventListener('click', () => step(-1));
    $('ivNext').addEventListener('click', () => step(1));
    $('ivViewer').addEventListener('click', (e) => { if (e.target === $('ivViewer') || e.target === $('ivViewerImg')) closeViewer(); });
    $('ivDetail').addEventListener('click', (e) => { if (e.target === $('ivDetail')) closeDetail(); });  // backdrop click closes popup
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && CF() && CF().isManagerOpen()) { CF().closeManager(); return; }
      if (e.key === 'Escape' && !$('ivDetail').hidden) { closeDetail(); return; }
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

  async function loadUngrouped() {
    try { const r = window.corpus.getUngrouped ? await window.corpus.getUngrouped() : null; ungrouped = new Set((r && r.keys) || []); }
    catch { ungrouped = new Set(); }
  }

  async function loadManualGroups() {
    try { const r = window.corpus.getManualGroups ? await window.corpus.getManualGroups() : null; manualGroups = (r && r.groups) || []; }
    catch { manualGroups = []; }
  }

  function reconcileFolders() { if (CF()) CF().reconcile(new Set(allPosts.map((p) => p.captureId))); }

  async function init() {
    if (inited) return;
    inited = true;
    try { const p = await window.corpus.getPrefs(); if (p && Number.isFinite(p.imageTileSize)) tileSize = p.imageTileSize; } catch { /* default */ }
    bind();
    // 共有フォルダの変更通知: 一覧/デフォルト変更ならグリッドも更新（📁状態反映）、件数のみなら軽更新。
    // 絞り込み中のフォルダが削除されたら state.folder を解除（グリッドが原因不明に空になるのを防ぐ）。
    if (CF()) CF().onChange((kind) => {
      if (state.folder && !CF().byId(state.folder)) state.folder = '';
      renderFolderFilter();
      if (kind === 'list') render();
    });
    // 新規キャプチャ等: 投稿とフォルダ両方を読み直してから reconcile（フォルダ未読込時の取りこぼし防止）。
    if (window.corpus.onPostsChanged) window.corpus.onPostsChanged(() => {
      Promise.all([load(), CF() ? CF().load() : Promise.resolve()]).then(() => { reconcileFolders(); render(); renderTagFilter(); renderFolderFilter(); });
    });
    await Promise.all([load(), loadTagGroups(), loadUngrouped(), loadManualGroups(), CF() ? CF().load() : Promise.resolve()]);
    reconcileFolders();
    render();
    renderTagFilter();
    renderFolderFilter();
  }

  async function refresh() { await load(); reconcileFolders(); render(); renderTagFilter(); renderFolderFilter(); }

  window.corpusImageView = { init, refresh };
})();
