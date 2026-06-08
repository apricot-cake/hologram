// Top-level mode switch: 投稿閲覧 (post-view, post-snap) / 画像閲覧 (image-view,
// info-plus tile display). Toggles the two containers; each mode loads its own
// data (post-view via viewer.js, image-view via image-viewer.js). The last-opened
// mode is remembered via the 'mode' pref and restored on launch.
(function () {
  'use strict';
  const postBtn = document.getElementById('modePostBtn');
  const imgBtn = document.getElementById('modeImageBtn');
  const modePost = document.getElementById('mode-post');
  const modeImage = document.getElementById('mode-image');
  const sidePost = document.getElementById('side-post');     // post filters (in shared sidebar)
  const sideImage = document.getElementById('side-image');   // image filters (in shared sidebar)
  if (!postBtn || !imgBtn || !modePost || !modeImage) return;

  let imageReady = false;

  function setMode(mode, persist) {
    const img = mode === 'image';
    modePost.style.display = img ? 'none' : '';
    modeImage.style.display = img ? '' : 'none';
    if (sidePost) sidePost.style.display = img ? 'none' : '';
    if (sideImage) sideImage.style.display = img ? '' : 'none';
    postBtn.classList.toggle('active', !img);
    imgBtn.classList.toggle('active', img);
    if (img && window.corpusImageView) {
      if (!imageReady) { imageReady = true; window.corpusImageView.init(); }
      else { window.corpusImageView.refresh(); }
    }
    if (persist !== false && window.corpus.setPref) window.corpus.setPref('mode', img ? 'image' : 'post');
  }

  postBtn.addEventListener('click', () => setMode('post'));
  imgBtn.addEventListener('click', () => setMode('image'));

  // Collapsible sidebar sections (.sb-section.collapsible): click the title to fold
  // its chips. Controls inside the title (管理 link / AND-OR toggle) are ignored.
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.addEventListener('click', (e) => {
    const title = e.target.closest('.sb-title');
    if (!title || e.target.closest('button, a, input, select')) return;
    const section = title.closest('.sb-section.collapsible');
    if (section) section.classList.toggle('collapsed');
  });

  // Restore the last-opened mode (default: post). persist=false so restoring
  // doesn't itself write the pref.
  (async () => {
    try {
      const prefs = window.corpus.getPrefs ? await window.corpus.getPrefs() : null;
      if (prefs && window.corpusSearch) window.corpusSearch.applyMode(prefs.searchMode);   // 検索方式(通常/あいまい)を両モードへ反映
      if (prefs && prefs.mode === 'image') setMode('image', false);
    } catch { /* default post */ }
  })();
})();
