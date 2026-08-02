// #179: the poll (survey) a saved post carried, rendered from the sidecar's
// `poll` sub-structure. Static by design -- the choices are results, not
// controls: nothing here can be clicked, and no vote is ever cast from the
// library (the Issue's own scope line, "投票 UI の再現はしない").
//
// Its own small component for the same reason QuotedPostCard.tsx is one: it
// sits under the post's body text and draws a shape none of the existing
// inspector rows have (a labelled bar per choice), rather than bending the
// Field/Fields "label: value" rhythm around it.
//
// The bar is a background fill behind the choice row, not a separate track
// element: the same way Mastodon and X render a closed poll, and it keeps the
// choice text readable at full width instead of squeezing it beside a gauge.
// Its colour is `foreground` at low alpha (the idiom already used elsewhere in
// this renderer) rather than a fixed light grey, so the fill stays legible in
// BOTH themes -- a light-grey fill measured oklch(0.97) against a white panel,
// which is a bar nobody can see.
import { BarChart3 } from 'lucide-react';

export function PollCard({ m }: { m: HologramPollCardModel }) {
  return (
    <div data-slot="poll-card" className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <BarChart3 aria-hidden="true" className="size-3" />
        <span>{m.label}</span>
      </div>
      <div className="flex flex-col gap-1">
        {m.choices.map((c, i) => (
          <div key={i} className="relative overflow-hidden rounded-md border border-border/60 px-2 py-1">
            {/* The width is clamped even though the model's percentage is not:
                a bar is a picture of a proportion and cannot be longer than its
                track, while the NUMBER stays whatever the platform's own
                figures work out to, so an inconsistent payload is visible as an
                odd percentage rather than silently rounded away. */}
            {c.percent != null ? <div className="absolute inset-y-0 left-0 bg-foreground/10" style={{ width: `${Math.min(100, Math.max(0, c.percent))}%` }} aria-hidden="true" /> : null}
            <div className="relative flex min-w-0 items-center gap-2 text-[12px] leading-snug">
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{c.text}</span>
              {c.votesLabel ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{c.votesLabel}</span> : null}
              {c.percentLabel ? <span className="shrink-0 tabular-nums font-medium">{c.percentLabel}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {m.metaLabel ? <div className="text-[11px] text-muted-foreground">{m.metaLabel}</div> : null}
    </div>
  );
}
