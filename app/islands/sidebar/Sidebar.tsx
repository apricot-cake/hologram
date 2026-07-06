import { useSyncExternalStore } from 'react';
import { Glyph, ICON, ICON_TRASH, Row } from './parts.tsx';

// Post-mode filter-row column (#filterRows). Pure presentation: every value arrives
// already-computed/localized from viewer.js via window.corpusSidebar (buildSidebarModel).
// The markup MUST stay a byte-for-byte match of the old static HTML — viewer's delegated
// #filterRows click handler and the verify/test scripts key off .sb-row / data-qfrow /
// data-badge / .on, so those selectors and classes are reproduced exactly. Clicks are
// NOT handled here; they bubble to viewer's delegation on the #filterRows container.
// Row / Badge / Glyph / ICON are shared with the poster column (PosterSidebar) via parts.tsx.

// クリップ row tooltip: a fixed literal with no i18n key (identical across languages in
// the old HTML), inlined here to keep the port 1:1.
const CLIP_TIP = 'あとで見返したい投稿につける一時的な目印。各カードのクリップボタンで付け外しでき、この行を押すと目印付きの投稿だけに絞り込みます。';

// Ordered flyout/popover rows (identical DOM; viewer's delegation decides behavior).
// key === data-qfrow === data-badge. `multi` is inserted between media and date, and
// `work`/`character` are progressively disclosed, so they're handled outside this list.
const FLYOUT_ROWS = ['collection', 'platform', 'postType', 'media'] as const;
const AFTER_MULTI = ['date', 'engagement', 'user'] as const;
const TAIL_ROWS = ['hashtag', 'tag'] as const;

export function Sidebar() {
  const m = useSyncExternalStore(window.corpusSidebar.subscribe, window.corpusSidebar.get);
  if (!m) return null;
  const b = m.badges || {};
  const L = m.labels || {};
  const row = (cat: string) => <Row key={cat} cat={cat} label={L[cat] || ''} badge={b[cat] || 0} open={m.openCat === cat} />;
  return (
    <>
      <div className="sb-title" id="sbFilterTitle">
        {m.title}
      </div>
      {/* Clip: library-wide ephemeral flag, a 2-state toggle with an inline clear button.
          Badge + clear are SIBLINGS of the button (not inside it) — same as the old HTML. */}
      <div className="clip-row-wrap">
        <button className={m.clip.active ? 'sb-row clip-row active' : 'sb-row clip-row'} id="clipRow" type="button" data-tip={CLIP_TIP} data-tip-rich="">
          <Glyph className="sb-row-ic" svg={ICON.clip} />
          <span className="sb-row-name" id="sbClipTitle">
            {m.clip.label}
          </span>
        </button>
        <span className={m.clip.count > 0 ? 'sb-row-badge on' : 'sb-row-badge'} id="clipBadge">
          {m.clip.count > 0 ? m.clip.count : ''}
        </span>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG-glyph pattern — the trash icon is an app-defined constant. Kept as button>svg (not button>span>svg) to match the old innerHTML DOM. */}
        <button className="clip-clear-btn" id="clipClear" type="button" aria-label={m.clip.emptyAria} data-tip={m.clip.emptyTip} style={{ display: m.clip.clearVisible ? '' : 'none' }} dangerouslySetInnerHTML={{ __html: ICON_TRASH }} />
      </div>
      {FLYOUT_ROWS.map(row)}
      {/* 複数画像 (grouped): a direct 2-state toggle (no data-qfrow, no flyout). */}
      <button className={m.multi.active ? 'sb-row multi-row active' : 'sb-row multi-row'} id="multiRow" type="button">
        <Glyph className="sb-row-ic" svg={ICON.multi} />
        <span className="sb-row-name">{m.multi.label}</span>
      </button>
      {AFTER_MULTI.map(row)}
      {/* 作品/キャラ rows are kept in the DOM (style.display) — hidden until at least one
          tag wears that 種別 — so viewer's flyout-anchor query still finds them by data-qfrow. */}
      <Row cat="work" label={L.work || ''} badge={b.work || 0} open={m.openCat === 'work'} style={{ display: m.visible.work ? '' : 'none' }} />
      <Row cat="character" label={L.character || ''} badge={b.character || 0} open={m.openCat === 'character'} style={{ display: m.visible.character ? '' : 'none' }} />
      {TAIL_ROWS.map(row)}
    </>
  );
}
