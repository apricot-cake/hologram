// 仮想化した投稿者グリッド＝共有の VirtualGridHost に載せる投稿者のセル。React が描画と窓の
// 制御をし、カードの上でのジェスチャはすべて React が持つ（#618: ジェスチャは今や prop なので、
// コンテナ側の委譲リスナが読み返すための `data-index` をセルはもう持たない）。posterList と
// 件数の印は今も orchestrator.ts が持つ。詳細表示中の強調は modelOf ではなく hologramStore
// から導く。
//
// 投稿者をどのセルとして描くかはモデルの投稿者の形から決まる（#630）＝グリッドか行か、
// グリッドならメタデータのブロックを出すかどうか。コンテナの密度のクラスが CSS でそれを
// 決めることはもう無い。旧来の `.poster-card` のスタイルシートは無くなり、投稿側と同じく
// どちらのセルも Tailwind になっている。
import { useSyncExternalStore } from 'react';
import { Eye, SquarePen, Users } from 'lucide-react';
import { t } from '../_shared/i18n.ts';
import { cn } from '@/lib/utils';
import { Avatar, cellChrome, cellHandlers } from '../_shared/PostCard.tsx';
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import type { PosterShape } from '../services/display.ts';
import { posterClickBackground } from '../services/orchestrator.ts';
import { store, subscribeKey } from '../services/store.ts';

// 詳細表示のリングは、modelOf のクロージャ読みのモデルに乗せず hologramStore の
// 'inspectedKey' から直に導く（本物の購読）＝投稿側の双子は grid/Grid.tsx の Cell を参照。
const subInspected = (cb: () => void) => subscribeKey('inspectedKey', cb);
const getInspected = () => store.getState().inspectedKey;

// poster-grid-builder がカードごとに解決する投稿者のセルのモデル＝ここに並べた欄だけ。
interface PosterCardModel {
  previousName?: string;
  index: number;
  inspected?: boolean;
  avatarSrc?: string | null;
  monogram?: string | null;
  monoHue?: number | null;
  name?: string;
  handle?: string | null;
  platform?: string | null;
  pfName?: string | null;
  sortValue?: { kind: string; label: string } | null;
}

// プラットフォームの点の色。トークンは design-tokens.css に置いたまま（ブランドのパレット
// なので）。プラットフォーム→トークンの引き当てをここに置くのは、プラットフォームごとの
// クラスが投稿者のスタイルシートを生かしていた最後の理由だったから。
const PF_COLOR: Record<string, string> = {
  x: 'var(--brand-x)',
  bluesky: 'var(--brand-bluesky)',
  pixiv: 'var(--brand-pixiv)',
};

function PlatformTag({ platform, pfName, className }: { platform?: string | null; pfName?: string | null; className?: string }) {
  if (!platform) return null;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-[5px] whitespace-nowrap text-[10px] uppercase tracking-[0.04em]', className)}>
      <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full" style={{ background: PF_COLOR[platform] || 'var(--text-muted)' }} />
      <span className="truncate">{pfName}</span>
    </span>
  );
}

/**
 * グリッドのセル＝アバターを先頭に置くカード。「情報を表示」が OFF ならアバターだけで他は
 * 何も無い＝それが俯瞰そのもの（#141）で、素のサムネイルのグリッドの投稿者側の双子であり、
 * レイアウトがこのセルを正方形と呼べる理由でもある。
 */
function PosterCard({ c, shape, group, actions }: { c: PosterCardModel; shape: PosterShape; group: unknown; actions?: HologramCardActions }) {
  const MetricIcon = c.sortValue?.kind === 'views' ? Eye : c.sortValue?.kind === 'posts' ? SquarePen : c.sortValue?.kind === 'followers' ? Users : null;
  return (
    <div data-slot="poster-card" data-inspected={c.inspected || undefined} className={cn(cellChrome({ selected: c.inspected }, false), 'flex w-full flex-col rounded-lg')} {...cellHandlers(actions, group)}>
      <Avatar c={c} className="aspect-square w-full" discClassName="size-[44cqw] text-[19cqw]" />
      {shape.info && (
        <div data-slot="poster-card-meta" className="flex min-w-0 flex-col gap-px px-[11px] pt-[9px] pb-2.5">
          <div className="truncate font-semibold text-[13.5px] text-[var(--text)]">{c.name}</div>
          {c.handle && <div className="truncate text-[11.5px] text-[var(--text-muted)]">@{c.handle}</div>}
          {c.previousName && (
            <div data-slot="poster-previous-name" className="break-words text-xs text-muted-foreground">
              {t('posterPreviousNameMatch', { name: c.previousName })}
            </div>
          )}
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <PlatformTag platform={c.platform} pfName={c.pfName} className="text-[var(--text-muted)]" />
            {c.sortValue && (
              <span data-slot="poster-card-sort-value" className="ml-auto inline-flex shrink-0 items-center gap-[3px] whitespace-nowrap text-[11px] text-[var(--text-subtle)]">
                {MetricIcon && <MetricIcon aria-hidden="true" className="size-3" />}
                {c.sortValue.label}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 窓に入ったセル1つ＝カードのモデルは遅延して組む（払うのは見えているセルだけ）。
function PosterCell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const inspectedKey = useSyncExternalStore(subInspected, getInspected);
  const shape = model.posterShape as PosterShape;
  const c = model.modelOf(data, index);
  c.inspected = data != null && data.key != null && inspectedKey === 'poster:' + data.key;
  return <PosterCard c={c} shape={shape} group={data} actions={model.cardActions} />;
}

// 余白のクリック（#242）。マーキーの sink は無い＝このグリッドは選択を持たないので、押下に
// あるのはクリック側だけ＝両グリッドが共有するインスペクタが差し込みの表示へ戻る。遅らせて
// 束縛し（orchestrator が init のときに代入する）、描画の外へ引き上げてある。prop の同一性が
// 変わるたびにホストがジェスチャを構え直すため。
const onBackgroundClick = () => posterClickBackground();

export function PostersHost({ model }: { model: HologramGridModel }) {
  return <VirtualGridHost model={model} cell={PosterCell} onBackgroundClick={onBackgroundClick} />;
}
