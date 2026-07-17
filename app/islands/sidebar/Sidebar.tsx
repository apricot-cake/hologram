import { useEffect, useState } from 'react';
import { corpusPostSidebarSource } from '../../renderer/sidebar.ts';
import { t } from '../_shared/i18n.ts';
import { getTagLabels } from '../../renderer/tags.ts';
import { Glyph, ICON, ICON_TRASH, Row } from './parts.tsx';

// Post-mode filter-row column (#filterRows). Pure presentation, PULLING its own model
// from renderer/sidebar.ts's corpusPostSidebarSource (badges/visible/clip/multi/openCat
// derived from corpusStore + the tags/folders/posts-data services — see that file). Row
// NAMES are resolved here via t() (static i18n keys) or kindLabel() (the user-renamable
// 作品/キャラ label), not carried in the model — the same "island resolves its own i18n"
// pattern SortSelect/SectionTitle use. The markup MUST stay a byte-for-byte match of
// the old static HTML — viewer's delegated #filterRows click handler and the
// verify/test scripts key off .sb-row / data-qfrow / data-badge / .on, so those
// selectors and classes are reproduced exactly. Clicks are NOT handled here; they
// bubble to viewer's delegation on the #filterRows container. Row / Badge / Glyph /
// ICON are shared with the poster column (PosterSidebar) via parts.tsx.

// Static row-name i18n keys, keyed by cat (data-qfrow === data-badge). work/character
// aren't here — their name is the user-renamable 種別 label (see kindLabel below).
const ROW_LABEL_KEY: Record<string, string> = {
  folder: 'qfCatFolder',
  platform: 'qfPlatform',
  postType: 'qfPostType',
  media: 'qfMediaTitle',
  date: 'qfDate',
  engagement: 'qfEngagement',
  user: 'sidebarAuthors',
  hashtag: 'tabTags',
  tag: 'qfTag',
};

// 作品/キャラ 種別 names are user-renamable (corpusTags.setKindLabel); fall back to the
// built-in i18n label when unset — mirrors tags.ts's own kindLabel().
function kindLabel(kind: 'work' | 'character'): string {
  return getTagLabels()[kind] || t(kind === 'work' ? 'kindWork' : 'kindCharacter');
}
function rowLabel(cat: string): string {
  if (cat === 'work' || cat === 'character') return kindLabel(cat);
  return t(ROW_LABEL_KEY[cat] || cat);
}

// Ordered flyout/popover rows (identical DOM; viewer's delegation decides behavior).
// key === data-qfrow === data-badge. `multi` is inserted between media and date, and
// `work`/`character` are progressively disclosed, so they're handled outside this list.
const FLYOUT_ROWS = ['folder', 'platform', 'postType', 'media'] as const;
const AFTER_MULTI = ['date', 'engagement', 'user'] as const;
const TAIL_ROWS = ['hashtag', 'tag'] as const;

// Not useSyncExternalStore: get() recomputes a fresh object on every notify (like the
// grid/image-tab/tabs sources), which would trip React's "cached snapshot" tearing check
// — a plain subscribe→setState effect (same shape as ImageTabHost) sidesteps that.
export function Sidebar() {
  const [m, setM] = useState(() => corpusPostSidebarSource.get());
  useEffect(() => {
    const sync = () => setM(corpusPostSidebarSource.get());
    const unsub = corpusPostSidebarSource.subscribe(sync);
    sync(); // catch anything that changed before this effect ran
    return unsub;
  }, []);
  if (!m) return null;
  const b = m.badges || {};
  const row = (cat: string) => <Row key={cat} cat={cat} label={rowLabel(cat)} badge={b[cat] || 0} open={m.openCat === cat} />;
  return (
    <>
      <div className="sb-title" id="sbFilterTitle">
        {t('sbFilterTitle')}
      </div>
      {/* Clip: library-wide ephemeral flag, a 2-state toggle with an inline clear button.
          Badge + clear are SIBLINGS of the button (not inside it) — same as the old HTML. */}
      <div className="clip-row-wrap">
        <button className={m.clip.active ? 'sb-row clip-row active' : 'sb-row clip-row'} id="clipRow" type="button" data-tip={t('clipRowTip')} data-tip-rich="">
          <Glyph className="sb-row-ic" svg={ICON.clip} />
          <span className="sb-row-name" id="sbClipTitle">
            {t('clipTitle')}
          </span>
        </button>
        <span className={m.clip.count > 0 ? 'sb-row-badge on' : 'sb-row-badge'} id="clipBadge">
          {m.clip.count > 0 ? m.clip.count : ''}
        </span>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: SVG-glyph pattern — the trash icon is an app-defined constant. Kept as button>svg (not button>span>svg) to match the old innerHTML DOM. */}
        <button className="clip-clear-btn" id="clipClear" type="button" aria-label={t('clipEmpty')} data-tip={t('clipEmptyTip')} style={{ display: m.clip.clearVisible ? '' : 'none' }} dangerouslySetInnerHTML={{ __html: ICON_TRASH }} />
      </div>
      {FLYOUT_ROWS.map(row)}
      {/* 複数画像 (grouped): a direct 2-state toggle (no data-qfrow, no flyout). */}
      <button className={m.multi.active ? 'sb-row multi-row active' : 'sb-row multi-row'} id="multiRow" type="button">
        <Glyph className="sb-row-ic" svg={ICON.multi} />
        <span className="sb-row-name">{t('qfMultiImage')}</span>
      </button>
      {AFTER_MULTI.map(row)}
      {/* 作品/キャラ rows are kept in the DOM (style.display) — hidden until at least one
          tag wears that 種別 — so viewer's flyout-anchor query still finds them by data-qfrow. */}
      <Row cat="work" label={kindLabel('work')} badge={b.work || 0} open={m.openCat === 'work'} style={{ display: m.visible.work ? '' : 'none' }} />
      <Row cat="character" label={kindLabel('character')} badge={b.character || 0} open={m.openCat === 'character'} style={{ display: m.visible.character ? '' : 'none' }} />
      {TAIL_ROWS.map(row)}
    </>
  );
}
