// 一覧のセル（#618）＝PostCard と同じ保存済みの投稿を、行として並べたもの。
//
// 行は潰したカードではない。一覧で目で追うのは投稿の本文だから、本文が全幅で先頭に立ち、
// 残りは控えめな2行目に収まる（GitHub の issue の行・Linear の一覧・Bluesky のタイムライン
// はどれもこの読み方）。カードがグリッドで持つ装飾＝投稿種別のフラグ・タグのチップ・
// サムネイルに重ねた ×N の印は、縮めるのではなく落とす。行の幅は文のために使う。
//
// 規則はカードと同じ。hover 用の部品を持たない、DOM の取り決めを作らない、ジェスチャは
// props で受ける。
import { cn } from '@/lib/utils';
import { AuthorLine, CardThumb, cellChrome, cellHandlers, MetaFoot, SelectionRing, StackSheets, type PostCellProps } from './PostCard.tsx';

/** カードが印として載せている件数＝行にはそのまま書き出すだけの余白がある。 */
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
          imgClassName="block h-full w-full object-cover"
          // サムネイルの列が一覧の大きさの軸そのものなので、幅はクラスではなくモデルが
          // 持つ＝表示ポップオーバーのスライダーが動かす1つの数値。高さはその幅からの
          // 切り出しであって、画像自身の比率ではない。高さがサムネイルに従う行は一覧を
          // 不揃いな列にしてしまうし、一覧の要点は行が目で追えることにある。
          style={{ flex: `0 0 ${listThumb}px`, width: listThumb, height: Math.round(listThumb * 1.25) }}
        />
      )}
      <div data-slot="post-card-meta" className="relative flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-r-md bg-[var(--surface)] px-3.5 py-2.5">
        {m.text && <div className="line-clamp-2 text-[14px] text-[var(--text-strong)] leading-[1.45]">{m.text}</div>}
        <div className="flex min-w-0 items-center gap-2.5 text-[12px] text-[var(--text-muted)]">
          <AuthorLine userName={m.userName} handle={m.handle} avatar={shape.avatar ? m : null} className="max-w-[40%] shrink-0 font-medium" />
          {grouped && <CountLabel n={m.nImg as number} />}
          <MetaFoot m={m} className="min-w-0 flex-1" />
        </div>
      </div>
      {m.selected && <SelectionRing />}
    </div>
  );
}
