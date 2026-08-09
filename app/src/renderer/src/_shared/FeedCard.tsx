// タイムラインのセル（#183）＝保存した投稿1つを SNS 風のフィードカードとして描く。全幅の
// 本文が先に来て、メディアが続き、装飾は最小限。PostCard.tsx（グリッド）と ListRow.tsx
// （流し読み用の一覧の行）に並ぶ3つ目のセルであって、その2つが共有する3つ目の密度では
// ない。フィードの仕事はあの2つと逆だから＝本文が主役の内容であり（サムネイルの下の
// キャプションではない）、複数画像の投稿は全コマを横スクロールで見せる（3枚のシートで
// のぞかせるのではない）。ListRow.tsx と同じやり方で PostCard.tsx のエクスポートされた
// 部品を再利用し（投稿者の行、サムネイル、装飾、選択のリング）、その上にフィードが必要と
// するものだけを足す＝読み幅の上限、開ける本文、画像のカルーセル、埋め込む引用元/リプライ先
// のカード。
//
// 設計の記録: GitHub の issue #183（2026-08-02 のコメント）＝レイアウトのバリアントでは
// なく独立した browseMode。ソートは上流で投稿日の降順に固定（services/orchestrator.ts の
// sortValue）。月の見出しとジャンプレールは共有の #47 の日付セクションの経路をそのまま使う。
import { useLayoutEffect, useRef, useState } from 'react';
import { Reply } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { fileSrc } from '../services/asset-src.ts';
import { quotedCardModelOf } from '../services/records.ts';
import { QuotedPostCard } from '../inspector/QuotedPostCard.tsx';
import { AuthorLine, CardThumb, CountBadge, MetaFoot, SelectionRing, cellChrome, cellHandlers, type PostCellProps } from './PostCard.tsx';

// 2026-08-02 の設計コメントが求める読み幅の上限（「自前の読み幅上限を持ち、中央寄せする」）
// ＝再利用できる既存の共有変数は無い。リスト表示の行は全幅で自分の上限を持たない（その
// コメントの初稿が指していた #27 の 760px という数字は、これが出るより前に退役した
// レイアウトのもの）。第一案の数字で、実際のライブラリで画面に出したら動かすつもり。
const FEED_READ_WIDTH = 600;

// 本文＝決まった行数で切り詰め、残らない「続きを読む」を添える（2026-08-02 の設計コメント
// の受け入れ条件4）。開いた状態は載せ直しを越えて残らない＝グリッドの本文がスクロール位置を
// 覚えないのと同じ。切り詰めが実際に何かを切ったかどうかは長さから当てずに実測する
// （scrollHeight と clientHeight の比較）ので、既に収まっている本文の上にボタンが出ること
// はない。
function FeedBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  // text は下の本体では読んでいないが、実測する DOM の内容を描いているのはこれ＝
  // 使い回されたセル（仮想化）が新しい投稿を渡されたとき、測り直すのにこれが要る。
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
            // このボタンはカード自身の onClick（選択・詳細表示）の内側にある＝これが
            // 無いと、本文を開くだけでその選択まで発火してしまう。
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

// まとまった投稿の画像を、PostCard の背面スタックのシートでのぞかせるのではなく横へ
// スクロールさせる（#183 の受け入れ条件5）＝のぞかせる見せかけは「1枚より多い」と答える
// だけで、フィードは実際に見せたい。コマごとに素の <img> を置く（group.files が作品の
// 全ページを持つ＝records.ts の groupFilesOf）。まとまりの中の動画や gif のコマは稀な
// ケースで、スタックのシートと同じくその静止画に退避する。
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
  // #183 の 2026-08-02 のコメント: リプライ先には引用元のような完全な埋め込みカードを
  // 与えない＝「リプライ先 X」という1行の見出しだけにして、リプライの多いタイムラインが
  // 入れ子のカードの壁に見えないようにする。同じ純粋な写像（quotedCardModelOf）から
  // 作るので、ここが出す名前が詳細パネルの完全なカードの言うことからずれることはない。
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
