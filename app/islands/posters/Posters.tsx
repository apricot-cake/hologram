// Virtualized poster grid — poster cells on the shared VirtualGridHost. Emits
// the SAME DOM the old flow layout did — `.poster-card[data-index]` (+inspected)
// with `.poster-av`, `.poster-meta` (.poster-name / .poster-handle /
// .poster-foot), and the `.poster-tag[data-ptag]` / `.poster-info[data-pinfo]`
// hover buttons — so the delegated click/contextmenu on #posterGrid keeps
// firing. React renders + windows; viewer.js owns posterList, the count badge,
// the density classes on the container, and every event. The inspected
// highlight is derived from corpusStore, not modelOf (see below).
import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';

// The inspected ring is derived straight from corpusStore's 'inspectedKey'
// (a real subscription) rather than riding on modelOf's closure-read model —
// see grid/Grid.tsx's Cell for the post-side twin of this.
const subInspected = (cb: () => void) => storeSubscribe('inspectedKey', cb);
const getInspected = () => (storeGet('inspectedKey') as string | null | undefined) ?? null;

// The poster cell model viewer.js resolves per card — only the fields laid out here.
interface PosterCardModel {
  index: number;
  inspected?: boolean;
  avatarSrc?: string | null;
  monogram?: string;
  name?: string;
  handle?: string | null;
  platform?: string | null;
  pfName?: string;
  countLabel?: string;
}

// 🏷 edit-tags button — ported 1:1 from viewer.js.
function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

// ℹ info button — ported 1:1 from viewer.js.
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <line x1="12" y1="7.6" x2="12" y2="7.7" />
    </svg>
  );
}

function PosterCard({ c, tagTitle, infoTitle }: { c: PosterCardModel; tagTitle?: string; infoTitle?: string }) {
  return (
    <div
      className={'poster-card' + (c.inspected ? ' inspected' : '')}
      data-index={c.index}
      tabIndex={0}
      // --card-i drives the entrance stagger delay (CSS caps it via min()).
      style={{ '--card-i': c.index } as CSSProperties}
    >
      <div className="poster-av">{c.avatarSrc ? <img src={c.avatarSrc} alt="" loading="lazy" /> : c.monogram}</div>
      <div className="poster-meta">
        <div className="poster-name">{c.name}</div>
        {c.handle && <div className="poster-handle">@{c.handle}</div>}
        <div className="poster-foot">
          {c.platform && (
            <span className="pf-tag">
              <span className={'pf-dot ' + c.platform} />
              {c.pfName}
            </span>
          )}
          <span className="poster-count">{c.countLabel}</span>
        </div>
      </div>
      {/* Hover actions: 🏷 tag → ℹ info (L→R). */}
      <button className="poster-tag" data-ptag={c.index} title={tagTitle} aria-label={tagTitle}>
        <TagIcon />
      </button>
      <button className="poster-info" data-pinfo={c.index} title={infoTitle} aria-label={infoTitle}>
        <InfoIcon />
      </button>
    </div>
  );
}

// One windowed cell: build the card model lazily (only visible cells pay).
function PosterCell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const c = model.modelOf(data, index);
  c.inspected = data != null && data.key != null && inspectedKey === 'poster:' + data.key;
  return <PosterCard c={c} tagTitle={model.tagTitle} infoTitle={model.infoTitle} />;
}

export function PostersHost({ model }: { model: CorpusGridModel }) {
  return <VirtualGridHost model={model} cell={PosterCell} />;
}
