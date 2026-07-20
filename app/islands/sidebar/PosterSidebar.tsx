import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { hologramPosterSidebarSource } from '../../renderer/sidebar.ts';
import { t } from '../_shared/i18n.ts';
import { getTagLabels } from '../../renderer/tags.ts';
import { Row } from './parts.tsx';

// Poster-mode filter-row column (#posterFilterRows) — twin of Sidebar (post side).
// Pure presentation, PULLING its own model from renderer/sidebar.ts's
// hologramPosterSidebarSource (badges/visible/openCat derived from hologramStore + the
// tags/posts-data/listing services — see that file). Row NAMES are resolved here via
// t() or kindLabel(), same as the post column. Same DOM contract as the old static
// HTML (.sb-row / data-qfrow="poster-*" / data-badge / .qf-open), so viewer's
// delegated #posterFilterRows click handler and the flyout anchor queries
// (querySelector('#posterFilterRows [data-qfrow="poster-date"]')) keep working
// unchanged — and the verify/test scripts that .click() those selectors don't need
// touching. Clicks bubble to viewer's delegation; nothing is handled here.

// poster-platform / poster-date / poster-folder are always shown. work / character / tag /
// instance are progressively disclosed — visible only once posters actually carry such
// values (zero trace for someone who just saves posts). Their rows stay MOUNTED (hidden via
// style.display) so viewer's data-qfrow anchor query still finds them, mirroring the post
// side's 作品/キャラ rows.

const ROW_LABEL_KEY: Record<string, string> = {
  'poster-platform': 'qfPlatform',
  'poster-tag': 'qfTag',
  'poster-instance': 'qfInstance',
  'poster-date': 'qfDate',
  'poster-folder': 'qfCatFolder',
};

// 作品/キャラ 種別 names are user-renamable (hologramTags.setKindLabel); fall back to the
// built-in i18n label when unset — mirrors tags.ts's own kindLabel().
function kindLabel(kind: 'work' | 'character'): string {
  return getTagLabels()[kind] || t(kind === 'work' ? 'kindWork' : 'kindCharacter');
}
function rowLabel(cat: string): string {
  if (cat === 'poster-work') return kindLabel('work');
  if (cat === 'poster-character') return kindLabel('character');
  return t(ROW_LABEL_KEY[cat] || cat);
}

// Not useSyncExternalStore: get() recomputes a fresh object on every notify (like the
// grid/image-tab/tabs sources), which would trip React's "cached snapshot" tearing check
// — a plain subscribe→setState effect (same shape as ImageTabHost) sidesteps that.
export function PosterSidebar() {
  const [m, setM] = useState(() => hologramPosterSidebarSource.get());
  useEffect(() => {
    const sync = () => setM(hologramPosterSidebarSource.get());
    const unsub = hologramPosterSidebarSource.subscribe(sync);
    sync(); // catch anything that changed before this effect ran
    return unsub;
  }, []);
  if (!m) return null;
  const b = m.badges || {};
  const v = m.visible || { work: false, character: false, tag: false, instance: false };
  const row = (cat: string, style?: CSSProperties) => <Row key={cat} cat={cat} label={rowLabel(cat)} badge={b[cat] || 0} open={m.openCat === cat} style={style} />;
  const hidden = (on: boolean): CSSProperties => ({ display: on ? '' : 'none' });
  return (
    <>
      <div className="sb-title" id="sbPosterFilterTitle">
        {t('sbFilterTitle')}
      </div>
      {row('poster-platform')}
      {row('poster-work', hidden(v.work))}
      {row('poster-character', hidden(v.character))}
      {row('poster-tag', hidden(v.tag))}
      {row('poster-instance', hidden(v.instance))}
      {row('poster-date')}
      {row('poster-folder')}
    </>
  );
}
