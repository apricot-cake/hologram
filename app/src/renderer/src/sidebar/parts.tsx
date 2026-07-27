import type { CSSProperties } from 'react';

// Shared building blocks for the two sidebar filter-row columns (post = Sidebar,
// poster = PosterSidebar). Extracting Row/Badge/Glyph here is the concrete 部品化
// win React化 exists for: the old #filterRows and #posterFilterRows static HTML
// carried the SAME .sb-row / .sb-row-ic / .sb-row-name / .sb-row-badge / .sb-row-arrow
// skeleton duplicated by hand, which is exactly the kind of copy that drifts. Both
// columns now render from ONE Row component, so the markup can't diverge.

// Full <svg> strings, byte-identical to the pre-island static HTML so the rendered
// glyphs match exactly (CSS sizes .sb-row-ic > svg). Kept as whole <svg> (not just
// paths) to preserve per-icon attrs (the 複数画像 icon carries width/height).
export const ICON: Record<string, string> = {
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  platform: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>',
  postType: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  media:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M21 7.5h-4"/><path d="M21 16.5h-4"/></svg>',
  multi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>',
  engagement: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M14.83 14.83a4 4 0 1 1 0-5.66"/></svg>',
  character:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0Z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>',
  hashtag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="M16 3l-2 18"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="0.5" fill="currentColor"/></svg>',
  // Poster-only: the サーバー (instance) row's stacked-rows glyph.
  instance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/></svg>',
};
// Poster-mode rows (data-qfrow="poster-*") reuse the same glyphs as their post-side
// twins — the old #posterFilterRows static HTML shared them 1:1.
Object.assign(ICON, {
  'poster-platform': ICON.platform,
  'poster-work': ICON.work,
  'poster-character': ICON.character,
  'poster-tag': ICON.tag,
  'poster-instance': ICON.instance,
  'poster-date': ICON.date,
  'poster-folder': ICON.folder,
});

export const ARROW = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 1.5l4 4-4 4"/></svg>';

// Single sanctioned SVG-glyph site: the icon strings are app-defined constants (never
// user content), same established island pattern as ContextMenu/Tabs/Chips.
export function Glyph({ className, svg }: { className: string; svg: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: established SVG-glyph pattern — app-defined constants, never user content
  return <span className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// A badge span: byte-identical to the old markup (class + optional .on + data-badge + count).
// `cat` doubles as the data-badge key (post: "platform"; poster: "poster-platform").
export function Badge({ cat, badge }: { cat: string; badge: number }) {
  return (
    <span className={badge > 0 ? 'sb-row-badge on' : 'sb-row-badge'} data-badge={cat}>
      {badge > 0 ? badge : ''}
    </span>
  );
}

// One flyout/popover row. `cat` === data-qfrow === data-badge === ICON key; viewer's
// delegated click handler on the container decides behavior. `.qf-open` is model-driven
// (React owns className, so imperative classList.add would be clobbered on re-render).
export function Row({ cat, label, badge, open, style }: { cat: string; label: string; badge: number; open: boolean; style?: CSSProperties }) {
  return (
    <button className={open ? 'sb-row qf-open' : 'sb-row'} type="button" data-qfrow={cat} style={style}>
      <Glyph className="sb-row-ic" svg={ICON[cat]} />
      <span className="sb-row-name">{label}</span>
      <Badge cat={cat} badge={badge} />
      <Glyph className="sb-row-arrow" svg={ARROW} />
    </button>
  );
}
