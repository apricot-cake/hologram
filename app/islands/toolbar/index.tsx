import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BrowseToggle } from './BrowseToggle.tsx';
import { DensityToggle } from './DensityToggle.tsx';
import { GlassSelect } from './GlassSelect.tsx';
import { SearchModeSeg } from './SearchModeSeg.tsx';
import { SectionTitle } from './SectionTitle.tsx';

// Toolbar island — the sidebar's small toolbar controls, React-owned. Presentational,
// with state in shared stores (window.corpusSearch for the search mode; window.corpusStore
// for the view density / browse mode / sort). viewer.js keeps the heavy logic. Each control
// portals into its EXISTING, now-empty container so the DOM/CSS contract is unchanged.
// Lives under the single App root now: app/App.tsx renders <Toolbar/>, which portals every
// control. i18n is resolved by the unified root before it renders (SearchModeSeg /
// SectionTitle / GlassSelect use t() synchronously).

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

// Portal `node` into an existing container by id (null if the container is absent).
function into(id: string, node: ReactNode) {
  const el = document.getElementById(id);
  return el ? createPortal(node, el) : null;
}

// Density / browse toggles need their CONTAINER element (ResizeObserver + glass-thumb
// positioning) — that container is also the portal target, so pass it as `el`.
function DensityMount({ id, storeKey, dataAttr, defaultView }: { id: string; storeKey?: string; dataAttr?: string; defaultView?: string }) {
  const el = document.getElementById(id);
  return el ? createPortal(<DensityToggle el={el} storeKey={storeKey} dataAttr={dataAttr} defaultView={defaultView} />, el) : null;
}
function BrowseMount() {
  const el = document.getElementById('browseToggle');
  return el ? createPortal(<BrowseToggle el={el} />, el) : null;
}

// Sort selects: the native <select> stays as viewer's value source (hidden via .cs-host);
// React renders the glass trigger + popup into a display:contents span inserted right after
// it (so .cs-btn lays out against the .sb-section, like the old afterend-inserted button).
// The span is created once (idempotent) and reused as the portal target.
function sortHost(id: string): { sel: HTMLSelectElement; host: HTMLSpanElement } | null {
  const sel = document.getElementById(id) as HTMLSelectElement | null;
  if (!sel) return null;
  let host = sel.nextElementSibling as HTMLSpanElement | null;
  if (!host || !host.classList.contains('cs-mount')) {
    sel.classList.add('cs-host');
    host = document.createElement('span');
    host.className = 'cs-mount';
    host.style.display = 'contents';
    sel.insertAdjacentElement('afterend', host);
  }
  return { sel, host };
}
function SortMount({ id, storeKey, options }: { id: string; storeKey: string; options: { value: string; key: string }[] }) {
  const h = sortHost(id);
  return h ? createPortal(<GlassSelect sel={h.sel} storeKey={storeKey} options={options} />, h.host) : null;
}

export function Toolbar() {
  return (
    <>
      {into('searchModeSeg', <SearchModeSeg />)}
      <DensityMount id="densityToggle" />
      <DensityMount id="posterDensityToggle" storeKey="posterView" dataAttr="data-pview" defaultView="card" />
      <BrowseMount />
      {/* Section titles ("ビュー" / "レイアウト") — static; island-rendered so viewer's setText stays dropped. */}
      {into('sbViewTitle', <SectionTitle baseKey="sbViewTitle" />)}
      {into('sbLayoutTitle', <SectionTitle baseKey="sbLayoutTitle" />)}
      {into('sbPosterLayoutTitle', <SectionTitle baseKey="sbLayoutTitle" />)}
      <SortMount id="sortSelect" storeKey="sortPost" options={SORT_POST} />
      <SortMount id="posterSortSelect" storeKey="sortPoster" options={SORT_POSTER} />
    </>
  );
}
