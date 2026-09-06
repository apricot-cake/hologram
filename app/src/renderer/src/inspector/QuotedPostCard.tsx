// #180: 引用・リポストされた投稿、または返信先の投稿を埋め込むカード。
// 保存済みのサイドカーの下位レコード `quotedPost`/`replyToPost` から描く（その場で取りに
// 行くことはしない）。PostCard.tsx のカード本体や Inspector.tsx の TextSection を使い回さず、
// 意図して小さな独立したコンポーネントにしてある。#290（カスタム絵文字の本文描画）が
// あの2本の本文テキストの行に対して進行中なので、このカードは自分の行を持つ。あの呼び出し
// 側がさらにもう1行触らなければならなくなるのを避けるため。
//
// 見た目は #365 の「プラットフォームに依らないカード1種」という判断に従う（X や Bluesky
// 風の模倣はしない）。#365 自体はまだ作られていないが、#180 の設計がこのカードを置いた画面は
// ここ（インスペクタ）だけなので、#365 のタイルを待たずにその形を自分で描く。
//
// v1 はメタデータだけに留める（#290 の方針。引用については #180 の 2026-07-27 の設計コメント
// で改めて確認した）。メディアは一切ダウンロードしないし、アバターもリモートの URL から
// 取りに行かない。だからこのコンポーネントは null 以外の `avatarSrc` を受け取らない＝
// 引用元や返信先の投稿者が得るアバターは、モノグラムの代替（Avatar、_shared/PostCard.tsx）
// だけになる。
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
      {m.text ? <p className="line-clamp-4 text-[13px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">{m.text}</p> : null}
      {m.mediaCountLabel ? (
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <ImageIcon aria-hidden="true" className="size-3" />
          <span>{m.mediaCountLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
