// #181: the OGP preview card a link-share post carries, rendered from the
// saved `linkCard` sub-record (never a live fetch — the thumbnail was
// downloaded at save time, same "no remote src on display" rule #180's
// QuotedPostCard follows for its own avatar). Its own small component for the
// same reason QuotedPostCard.tsx and PollCard.tsx are: it draws a shape (a
// thumbnail beside title/description/domain) none of the existing inspector
// rows have.
//
// Always clickable (m.onOpen is never absent — see globals.d.ts's
// HologramLinkCardModel comment): the whole point of a link card is the
// destination, so unlike QuotedPostCard's occasional non-clickable state
// (a url-less sub-record), this one always opens externally.
import { Link as LinkIcon } from 'lucide-react';

export function LinkCard({ m }: { m: HologramLinkCardModel }) {
  return (
    <div
      data-slot="link-card"
      className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-muted/50"
      role="button"
      tabIndex={0}
      onClick={m.onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          m.onOpen();
        }
      }}
    >
      {/* Icon + heading row, the same shape PollCard.tsx gives its own card, so
          the two sub-record cards under the body text read as one family. */}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <LinkIcon aria-hidden="true" className="size-3" />
        <span>{m.label}</span>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {m.thumbSrc ? <img data-slot="link-card-thumb" className="size-12 shrink-0 rounded-md border border-border object-cover" src={m.thumbSrc} alt="" /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[13px] leading-snug font-medium break-words">{m.title}</span>
          {m.description ? <span className="line-clamp-2 text-[12px] leading-snug text-muted-foreground break-words">{m.description}</span> : null}
          {m.domainLabel ? <span className="mt-0.5 text-[11px] text-muted-foreground">{m.domainLabel}</span> : null}
        </div>
      </div>
    </div>
  );
}
