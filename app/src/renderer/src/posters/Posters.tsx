// Virtualized poster grid — poster cells on the shared VirtualGridHost. React renders
// + windows and owns every gesture ON a card (#618: the gestures are props now, so the
// cells no longer carry a `data-index` for a delegated listener on the container to
// read back). orchestrator.ts still owns posterList, the count badge and the density
// classes. The inspected highlight is derived from hologramStore, not modelOf.
//
// The poster grid's own three-way density (card / tile / list) is NOT the post grid's
// display axes: re-conceiving it was scoped out of #618, so its cells keep the legacy
// `.poster-card` markup and CSS until that axis gets its own pass.
import type { CSSProperties } from 'react';
import { useSyncExternalStore } from 'react';
import { cellHandlers } from '../_shared/PostCard.tsx';
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

function PosterCard({ c, group, actions }: { c: PosterCardModel; group: unknown; actions?: HologramCardActions }) {
  return (
    <div data-slot="poster-card" className={'poster-card' + (c.inspected ? ' inspected' : '')} {...cellHandlers(actions, group)}>
      <div className="poster-av">
        {c.avatarSrc ? (
          // decoding="async" (#569): a virtualized grid can have many of these
          // decoding at once — same call as PostCard's card thumbnail.
          <img src={c.avatarSrc} alt="" loading="lazy" decoding="async" />
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
  return <PosterCard c={c} group={data} actions={model.cardActions} />;
}

// Background click (#242). No marquee sink: this grid has no selection, so the press
// has only its click half — the inspector, which both grids share, drops back to its
// placeholder. Late-bound (orchestrator assigns during init) and hoisted out of the
// render, since the host re-arms its gesture whenever the prop identity changes.
const onBackgroundClick = () => posterClickBackground();

export function PostersHost({ model }: { model: HologramGridModel }) {
  return <VirtualGridHost model={model} cell={PosterCell} onBackgroundClick={onBackgroundClick} />;
}
