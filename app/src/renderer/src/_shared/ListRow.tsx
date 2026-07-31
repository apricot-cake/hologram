// The list cell (#618) — the same saved post as PostCard, laid out as a row.
//
// A row is not a squashed card: it exists because the POST TEXT is what you scan in a
// list, so the text leads at full width and everything else is a quiet second line
// (GitHub's issue rows, Linear's list, Bluesky's timeline all read this way). The card's
// grid furniture — post-type flags, tag chips, the ×N badge over the thumbnail — is left
// out rather than shrunk; the row's width is spent on the sentence.
//
// Same rules as the card: no hover parts, no DOM contract, gestures as props.
import { cn } from '@/lib/utils';
import { AuthorLine, CardThumb, cellChrome, cellHandlers, MetaFoot, SelectionRing, StackSheets, type PostCellProps } from './PostCard.tsx';

/** The count that the card carries as a badge — a row has room to just say it. */
function CountLabel({ n }: { n: number }) {
  return <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-subtle)] tabular-nums">{'×' + n}</span>;
}

export function ListRow({ m, shape, group, actions, cellRef, listThumb = 88 }: PostCellProps & { listThumb?: number }) {
  const grouped = (m.nImg as number) > 1;
  const stack = grouped ? (m.stackSrcs ?? []) : [];
  return (
    <div ref={cellRef} data-slot="post-card" data-list-row="" data-selected={m.selected || undefined} data-inspected={m.inspected || undefined} className={cn(cellChrome(m, grouped), 'flex w-full items-stretch rounded-md')} style={grouped ? { paddingTop: 10 } : undefined} {...cellHandlers(actions, group)}>
      {grouped && <StackSheets shape={shape} srcs={stack} imgBox="inset-y-0 left-0 rounded-r-none" imgStyle={{ width: listThumb }} />}
      {m.hasThumb && (
        <CardThumb
          m={m}
          shape={shape}
          className="relative shrink-0 self-stretch overflow-hidden rounded-l-md"
          imgClassName="block h-full w-full cursor-zoom-in object-cover"
          // The thumbnail column IS the list's size axis, so its width is the model's,
          // not a class — one number, driven by the display popover's slider. Its
          // height is a crop of that width, NOT the picture's own proportions: a row
          // whose height follows its thumbnail makes the list a ragged column, and the
          // point of a list is that the rows scan.
          style={{ flex: `0 0 ${listThumb}px`, width: listThumb, height: Math.round(listThumb * 1.25) }}
        />
      )}
      <div data-slot="post-card-meta" className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-r-md bg-[var(--surface)] px-3.5 py-2.5">
        {m.text && <div className="line-clamp-2 text-[14px] text-[var(--text-strong)] leading-[1.45]">{m.text}</div>}
        <div className="flex min-w-0 items-center gap-2.5 text-[12px] text-[var(--text-muted)]">
          <AuthorLine userName={m.userName} handle={m.handle} className="max-w-[40%] shrink-0 font-medium" />
          {grouped && <CountLabel n={m.nImg as number} />}
          <MetaFoot m={m} className="min-w-0 flex-1" />
        </div>
      </div>
      {m.selected && <SelectionRing />}
    </div>
  );
}
