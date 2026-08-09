// #179: 保存した投稿が持っていたアンケートを、サイドカーの `poll` の下位構造から描く。
// 意図して静的にしてある＝選択肢は結果であって操作するものではない。ここには押せるものが
// 無く、ライブラリから投票が行われることも一切ない（Issue 自身の範囲の一文、
//「投票 UI の再現はしない」）。
//
// QuotedPostCard.tsx と同じ理由で独立した小さなコンポーネントにしてある。投稿の本文の下に
// 座り、既存の詳細パネルのどの行も持たない形（選択肢ごとのラベル付きのバー）を描くので、
// Field/Fields の「ラベル: 値」の調子を無理に曲げない。
//
// バーは別のトラックの要素ではなく、選択肢の行の背後を塗る背景にしている。Mastodon や X が
// 締め切ったアンケートを描くのと同じやり方で、選択肢の文がゲージの脇に押し込められず、幅
// いっぱいで読めるまま保たれる。色は固定の薄い灰色ではなく、`foreground` を低い不透明度で
// 使う（このレンダラーの他所でもすでに使っている言い回し）。そうすれば塗りがどちらのテーマ
// でも見える＝薄い灰色の塗りは白いパネルに対して oklch(0.97) と実測され、それは誰にも
// 見えないバーになる。
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
            {/* モデルの割合は丸めないが、幅のほうは範囲に収める。バーは割合の絵であって
                トラックより長くはなりえない。一方で数値はプラットフォーム自身の数字が
                出したままにしておく。そうすれば辻褄の合わない中身が、黙って丸められる
                のではなく、おかしな割合として目に見える。 */}
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
