import { createRoot } from 'react-dom/client';
import { SearchModeSeg } from './SearchModeSeg.jsx';
import { DensityToggle } from './DensityToggle.jsx';
import { BrowseToggle } from './BrowseToggle.jsx';
import { SectionTitle, BROWSE_MAP, VIEW_MAP } from './SectionTitle.jsx';
import { initI18n } from './i18n.js';

// Toolbar island — the sidebar's small toolbar controls, React-owned. This is the
// first slice of the shell (above the leaf islands): presentational, with state in
// shared stores (window.corpusSearch for the search mode; window.corpusStore for
// the view density). viewer.js keeps the heavy logic. Each control mounts into its
// EXISTING, now-empty container so the DOM/CSS contract is unchanged. The island now
// also owns the dynamic section titles (#sbViewTitle / #sbLayoutTitle /
// #sbPosterLayoutTitle), which name the current mode/layout from the store; the
// remaining sibling labels (#sbSearchTitle, #sbSortTitle, #searchModeHint) stay put.

function mountSearchMode() {
  const el = document.getElementById('searchModeSeg');
  if (el) createRoot(el).render(<SearchModeSeg />);
}

function mountDensity() {
  const el = document.getElementById('densityToggle');
  if (el) createRoot(el).render(<DensityToggle el={el} />);
}

// Poster-grid density — same component, different store key / data attr.
function mountPosterDensity() {
  const el = document.getElementById('posterDensityToggle');
  if (el) createRoot(el).render(
    <DensityToggle el={el} storeKey="posterView" dataAttr="data-pview" defaultView="card" />
  );
}

// Browse-mode segment (ライブラリ / 投稿者 / コレクション) — active state in
// window.corpusStore 'browseMode'; viewer.js subscribes for the heavy mode switch.
function mountBrowse() {
  const el = document.getElementById('browseToggle');
  if (el) createRoot(el).render(<BrowseToggle el={el} />);
}

// Section titles that name the current mode/layout (e.g. "ビュー · ライブラリ",
// "レイアウト · カード"). React-owned now, so viewer.js's static setText for these is
// dropped — see SectionTitle.jsx and the note above.
function mountViewTitle() {
  const el = document.getElementById('sbViewTitle');
  if (el) createRoot(el).render(
    <SectionTitle baseKey="sbViewTitle" storeKey="browseMode" map={BROWSE_MAP} defaultVal="posts" />
  );
}

function mountLayoutTitle() {
  const el = document.getElementById('sbLayoutTitle');
  if (el) createRoot(el).render(
    <SectionTitle baseKey="sbLayoutTitle" storeKey="view" map={VIEW_MAP} defaultVal="card" />
  );
}

function mountPosterLayoutTitle() {
  const el = document.getElementById('sbPosterLayoutTitle');
  if (el) createRoot(el).render(
    <SectionTitle baseKey="sbLayoutTitle" storeKey="posterView" map={VIEW_MAP} defaultVal="card" />
  );
}

function mountAll() {
  mountSearchMode();
  mountDensity();
  mountPosterDensity();
  mountBrowse();
  mountViewTitle();
  mountLayoutTitle();
  mountPosterLayoutTitle();
}

// Resolve i18n before render so t() is synchronous in components. The single
// window.corpusI18n promise is shared with viewer.js — awaiting it is cheap and
// adds no extra IPC. (Same pattern as the settings island.)
initI18n().then(() => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll);
  } else {
    mountAll();
  }
});
