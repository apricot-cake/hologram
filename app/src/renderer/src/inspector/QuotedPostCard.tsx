// #180: the embedded card for a quoted/renoted or (Misskey-only) replied-to
// post — rendered from the saved `quotedPost`/`replyToPost` sidecar
// sub-record (never a live fetch). Deliberately its OWN small component
// rather than reusing PostCard.tsx's card body or Inspector.tsx's TextSection:
// #290 (custom-emoji body rendering) is in flight against those two body-text
// lines, so this card gets a line of its own rather than one more line those
// call sites would also need to touch.
//
// Style follows #365's "one platform-agnostic card" decision (no X/Bluesky-
// style mimicry) even though #365 itself isn't built yet — this is the only
// surface #180's design landed the card on (Inspector), so it draws its own
// version of that shape rather than waiting on #365's tile.
//
// v1 stays metadata-only (#290's line, reaffirmed for quotes by the 2026-07-27
// design comment on #180): media is never downloaded and the avatar is never
// fetched from its remote URL, so this component takes no `avatarSrc` other
// than null — the monogram fallback (Avatar, _shared/PostCard.tsx) is the ONLY
// avatar a quoted/replied-to author ever gets.
import { ImageIcon, MessageSquareQuote, Reply } from 'lucide-react';
import { Avatar } from '@/_shared/PostCard';
import { cn } from '@/lib/utils';

export function QuotedPostCard({ m }: { m: HologramQuotedCardModel }) {
  const Icon = m.kind === 'reply' ? Reply : MessageSquareQuote;
  const clickable = !!m.onOpen;
  return (
    <div
      data-slot="quoted-post-card"
      data-kind={m.kind}
      className={cn('flex flex-col gap-1.5 rounded-lg border border-border p-2.5', clickable && 'cursor-pointer hover:bg-muted/50')}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={m.onOpen}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                m.onOpen?.();
              }
            }
          : undefined
      }
    >
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon aria-hidden="true" className="size-3" />
        <span>{m.label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <Avatar c={{ avatarSrc: m.avatarSrc, monogram: m.monogram, monoHue: m.monoHue }} className="size-5 rounded-full" discClassName="size-5 text-[10px]" />
        <span className="min-w-0 truncate text-xs font-medium">{m.displayName}</span>
        {m.screenNameLabel ? <span className="min-w-0 truncate text-xs text-muted-foreground">{m.screenNameLabel}</span> : null}
        {m.dateLabel ? <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{m.dateLabel}</span> : null}
      </div>
      {m.cw ? <div className="text-[11px] text-muted-foreground">{m.cw}</div> : null}
      {m.text ? <p className="line-clamp-4 text-[13px] leading-snug break-words whitespace-pre-wrap">{m.text}</p> : null}
      {m.mediaCountLabel ? (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <ImageIcon aria-hidden="true" className="size-3" />
          <span>{m.mediaCountLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
