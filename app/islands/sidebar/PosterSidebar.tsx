import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { Row } from './parts.tsx';

// Poster-mode filter-row column (#posterFilterRows) — twin of Sidebar (post side).
// Pure presentation: every value arrives already-computed/localized from viewer.ts via
// window.corpusSidebar's poster channel (buildPosterSidebarModel). Same DOM contract as
// the old static HTML (.sb-row / data-qfrow="poster-*" / data-badge / .qf-open), so
// viewer's delegated #posterFilterRows click handler and the flyout anchor queries
// (querySelector('#posterFilterRows [data-qfrow="poster-date"]')) keep working unchanged —
// and the verify/test scripts that .click() those selectors don't need touching. Clicks
// bubble to viewer's delegation; nothing is handled here.

// poster-platform / poster-date / poster-folder are always shown. work / character / tag /
// instance are progressively disclosed — visible only once posters actually carry such
// values (zero trace for someone who just saves posts). Their rows stay MOUNTED (hidden via
// style.display) so viewer's data-qfrow anchor query still finds them, mirroring the post
// side's 作品/キャラ rows.

export function PosterSidebar() {
  const m = useSyncExternalStore(window.corpusSidebar.subscribePoster, window.corpusSidebar.getPoster);
  if (!m) return null;
  const b = m.badges || {};
  const L = m.labels || {};
  const v = m.visible || { work: false, character: false, tag: false, instance: false };
  const row = (cat: string, style?: CSSProperties) => <Row key={cat} cat={cat} label={L[cat] || ''} badge={b[cat] || 0} open={m.openCat === cat} style={style} />;
  const hidden = (on: boolean): CSSProperties => ({ display: on ? '' : 'none' });
  return (
    <>
      <div className="sb-title" id="sbPosterFilterTitle">
        {m.title}
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
