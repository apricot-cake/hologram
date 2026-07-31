// Virtualized poster grid — poster cells on the shared VirtualGridHost. React renders
// + windows and owns every gesture ON a card (#618: the gestures are props now, so the
// cells no longer carry a `data-index` for a delegated listener on the container to
// read back). orchestrator.ts still owns posterList and the count badge. The inspected
// highlight is derived from hologramStore, not modelOf.
//
// Which cell a poster is drawn as comes from the model's poster shape (#630) — grid or
// row, and for the grid whether the metadata block is there. No density class on the
// container decides it in CSS any more; the legacy `.poster-card` sheet is gone and
// both cells are Tailwind, like the post side's.
import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { Avatar, cellChrome, cellHandlers } from '../_shared/PostCard.tsx';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import type { PosterShape } from '../services/display.ts';
import { posterClickBackground } from '../services/orchestrator.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// The inspected ring is derived straight from hologramStore's 'inspectedKey'
// (a real subscription) rather than riding on modelOf's closure-read model —
// see grid/Grid.tsx's Cell for the post-side twin of this.
const subInspected = (cb: () => void) => storeSubscribe('inspectedKey', cb);
const getInspected = () => (storeGet('inspectedKey') as string | null | undefined) ?? null;

// The poster cell model poster-grid-builder resolves per card — only the fields laid
// out here. Deliberately NOT here: a last-saved date. HologramUserAgg does not carry
// one, and inventing it would be a data-side change rather than a display one (#630).
interface PosterCardModel {
  index: number;
  inspected?: boolean;
  avatarSrc?: string | null;
  monogram?: string | null;
  monoHue?: number | null;
  name?: string;
  handle?: string | null;
  platform?: string | null;
  pfName?: string | null;
  countLabel?: string;
}

// Platform dot colour. The tokens stay in design-tokens.css (they are the brand
// palette); the platform→token lookup is here because a class per platform was the
// last thing keeping a poster stylesheet alive.
const PF_COLOR: Record<string, string> = {
  x: 'var(--brand-x)',
  bluesky: 'var(--brand-bluesky)',
  misskey: 'var(--brand-misskey)',
  mastodon: 'var(--brand-mastodon)',
  pixiv: 'var(--brand-pixiv)',
};

function PlatformTag({ platform, pfName, className }: { platform?: string | null; pfName?: string | null; className?: string }) {
  if (!platform) return null;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-[5px] whitespace-nowrap text-[10px] uppercase tracking-[0.04em]', className)}>
      <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full" style={{ background: PF_COLOR[platform] || 'var(--text-muted)' }} />
      <span className="truncate">{pfName}</span>
    </span>
  );
}

/**
 * The grid cell: an avatar-led card. With 情報を表示 off it is the avatar and nothing
 * else — that IS the overview (#141), the poster-side twin of a bare thumbnail grid,
 * and the reason the layout can call the cell square.
 */
function PosterCard({ c, shape, group, actions }: { c: PosterCardModel; shape: PosterShape; group: unknown; actions?: HologramCardActions }) {
  return (
    <div data-slot="poster-card" data-inspected={c.inspected || undefined} className={cn(cellChrome(c, false), 'flex w-full flex-col rounded-lg')} {...cellHandlers(actions, group)}>
      <Avatar c={c} className="aspect-square w-full" discClassName="size-[44cqw] text-[19cqw]" />
      {shape.info && (
        <div data-slot="poster-card-meta" className="flex min-w-0 flex-col gap-px px-[11px] pt-[9px] pb-2.5">
          <div className="truncate font-semibold text-[13.5px] text-[var(--text)]">{c.name}</div>
          {c.handle && <div className="truncate text-[11.5px] text-[var(--text-muted)]">@{c.handle}</div>}
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <PlatformTag platform={c.platform} pfName={c.pfName} className="text-[var(--text-muted)]" />
            <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] text-[var(--text-subtle)]">{c.countLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The list cell: a full-width row. What it shows is everything the poster roll-up
 * already knows — small avatar, display name, @handle, platform, saved count — which
 * is also how GitHub's contributor rows, Linear's member rows and Mastodon's follow
 * list read: avatar + name + handle + one number.
 */
function PosterRow({ c, group, actions }: { c: PosterCardModel; group: unknown; actions?: HologramCardActions }) {
  return (
    <div data-slot="poster-card" data-list-row="" data-inspected={c.inspected || undefined} className={cn(cellChrome(c, false), 'flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] shadow-none')} {...cellHandlers(actions, group)}>
      <Avatar c={c} className="size-9 rounded-full border border-[var(--border-soft)]" discClassName="size-full text-[15px]" />
      <div data-slot="poster-card-meta" className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate font-semibold text-[13.5px] text-[var(--text)]">{c.name}</span>
        {c.handle && <span className="min-w-0 shrink truncate text-[11.5px] text-[var(--text-muted)]">@{c.handle}</span>}
      </div>
      <PlatformTag platform={c.platform} pfName={c.pfName} className="shrink-0 text-[var(--text-muted)]" />
      <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-subtle)] tabular-nums">{c.countLabel}</span>
    </div>
  );
}

// One windowed cell: build the card model lazily (only visible cells pay).
function PosterCell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const shape = model.posterShape as PosterShape;
  const c = model.modelOf(data, index);
  c.inspected = data != null && data.key != null && inspectedKey === 'poster:' + data.key;
  if (shape?.list) return <PosterRow c={c} group={data} actions={model.cardActions} />;
  return <PosterCard c={c} shape={shape} group={data} actions={model.cardActions} />;
}

// Background click (#242). No marquee sink: this grid has no selection, so the press
// has only its click half — the inspector, which both grids share, drops back to its
// placeholder. Late-bound (orchestrator assigns during init) and hoisted out of the
// render, since the host re-arms its gesture whenever the prop identity changes.
const onBackgroundClick = () => posterClickBackground();

export function PostersHost({ model }: { model: HologramGridModel }) {
  return <VirtualGridHost model={model} cell={PosterCell} onBackgroundClick={onBackgroundClick} />;
}
