// The grid cell (#618) — one saved post, drawn at whatever shape the display axes
// are set to. Its list-layout twin is ListRow.tsx; both take the same model, which
// records.ts's makeCardModel resolves into primitives (image src, formatted counts
// and dates) so this file only lays things out.
//
// Two things this card deliberately does NOT have:
//
//  - **Hover parts.** No ℹ button, no 🏷 button, no ○ select ring, no hover highlight
//    (確定A, Eagle 純型). Everything a card can do is reached by selecting it (click /
//    Ctrl / Shift) or by its context menu. Hovering only lifts the card, which is
//    feedback, not a control.
//  - **A DOM contract.** The old markup carried `data-index` / `data-key` /
//    `data-url` / `data-cap` because delegated listeners on the grid container read
//    them back out to find the group a click belonged to (#153 categories 1 and 2).
//    The gestures are props now and close over the group itself, so those attributes
//    have nothing left to answer. `data-slot` stays — that is shadcn's own marker for
//    "which part of the component is this", and it is what the tests read.
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';
import type { DisplayShape } from '../services/display.ts';

// The cell model makeCardModel resolves per card — only the fields laid out here.
export interface PostCardFootDate {
  label: string;
  title?: string | null;
}
export interface PostCardModel {
  index: number;
  postKey?: string | null;
  selected?: boolean;
  inspected?: boolean;
  hasThumb?: boolean;
  imgSrc?: string | null;
  /** An mp4-backed GIF this shape loops in place instead of showing a still (#476). */
  videoSrc?: string | null;
  /** Its poster still, painted until the first frame decodes. */
  videoPoster?: string | null;
  /** Video/gif(mp4) lead media: overlay a ▶ badge on the poster thumbnail (#119 St1). */
  videoBadge?: boolean;
  captureId?: string;
  aspRatio?: string | null;
  eager?: boolean;
  nImg?: number;
  /** Thumb srcs for the 2nd/3rd images of a multi-image group — they ride the back sheets. */
  stackSrcs?: string[];
  userName?: string;
  /** Real avatar image (#658) — draws in AuthorLine when the shape's avatar switch is on. */
  avatarSrc?: string | null;
  /** Fallback-avatar initial, when there is no avatarSrc. */
  monogram?: string | null;
  /** Fallback-avatar hue, when there is no avatarSrc. */
  monoHue?: number | null;
  handle?: string | null;
  flags: string[];
  mediaLabel?: string | null;
  text?: string | null;
  stats: Partial<Record<string, string | number | null>>;
  footDates: { post?: PostCardFootDate | null; cap?: PostCardFootDate | null };
  tags: string[];
}

export interface PostCellProps {
  m: PostCardModel;
  shape: DisplayShape;
  /** The small end of the size axis (#141): a cell is all thumbnail, so no badge over it. */
  overview?: boolean;
  /** The group this cell draws — handed straight back to whichever action fires. */
  group: unknown;
  actions?: HologramCardActions;
  cellRef?: Ref<HTMLDivElement>;
  /** Reports a loaded image's natural aspect for cells that reserved no height. */
  onAspect?: (captureId: string, aspectRatio: string) => void;
}

// Engagement stat glyphs: outline TEXT presentation (not color emoji, not SVG).
const STAT_GLYPH = {
  likes: '♡', // heart
  reposts: '⇄', // repost
  replies: '🗨︎', // reply (text presentation)
  bookmarks: '🔖︎', // bookmark (text presentation)
};
const STAT_ORDER = ['likes', 'reposts', 'replies', 'bookmarks'] as const;

// 📷 capture-date mark next to the secondary (captured) date.
function CdateIcon() {
  return (
    <svg className="shrink-0" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

// --- Multi-image deck -------------------------------------------------------
// A group of images is drawn as the card ITSELF duplicated: rotated-back sheets
// peek out of a band along the card's top edge, inside its own footprint (so the
// layout gutter pays nothing and the peek survives any cell size). Geometry is
// per-shape; s1 is the backmost sheet and fills the band from the very top, so a
// ×2 group reads as one clean step with no empty strip.
function deckGeometry(shape: DisplayShape) {
  if (shape.list) return { deck: 10, s1: 'scale(0.997, 0.8)', s2: 'translateY(5px) scale(0.999, 0.9)' };
  if (shape.square) return { deck: 13, s1: 'scale(0.92)', s2: 'translateY(6px) scale(0.955)' };
  return { deck: 15, s1: 'scale(0.93)', s2: 'translateY(7px) scale(0.965)' };
}

/**
 * The back sheets plus the front face's re-cast edge. Rendered by both cells, so the
 * pile reads the same whichever shape it is in. `imgBox` is the sheet's thumbnail
 * slice — the card's own anatomy in miniature (image on top for a grid cell, image
 * down the left for a row).
 */
export function StackSheets({ shape, srcs, imgBox, imgStyle }: { shape: DisplayShape; srcs: string[]; imgBox: string; imgStyle?: CSSProperties }) {
  const g = deckGeometry(shape);
  const radius = shape.list ? 'rounded-md' : 'rounded-lg';
  return (
    <>
      {srcs.map((src, k) => (
        <span key={src || k} aria-hidden="true" className={cn('pointer-events-none absolute inset-0 origin-top overflow-hidden border border-[var(--border-strong)] bg-[var(--surface)] shadow-[var(--shadow-md)]', radius, k === 0 ? '-z-[2]' : '-z-[1]')} style={{ transform: k === 0 ? g.s1 : g.s2 }}>
          {src && (
            <span className={cn('absolute bg-center bg-cover', imgBox, radius)} style={{ backgroundImage: `url("${src}")`, ...imgStyle }}>
              {/* Depth dim on the IMAGE only: a stepped deck of near-white line art
                  needs the tint to read as layers, but a dimmed sheet BODY would show
                  as a gray band across a row's top edge. */}
              <span className="absolute inset-0 rounded-[inherit]" style={{ background: `color-mix(in srgb, var(--text) ${k === 0 ? 15 : 8}%, transparent)` }} />
            </span>
          )}
        </span>
      ))}
      {/* The front face's own edge, re-cast ABOVE the negative-z sheets (a box-shadow
          on the card paints UNDER them — CSS paint order) and starting at the band's
          bottom, so the face reads as sitting ON the pile. */}
      <span aria-hidden="true" className={cn('pointer-events-none absolute right-[-1px] bottom-[-1px] left-[-1px] z-0 shadow-[0_0_0_1px_var(--border-strong),0_2px_8px_rgba(16,19,26,0.18)] dark:shadow-[0_0_0_1px_var(--border-strong),0_2px_8px_rgba(0,0,0,0.55)]', radius)} style={{ top: g.deck }} />
    </>
  );
}

/** ×N badge — the precise count behind the deck's "there is more than one" hint. */
export function CountBadge({ n, top }: { n: number; top: number }) {
  return (
    <div className="absolute left-2 z-[1] rounded bg-black/70 px-[7px] py-0.5 font-semibold text-[11px] text-white" style={{ top }}>
      {'×' + n}
    </div>
  );
}

export interface AvatarModel {
  avatarSrc?: string | null;
  monogram?: string | null;
  monoHue?: number | null;
}

/**
 * Circular avatar with a GitHub/Google-style fallback monogram disc (#107) when
 * there is no image — an initial on a pale hue-hashed disc (only the HUE varies
 * per identity; each theme pins its own saturation/lightness). Shared by post
 * cards, poster cards (#630) and AuthorLine (#658) so an avatar-less identity
 * reads the same everywhere.
 */
export function Avatar({ c, className, discClassName }: { c: AvatarModel; className?: string; discClassName?: string }) {
  return (
    <div className={cn('@container flex shrink-0 items-center justify-center overflow-hidden bg-[var(--surface-3)]', className)}>
      {c.avatarSrc ? (
        <img className="block size-full object-cover" src={c.avatarSrc} alt="" loading="lazy" decoding="async" />
      ) : (
        <span
          className={cn('flex items-center justify-center rounded-full font-semibold leading-none', 'bg-[hsl(var(--mono-h,220)_52%_88%)] text-[hsl(var(--mono-h,220)_42%_32%)]', 'dark:bg-[hsl(var(--mono-h,220)_26%_27%)] dark:text-[hsl(var(--mono-h,220)_50%_78%)]', discClassName)}
          style={{ '--mono-h': c.monoHue ?? undefined } as CSSProperties}
        >
          {c.monogram}
        </span>
      )}
    </div>
  );
}

/** The poster line every shape shares: an optional avatar, display name, then the @handle it goes by. */
export function AuthorLine({ userName, handle, avatar, className }: { userName?: string; handle?: string | null; avatar?: AvatarModel | null; className?: string }) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      {avatar && <Avatar c={avatar} className="size-5 rounded-full border border-[var(--border-soft)]" discClassName="size-full text-[10px]" />}
      <span className="truncate">{userName}</span>
      {handle && <span className="min-w-0 flex-1 truncate font-normal text-[11px] text-[var(--text-subtle)]">{handle}</span>}
    </div>
  );
}

/** Engagement counts (when relevant) on the left, the post's date on the right. */
export function MetaFoot({ m, className }: { m: PostCardModel; className?: string }) {
  const stats = STAT_ORDER.filter((k) => m.stats[k] != null);
  const fd = m.footDates;
  if (!stats.length && !fd.post && !fd.cap) return null;
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      {stats.length > 0 && (
        <div data-slot="post-card-stats" className="flex gap-2.5 text-[11.5px] text-[var(--text-subtle)]">
          {stats.map((k) => (
            <span className="inline-flex items-center gap-[3px]" key={k}>
              {STAT_GLYPH[k] + ' ' + m.stats[k]}
            </span>
          ))}
        </div>
      )}
      <span className="ml-auto inline-flex min-w-0 items-center gap-[7px] text-[11px] text-[var(--text-subtle)]">
        {fd.post && (
          <span data-slot="post-card-date" title={fd.post.title || undefined}>
            {fd.post.label}
          </span>
        )}
        {fd.cap && (
          <span data-slot="post-card-capdate" className="inline-flex items-center gap-0.5 opacity-80" title={fd.cap.title || undefined}>
            <CdateIcon />
            {fd.cap.label}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * The thumbnail. An mp4-backed GIF takes the same slot as a still and loops there;
 * a post whose media never downloaded gets a ▶ placeholder rather than a hole.
 * `muted` is what makes autoplay legal at all (Chromium never blocks a silent one);
 * `loop`+`playsInline` and no `controls` keep it reading as the GIF it is. Only the
 * scrolled window is mounted, so what plays is bounded by the viewport.
 */
export function CardThumb({ m, shape, onAspect, className, imgClassName, style: boxStyle }: { m: PostCardModel; shape: DisplayShape; onAspect?: (captureId: string, aspectRatio: string) => void; className?: string; imgClassName?: string; style?: CSSProperties }) {
  const style = m.aspRatio ? { aspectRatio: m.aspRatio } : undefined;
  return (
    <div data-slot="post-card-thumb" className={cn('relative block leading-[0]', className)} style={boxStyle}>
      {m.videoSrc ? (
        // draggable is spelled out: <video> is not draggable by default, and the
        // drag-out gesture (#132) is armed on the media itself.
        <video data-slot="post-card-media" className={imgClassName} src={m.videoSrc} poster={m.videoPoster || undefined} style={style} autoPlay muted loop playsInline draggable disablePictureInPicture />
      ) : m.imgSrc ? (
        <>
          <img
            data-slot="post-card-media"
            className={imgClassName}
            src={m.imgSrc}
            alt=""
            style={style}
            loading={m.eager ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={
              // Only cells that reserved NO height have anything to learn (原比率
              // グリッド with no shotW/H and no cached aspect); the rest already know.
              onAspect && !m.aspRatio && m.captureId && !shape.list && !shape.square
                ? (e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) onAspect(m.captureId as string, `${img.naturalWidth}/${img.naturalHeight}`);
                  }
                : undefined
            }
          />
          {m.videoBadge && (
            <span data-slot="post-card-play" aria-hidden="true" className="absolute right-1.5 bottom-1.5 z-[1] flex size-[22px] items-center justify-center rounded-full bg-black/70 text-[10px] text-white">
              {'▶'}
            </span>
          )}
        </>
      ) : (
        <div data-slot="post-card-media" className={cn('flex items-center justify-center bg-[var(--surface-2)] text-[30px] text-[var(--text-muted)]', imgClassName)} draggable>
          {'▶'}
        </div>
      )}
    </div>
  );
}

/** Turns the grid model's action set into the props a cell root spreads. */
export function cellHandlers(actions: HologramCardActions | undefined, group: unknown) {
  if (!actions) return {};
  return {
    onClick: actions.onClick && ((e: ReactMouseEvent) => actions.onClick?.(group, e)),
    onDoubleClick: actions.onDoubleClick && ((e: ReactMouseEvent) => actions.onDoubleClick?.(group, e)),
    onAuxClick: actions.onAuxClick && ((e: ReactMouseEvent) => actions.onAuxClick?.(group, e)),
    onContextMenu: actions.onContextMenu && ((e: ReactMouseEvent) => actions.onContextMenu?.(group, e)),
    onMouseDown: actions.onMouseDown && ((e: ReactMouseEvent) => actions.onMouseDown?.(group, e)),
    onDragStart: actions.onDragStart && ((e: ReactDragEvent) => actions.onDragStart?.(group, e)),
  };
}

/**
 * Shared card chrome: the surface, the hover lift, and the selected/inspected rings.
 * Takes only what it reads, so the poster cells (#630) wear the same chrome as the
 * post ones rather than a second copy of the same six declarations.
 */
export function cellChrome(m: { inspected?: boolean }, grouped: boolean): string {
  return cn(
    'group relative cursor-pointer overflow-hidden border border-[var(--border-subtle)] bg-[var(--surface)] shadow-[var(--shadow-sm)]',
    'transition-[box-shadow,border-color,transform] duration-[var(--dur-hover)] ease-[var(--ease-out)]',
    // Picked up: deeper shadow plus a rise-and-slight-grow (Pinterest/gallery idiom).
    // z-index raises it above its neighbours so the grow is not clipped.
    'hover:z-[1] hover:translate-y-[-3px] hover:scale-[1.014] hover:border-[var(--border)] hover:shadow-[var(--shadow-md)]',
    'motion-reduce:hover:transform-none',
    // A grouped card is a pile: the sheets and the re-cast edge carry every border
    // and shadow, so the card box itself steps back to nothing.
    grouped && 'overflow-visible border-transparent bg-transparent shadow-none hover:shadow-none',
    m.inspected && 'border-[var(--accent-border)] shadow-[0_0_0_1px_var(--accent-border)]',
  );
}

/**
 * The selection ring, as an OVERLAY rather than a ring/outline on the card box. Both of
 * those paint under the thumbnail (a card is its own stacking context and the image sits
 * on top), so the ring came out thinner over the picture than over the metadata —
 * reported on the old build, and the reason this has always been a positioned element.
 */
export function SelectionRing() {
  return <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-[6] rounded-[inherit] border-[3px] border-selected/45" />;
}

export function PostCard({ m, shape, overview, group, actions, cellRef, onAspect }: PostCellProps) {
  const grouped = (m.nImg as number) > 1;
  const g = deckGeometry(shape);
  const stack = grouped ? (m.stackSrcs ?? []) : [];
  const showBadge = grouped && !overview;
  const info: ReactNode = shape.info && (
    // Square thumbnails are chosen to get an EVEN lattice, so the block under them is
    // a fixed height (INFO_BLOCK) rather than one that grows with the text — otherwise
    // the squares line up and the cards below them do not. At the original aspect
    // nothing is even anyway, so there the block just takes what it needs.
    <div data-slot="post-card-meta" className={cn('relative flex min-w-0 flex-1 flex-col rounded-b-lg bg-[var(--surface)] p-3', shape.square && 'h-24 overflow-hidden')}>
      <AuthorLine userName={m.userName} handle={m.handle} avatar={shape.avatar ? m : null} className="mb-1 font-semibold text-[13px]" />
      {(m.flags.length > 0 || m.mediaLabel) && (
        <div className="mb-[3px] flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-muted)] leading-[1.6]">
          {m.flags.map((f) => (
            <span key={f}>{f}</span>
          ))}
          {m.mediaLabel && <span>{m.mediaLabel}</span>}
        </div>
      )}
      {m.text && <div className={cn('mb-1.5 text-[13px] text-[var(--text)]', shape.square ? 'line-clamp-1' : 'line-clamp-3')}>{m.text}</div>}
      {/* Pinned to the bottom edge so the date lines up across a row of cards of
          different text lengths. */}
      <MetaFoot m={m} className="mt-auto pt-1.5" />
      {m.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-[3px]">
          {m.tags.map((tag) => (
            <span key={tag} className="rounded-[10px] bg-[var(--surface-3)] px-2 py-px text-[10px] text-[var(--text-muted)]">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
  return (
    <div ref={cellRef} data-slot="post-card" data-selected={m.selected || undefined} data-inspected={m.inspected || undefined} className={cn(cellChrome(m, grouped), 'flex w-full flex-col rounded-lg')} style={grouped ? { paddingTop: g.deck } : undefined} {...cellHandlers(actions, group)}>
      {grouped && <StackSheets shape={shape} srcs={stack} imgBox={shape.square ? 'inset-0' : 'inset-x-0 top-0 bottom-[44%]'} />}
      {m.hasThumb && (
        <CardThumb
          m={m}
          shape={shape}
          onAspect={onAspect}
          className={cn('overflow-hidden', shape.square && 'aspect-square w-full', shape.info ? 'rounded-t-lg' : 'rounded-lg')}
          imgClassName={cn('block w-full cursor-zoom-in object-cover transition-transform duration-500 ease-[var(--ease-out)] group-hover:scale-[1.055] motion-reduce:transform-none', shape.square ? 'h-full max-h-none' : 'max-h-[300px]')}
        />
      )}
      {showBadge && <CountBadge n={m.nImg as number} top={(grouped ? g.deck : 0) + 8} />}
      {info}
      {m.selected && <SelectionRing />}
    </div>
  );
}
