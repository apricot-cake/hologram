// #181: リンク共有の投稿が持つ OGP のプレビューカード。保存済みの `linkCard` の
// サブレコードから描画する（その場で取りに行くことはない＝サムネイルは保存時に取得
// してある。#180 の QuotedPostCard が自身のアバターで守っているのと同じ「表示時に
// 遠隔の src を使わない」規則）。QuotedPostCard.tsx や PollCard.tsx と同じ理由で
// 小さな独立したコンポーネントにしてある: 既存のインスペクタのどの行も持たない形
// （サムネイルの横にタイトル・説明・ドメイン）を描くため。
//
// 常にクリックできる（m.onOpen が欠けることはない＝globals.d.ts の
// HologramLinkCardModel のコメントを参照）。リンクカードの要点は行き先そのものなので、
// QuotedPostCard が時々取るクリックできない状態（url を持たないサブレコード）と違い、
// こちらは常に外部で開く。
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
      {/* アイコンと見出しの行。PollCard.tsx が自身のカードに与えているのと同じ形にして、
          本文の下に並ぶ2つのサブレコードのカードが一つの一族に見えるようにする。 */}
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
