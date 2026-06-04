'use strict';

const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const folderLabel = document.getElementById('folderLabel');

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatNum(n) {
  if (n == null) return null;
  return n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : String(n);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

function statLine(post) {
  const parts = [];
  const likes = formatNum(post.likes);
  const reposts = formatNum(post.reposts);
  const replies = formatNum(post.replies);
  if (likes != null) parts.push(`♥ ${likes}`);
  if (reposts != null) parts.push(`⇄ ${reposts}`);
  if (replies != null) parts.push(`↩ ${replies}`);
  return parts.join('');
}

function cardHtml(post) {
  const platform = ['x', 'bluesky', 'misskey'].includes(post.platform) ? post.platform : 'x';
  const img = post.image
    ? `<img loading="lazy" src="psimg://img/${encodeURIComponent(post.image)}" alt="">`
    : '';
  const display = escapeHtml(post.displayName || post.screenName || '');
  const handle = post.screenName ? `<span class="handle">@${escapeHtml(post.screenName)}</span>` : '';
  const stats = statLine(post);
  return `
    <div class="card" data-url="${escapeHtml(post.url || '')}">
      ${img}
      <div class="meta">
        <div class="user"><span class="badge ${platform}">${platform}</span> ${display} ${handle}</div>
        <div class="text">${escapeHtml(post.text || '')}</div>
        ${stats ? `<div class="stats">${stats}</div>` : ''}
        <div class="date">${escapeHtml(formatDate(post.date))}</div>
      </div>
    </div>`;
}

function showEmpty(message, withButton) {
  gridEl.innerHTML = '';
  countEl.textContent = '';
  emptyEl.style.display = 'block';
  emptyEl.innerHTML = `<h2>${escapeHtml(message)}</h2>` +
    (withButton ? '<p>保存先フォルダを選ぶと、保存済みの投稿が表示されます。</p>' : '');
}

const extIdInput = document.getElementById('extId');
const extIdHint = document.getElementById('extIdHint');

async function loadExtensionId() {
  const { extensionId } = await window.postSnap.getConfig();
  extIdInput.value = extensionId || '';
  extIdHint.textContent = extensionId ? '登録済み' : '未登録';
}

async function saveExtensionId() {
  const { extensionId } = await window.postSnap.setExtensionId(extIdInput.value);
  extIdInput.value = extensionId || '';
  extIdHint.textContent = extensionId ? '登録しました' : '未登録';
}

extIdInput.addEventListener('change', saveExtensionId);

async function render() {
  const { saveFolder, posts } = await window.postSnap.listPosts();
  folderLabel.textContent = saveFolder || '(保存先未設定)';

  if (!saveFolder) {
    showEmpty('保存先フォルダが未設定です', true);
    return;
  }
  if (!posts.length) {
    showEmpty('投稿がありません', false);
    return;
  }

  emptyEl.style.display = 'none';
  countEl.textContent = `${posts.length} 件`;
  gridEl.innerHTML = posts.map(cardHtml).join('');
}

gridEl.addEventListener('click', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const url = card.dataset.url;
  if (url) window.postSnap.openExternal(url);
});

document.getElementById('reloadBtn').addEventListener('click', render);

document.getElementById('folderBtn').addEventListener('click', async () => {
  await window.postSnap.pickSaveFolder();
  render();
});

loadExtensionId();
render();
