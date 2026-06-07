// Top-level mode switch: 投稿閲覧 (post-view, post-snap) / 画像閲覧 (image-view,
// info-plus tile display). Toggles the two containers; each mode loads its own
// data (post-view via viewer.js, image-view via image-viewer.js). Sharing a
// single data layer is a later optimization.
(function () {
  'use strict';
  const postBtn = document.getElementById('modePostBtn');
  const imgBtn = document.getElementById('modeImageBtn');
  const modePost = document.getElementById('mode-post');
  const modeImage = document.getElementById('mode-image');
  if (!postBtn || !imgBtn || !modePost || !modeImage) return;

  let imageReady = false;

  function setMode(mode) {
    const img = mode === 'image';
    modePost.style.display = img ? 'none' : '';
    modeImage.style.display = img ? '' : 'none';
    postBtn.classList.toggle('active', !img);
    imgBtn.classList.toggle('active', img);
    if (img && window.corpusImageView) {
      if (!imageReady) { imageReady = true; window.corpusImageView.init(); }
      else { window.corpusImageView.refresh(); }
    }
  }

  postBtn.addEventListener('click', () => setMode('post'));
  imgBtn.addEventListener('click', () => setMode('image'));
})();
