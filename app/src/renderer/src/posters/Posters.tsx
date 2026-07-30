// Virtualized poster grid — poster cells on the shared VirtualGridHost. Emits
// the SAME DOM the old flow layout did — `.poster-card[data-index/data-key]` (+inspected)
// with `.poster-av`, `.poster-meta` (.poster-name / .poster-handle /
// .poster-foot) — so the
// delegated click/dblclick/contextmenu on #posterGrid keeps
// firing. React renders + windows; viewer.js owns posterList, the count badge,
// the density classes on the container, and every event. The inspected
// highlight is derived from hologramStore, not modelOf (see below).
import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { posterClickBackground } from '../services/orchestrator.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// The inspected ring is derived straight from hologramStore's 'inspectedKey'
// (a real subscription) rather than riding on modelOf's closure-read model —
// see grid/Grid.tsx's Cell for the post-side twin of this.
const subInspected = (cb: () => void) => storeSubscribe('inspectedKey', cb);
const getInspected = () => (storeGet('inspectedKey') as string | null | undefined) ?? null;

// The poster cell model viewer.js resolves per card — only the fields laid out here.
interface PosterCardModel {
  index: number;
  /** Stable per-poster id (the user aggregate's key) — the density View Transition names cards by it. */
  posterKey?: string | null;
  inspected?: boolean;
  avatarSrc?: string | null;
  monogram?: string;
  monoHue?: number | null;
  name?: string;
  handle?: string | null;
  platform?: string | null;
  pfName?: string;
  countLabel?: string;
}

// 🏷 edit-tags button — ported 1:1 from viewer.js.
function _TagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  );
}

function PosterCard({ c }: { c: PosterCardModel }) {
  return (
    <div className={'poster-card' + (c.inspected ? ' inspected' : '')} data-index={c.index} data-key={c.posterKey} tabIndex={0}>
      <div className="poster-av">
        {c.avatarSrc ? (
          <img src={c.avatarSrc} alt="" loading="lazy" />
        ) : (
          // Circular monogram, not a card-filling letter (#107) — --mono-h carries the
          // per-poster hue the CSS tints the disc with (poster-grid-builder's monoHue).
          <span className="poster-mono" style={{ '--mono-h': c.monoHue ?? undefined } as CSSProperties}>
            {c.monogram}
          </span>
        )}
      </div>
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
    </div>
  );
}

// One windowed cell: build the card model lazily (only visible cells pay).
function PosterCell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const c = model.modelOf(data, index);
  c.inspected = data != null && data.key != null && inspectedKey === 'poster:' + data.key;
  return <PosterCard c={c} />;
}

// Background click (#242). No marquee sink: this grid has no selection, so the press
// has only its click half — the inspector, which both grids share, drops back to its
// placeholder. Late-bound (orchestrator assigns during init) and hoisted out of the
// render, since the host re-arms its gesture whenever the prop identity changes.
const onBackgroundClick = () => posterClickBackground();

export function PostersHost({ model }: { model: HologramGridModel }) {
  return <VirtualGridHost model={model} cell={PosterCell} onBackgroundClick={onBackgroundClick} />;
}
