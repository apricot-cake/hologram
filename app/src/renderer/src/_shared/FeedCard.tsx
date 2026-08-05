// The timeline cell (#183) — one saved post drawn as an SNS-style feed card:
// full-width body text leads, media follows, chrome is minimal. A third cell
// alongside PostCard.tsx (the grid) and ListRow.tsx (the scan-list row) — NOT a
// third density those two share, because a feed's job is the opposite of
// theirs: body text is the primary content (not a caption under a thumbnail),
// and a multi-image post scrolls sideways through every frame (not a 3-sheet
// peek). It reuses PostCard.tsx's exported parts the same way ListRow.tsx does
// (author line, thumbnail, chrome, selection ring) and adds only what a feed
// needs on top: the read-width cap, the expandable body, the image carousel,
// and the embedded quoted/reply-to card.
//
// Design record: GitHub issue #183 (2026-08-02 comment) — independent
// browseMode, not a layout variant; sort pinned to post-date descending
// upstream (services/orchestrator.ts's sortValue); month headers + the jump
// rail are the shared #47 date-sections pipeline, unmodified.
import { useLayoutEffect, useRef, useState } from 'react';
import { Reply } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { fileSrc } from '../services/asset-src.ts';
import { quotedCardModelOf } from '../services/records.ts';
import { QuotedPostCard } from '../inspector/QuotedPostCard.tsx';
import { AuthorLine, CardThumb, CountBadge, MetaFoot, SelectionRing, cellChrome, cellHandlers, type PostCellProps } from './PostCard.tsx';

// The read-width cap the 2026-08-02 design comment calls for ("自前の読み幅上限を
// 持ち、中央寄せする") — no existing shared variable to reuse: list-view's row is
// full-bleed with no cap of its own (the #27 760px figure that comment's first
// draft pointed at belongs to a layout that was retired before this shipped).
// A first-cut figure, meant to move once this is on screen with a real library.
const FEED_READ_WIDTH = 600;

// Body text: clamped to a fixed line count with a non-persistent "show more"
// (2026-08-02 design comment's accept criteria 4) — expanding never survives a
// remount, the same way the grid's own text never remembers a scroll state.
// Whether the clamp actually cut anything is measured (scrollHeight vs
// clientHeight) rather than guessed from length, so the button never appears
// over text that already fits.
function FeedBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  // text isn't read in the body below, but it IS what the measured DOM content
  // renders — a recycled cell (virtualization) handed a new post needs this to
  // re-measure.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setClamped(el.scrollHeight - el.clientHeight > 1);
  }, [text]);
  return (
    <div data-slot="feed-card-text">
      <p ref={ref} className={cn('whitespace-pre-wrap text-[14px] text-[var(--text)] leading-relaxed', !expanded && 'line-clamp-5')}>
        {text}
      </p>
      {!expanded && clamped && (
        <button
          type="button"
          className="mt-1 text-[12px] font-medium text-primary hover:underline"
          onClick={(e) => {
            // The button sits inside the card's own onClick (select/inspect) —
            // without this, expanding the text would also fire that selection.
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          {t('timelineReadMore')}
        </button>
      )}
    </div>
  );
}

// A grouped post's images, scrolled sideways rather than peeked at through
// PostCard's back-stack sheets (#183 accept criteria 5) — the peek illusion
// answers "there is more than one", a feed wants to actually show them. Plain
// <img> per frame (group.files carries every artwork page — records.ts's
// groupFilesOf); video/gif frames inside a group are the rare case and fall
// back to their still, same as a stack sheet would.
function FeedCarousel({ files, n }: { files: string[]; n: number }) {
  return (
    <div data-slot="feed-card-carousel" className="relative">
      <div className="flex snap-x snap-mandatory gap-1.5 overflow-x-auto rounded-lg">
        {files.map((f, i) => (
          <img key={f + i} src={fileSrc(f, 640)} alt="" loading={i === 0 ? 'eager' : 'lazy'} decoding="async" className="h-72 w-auto shrink-0 snap-start rounded-md object-cover" />
        ))}
      </div>
      {n > 1 && <CountBadge n={n} top={8} />}
    </div>
  );
}

export function FeedCard({ m, shape, group, actions, cellRef, onAspect }: PostCellProps) {
  const g = group as HologramPostGroup;
  const rep = g.rep;
  const grouped = (m.nImg as number) > 1;
  const quoted = quotedCardModelOf(rep.quotedPost, 'quote', t);
  // #183's 2026-08-02 comment: a reply-to does NOT get the full embedded card a
  // quote does — just a one-line "in reply to X" header, so a reply-heavy
  // timeline doesn't read as a wall of nested cards. Built from the same pure
  // mapping (quotedCardModelOf) so the name it shows can never drift from what
  // the inspector's full card would have said.
  const reply = quotedCardModelOf(rep.replyToPost, 'reply', t);
  return (
    <div ref={cellRef} data-slot="feed-card" data-selected={m.selected || undefined} data-inspected={m.inspected || undefined} className={cn(cellChrome(m, false), 'mx-auto flex w-full flex-col gap-2.5 rounded-lg p-4')} style={{ maxWidth: FEED_READ_WIDTH }} {...cellHandlers(actions, group)}>
      {shape.info && (
        <>
          {reply && (
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--text-subtle)]">
              <Reply className="size-3.5 shrink-0" />
              <span className="shrink-0">{reply.label}</span>
              <span className="truncate font-medium text-[var(--text)]">{reply.displayName}</span>
              {reply.screenNameLabel && <span className="min-w-0 truncate">{reply.screenNameLabel}</span>}
            </div>
          )}
          <AuthorLine userName={m.userName} handle={m.handle} avatar={shape.avatar ? m : null} className="font-semibold text-[14px]" />
        </>
      )}
      {quoted && <QuotedPostCard m={quoted} />}
      {m.text && <FeedBody text={m.text} />}
      {grouped ? <FeedCarousel files={g.files} n={m.nImg as number} /> : m.hasThumb && <CardThumb m={m} shape={shape} onAspect={onAspect} className="overflow-hidden rounded-lg" imgClassName="block max-h-[520px] w-full object-cover" />}
      {shape.info && <MetaFoot m={m} />}
      {shape.info && m.tags.length > 0 && (
        <div className="flex flex-wrap gap-[3px]">
          {m.tags.map((tag) => (
            <span key={tag} className="rounded-[10px] bg-[var(--surface-3)] px-2 py-px text-[10px] text-[var(--text-muted)]">
              {tag}
            </span>
          ))}
        </div>
      )}
      {m.selected && <SelectionRing />}
    </div>
  );
}
