// 保存した引用元の本文とメディアを表示する。返信先は本文のみ。
import { ImageIcon, MessageSquareQuote, Reply } from 'lucide-react';
import { Avatar } from '@/_shared/PostCard';
import { cn } from '@/lib/utils';

export function QuotedPostCard({ m }: { m: HologramQuotedCardModel }) {
  const Icon = m.kind === 'reply' ? Reply : MessageSquareQuote;
  const clickable = !!m.onOpen;
  return (
    <div data-slot="quoted-post-card" data-kind={m.kind} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Icon aria-hidden="true" className="size-3" />
        <span>{m.label}</span>
      </div>
      <button type="button" onClick={m.onOpen} disabled={!clickable} className="flex min-w-0 items-center gap-1.5 text-left hover:underline">
        <Avatar c={{ avatarSrc: m.avatarSrc, monogram: m.monogram, monoHue: m.monoHue }} className="size-5 rounded-full" discClassName="size-5 text-[10px]" />
        <span className="min-w-0 truncate text-xs font-medium">{m.displayName}</span>
        {m.screenNameLabel ? <span className="min-w-0 truncate text-xs text-muted-foreground">{m.screenNameLabel}</span> : null}
        {m.dateLabel ? <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{m.dateLabel}</span> : null}
      </button>
      {m.cw ? <div className="text-[11px] text-muted-foreground">{m.cw}</div> : null}
      {m.text ? <p className="line-clamp-4 text-[13px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p> : null}
      {m.media?.length ? (
        <div className="grid grid-cols-2 gap-1">
          {m.media.map((media, i) => (
            <button
              key={media.src}
              type="button"
              className={cn('overflow-hidden rounded-md', m.media?.length === 1 && 'col-span-2')}
              aria-label={`${m.label} ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                media.onOpen();
              }}
            >
              {media.video ? <video src={media.src} preload="metadata" className="max-h-64 w-full object-contain" /> : <img src={media.src} alt={media.alt} className="max-h-64 w-full object-contain" />}
            </button>
          ))}
        </div>
      ) : null}
      {m.mediaCountLabel ? (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <ImageIcon aria-hidden="true" className="size-3" />
          <span>{m.mediaCountLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
