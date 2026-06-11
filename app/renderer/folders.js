// Shared folder store + management modal + toast, used by the post-view
// (viewer.js). folders.json is library-level (keyed by captureId). This module
// owns the data, the management modal (#ivFolderModal), membership toggling, and
// the toast (#ivToast); the "which folder is filtered" state stays per-view. Subscribers
// (onChange) are notified after any mutation so each view refreshes its own chips.
//
//   window.corpusFolders.{ load, all, byId, has, toggleIn,
//     inWorkspace, toggleWorkspace, clearWorkspace, workspaceItems, workspaceCount,
//     reconcile, openManager, closeManager, isManagerOpen, toast, onChange, isLoaded }
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let folders = [];           // [{ id, name, items:[captureId] }] — permanent shelves
  let workspace = [];         // [captureId] — the single ephemeral tray (one-click)
  let loaded = false;
  let loadPromise = null;
  const subs = [];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function genId() { return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function persist() {
    loadPromise = null;   // invalidate the load cache so a later load() re-reads disk (defensive; in-memory state stays authoritative this session)
    if (window.corpus && window.corpus.setFolders) window.corpus.setFolders({ folders, workspace }).catch(() => { /* best-effort */ });
  }
  function notify(kind) { subs.forEach((cb) => { try { cb(kind); } catch { /* ignore */ } }); }

  async function doLoad() {
    try {
      const r = (window.corpus && window.corpus.getFolders) ? await window.corpus.getFolders() : null;
      folders = (r && r.folders) || [];
      workspace = (r && Array.isArray(r.workspace)) ? r.workspace.slice() : [];
    } catch { folders = []; workspace = []; }
    loaded = true;
  }
  function load() { if (!loadPromise) loadPromise = doLoad(); return loadPromise; }

  function byId(id) { return folders.find((f) => f.id === id) || null; }
  function has(id, cid) { const f = byId(id); return !!(f && f.items.includes(cid)); }

  // --- Workspace: a single ephemeral tray. One-click add/remove (no picking),
  // easy to clear. Folders stay the permanent, named, multi-shelf system. ---
  function inWorkspace(cid) { return workspace.includes(cid); }
  function workspaceItems() { return workspace.slice(); }
  function workspaceCount(existing) { return existing ? workspace.filter((c) => existing.has(c)).length : workspace.length; }
  // Toggle captureIds[] (a whole group) in the workspace; anchor decides state.
  function toggleWorkspace(captureIds, anchorCid) {
    const ids = (captureIds || []).filter(Boolean);
    if (!ids.length) return null;
    const anchor = anchorCid != null ? anchorCid : ids[0];
    const wasIn = workspace.includes(anchor);
    if (wasIn) workspace = workspace.filter((c) => !ids.includes(c));
    else ids.forEach((c) => { if (!workspace.includes(c)) workspace.push(c); });
    persist();
    toast(wasIn ? 'ワークスペースから外しました' : 'ワークスペースに追加');
    notify('workspace');
    return wasIn ? 'removed' : 'added';
  }
  function clearWorkspace() {
    if (!workspace.length) return 0;
    const n = workspace.length;
    workspace = [];
    persist();
    toast('ワークスペースを空にしました');
    notify('workspace');
    return n;
  }

  // Drop captureIds no longer present (deleted items), persisting + notifying once.
  function reconcile(existing) {
    let changed = false;
    folders.forEach((f) => { const n = f.items.length; f.items = f.items.filter((c) => existing.has(c)); if (f.items.length !== n) changed = true; });
    const wn = workspace.length;
    workspace = workspace.filter((c) => existing.has(c));
    if (workspace.length !== wn) changed = true;
    if (changed) { persist(); notify('list'); }
  }

  // Toggle membership of captureIds[] in folder fid. anchorCid decides the
  // current state (the tile's representative id). Returns 'added' | 'removed' | null.
  function toggleIn(fid, captureIds, anchorCid) {
    const f = byId(fid); if (!f) return null;
    const ids = (captureIds || []).filter(Boolean);
    if (!ids.length) return null;
    const anchor = anchorCid != null ? anchorCid : ids[0];
    const wasIn = f.items.includes(anchor);
    if (wasIn) f.items = f.items.filter((c) => !ids.includes(c));
    else ids.forEach((c) => { if (!f.items.includes(c)) f.items.push(c); });
    persist();
    toast(wasIn ? `「${f.name}」から削除` : `「${f.name}」に追加`);
    notify('membership');
    return wasIn ? 'removed' : 'added';
  }

  // --- toast (shared, top-level #ivToast) ---
  let toastTimer = null;
  function toast(msg) {
    const el = $('ivToast'); if (!el) return;
    el.textContent = msg; el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  // --- management modal ---
  function isManagerOpen() { const m = $('ivFolderModal'); return !!(m && !m.hidden); }
  function openManager() { renderModal(); const m = $('ivFolderModal'); if (m) m.hidden = false; setTimeout(() => { try { $('ivFolderNewName').focus(); } catch { /* ignore */ } }, 0); }
  function closeManager() { const m = $('ivFolderModal'); if (m) m.hidden = true; }
  function renderModal() {
    const host = $('ivFolderList'); if (!host) return;
    host.innerHTML = folders.length ? folders.map((f) => {
      return `<div class="iv-folder-row" data-fid="${escapeHtml(f.id)}">` +
        `<span class="iv-fold-name">${escapeHtml(f.name)}</span>` +
        `<span class="iv-fold-n">${f.items.length}</span>` +
        `<button class="iv-fold-btn" data-fact="rename" title="名前変更">✎</button>` +
        `<button class="iv-fold-btn" data-fact="delete" title="削除">🗑</button>` +
        `</div>`;
    }).join('') : '<div class="iv-folder-empty">フォルダがありません。下の欄から作成してください。</div>';
  }
  function create() {
    const inp = $('ivFolderNewName'); if (!inp) return;
    const name = (inp.value || '').trim(); if (!name) return;
    folders.push({ id: genId(), name, items: [] });
    inp.value = '';
    persist(); renderModal(); notify('list');
  }

  function bind() {
    const modal = $('ivFolderModal'); if (!modal) return;
    $('ivFolderClose').addEventListener('click', closeManager);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeManager(); });
    $('ivFolderCreate').addEventListener('click', create);
    $('ivFolderNewName').addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    $('ivFolderList').addEventListener('click', (e) => {
      const row = e.target.closest('.iv-folder-row'); if (!row) return;
      const act = e.target.closest('[data-fact]'); if (!act) return;
      const fid = row.dataset.fid; const f = byId(fid); if (!f) return;
      if (act.dataset.fact === 'rename') { const name = window.prompt('フォルダ名', f.name); if (name && name.trim()) f.name = name.trim(); }
      else if (act.dataset.fact === 'delete') {
        if (!window.confirm(`フォルダ「${f.name}」を削除しますか？（中の画像自体は消えません）`)) return;
        folders = folders.filter((x) => x.id !== fid);
      }
      persist(); renderModal(); notify('list');
    });
  }

  bind();

  window.corpusFolders = {
    load, all: () => folders, byId, has,
    inWorkspace, toggleWorkspace, clearWorkspace, workspaceItems, workspaceCount,
    reconcile, toggleIn, openManager, closeManager, isManagerOpen,
    toast, onChange: (cb) => subs.push(cb), isLoaded: () => loaded
  };
})();
