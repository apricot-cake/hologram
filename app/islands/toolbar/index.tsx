import { createRoot } from 'react-dom/client';
import { SearchModeSeg } from './SearchModeSeg.tsx';
import { DensityToggle } from './DensityToggle.tsx';
import { BrowseToggle } from './BrowseToggle.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import { GlassSelect } from './GlassSelect.tsx';
import { initI18n } from '../_shared/i18n.ts';

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
  if (el) createRoot(el).render(<DensityToggle el={el} storeKey="posterView" dataAttr="data-pview" defaultView="card" />);
}

// Browse-mode segment (ライブラリ / 投稿者 / コレクション) — active state in
// window.corpusStore 'browseMode'; viewer.js subscribes for the heavy mode switch.
function mountBrowse() {
  const el = document.getElementById('browseToggle');
  if (el) createRoot(el).render(<BrowseToggle el={el} />);
}

// Section titles ("ビュー" / "レイアウト") — static now (the mode readout was
// retired; see SectionTitle.tsx). Still island-rendered so viewer.js's setText
// stays dropped.
function mountViewTitle() {
  const el = document.getElementById('sbViewTitle');
  if (el) createRoot(el).render(<SectionTitle baseKey="sbViewTitle" />);
}

function mountLayoutTitle() {
  const el = document.getElementById('sbLayoutTitle');
  if (el) createRoot(el).render(<SectionTitle baseKey="sbLayoutTitle" />);
}

function mountPosterLayoutTitle() {
  const el = document.getElementById('sbPosterLayoutTitle');
  if (el) createRoot(el).render(<SectionTitle baseKey="sbLayoutTitle" />);
}

// Sort selects (post / poster / collection) — one GlassSelect, three mounts. The
// native <select> stays as viewer's value source (hidden via .cs-host); React renders
// the glass trigger + popup. The mount span is display:contents so the .cs-btn lays
// out as if it were a direct child of the .sb-section (full width), exactly like the
// old afterend-inserted button. Option order/values mirror index.html.
const SORT_POST = [
  { value: 'date-desc', key: 'sortDateDesc' },
  { value: 'date-asc', key: 'sortDateAsc' },
  { value: 'likes-desc', key: 'sortLikes' },
  { value: 'reposts-desc', key: 'sortReposts' },
  { value: 'replies-desc', key: 'sortReplies' },
  { value: 'captured-desc', key: 'sortCaptured' },
  { value: 'likes-pct', key: 'sortLikesPct' },
];
const SORT_POSTER = [
  { value: 'count', key: 'posterSortCount' },
  { value: 'name', key: 'posterSortName' },
  { value: 'date-desc', key: 'posterSortNewest' },
  { value: 'date-asc', key: 'posterSortOldest' },
];
function mountSort(id: string, storeKey: string, options: { value: string; key: string }[]) {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel) return;
  sel.classList.add('cs-host'); // hide the native select; React drives the trigger
  const mount = document.createElement('span');
  mount.style.display = 'contents'; // .cs-btn lays out against the .sb-section, not this span
  sel.insertAdjacentElement('afterend', mount);
  createRoot(mount).render(<GlassSelect sel={sel} storeKey={storeKey} options={options} />);
}

function mountAll() {
  mountSearchMode();
  mountDensity();
  mountPosterDensity();
  mountBrowse();
  mountViewTitle();
  mountLayoutTitle();
  mountPosterLayoutTitle();
  mountSort('sortSelect', 'sortPost', SORT_POST);
  mountSort('posterSortSelect', 'sortPoster', SORT_POSTER);
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
