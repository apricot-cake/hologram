// 仮想化したゴミ箱のグリッド（#268）＝ゴミ箱という行き先のセル。土台は投稿のグリッドと
// 同じ（_shared/VirtualGrid の GridMount と VirtualGridHost）で、描くセルも同じ。削除した
// 投稿は元の投稿だと分かる必要があるので、カードは小さな代役ではなくライブラリのカード
// そのもの＝配置も同じ表示の軸に従う（#618）。
//
// 投稿のグリッドから意図して引き継いでいないもの:
//  - ナビゲーションと基準点: services/grid-nav.ts と services/zoom-anchor.ts はライブラリの
//    グリッドに向けた単一の登録簿（矢印キーでの選択、Ctrl+ホイールでのズーム）。2つ目の
//    グリッドがそこへ重ねて登録すると、最後に載ったほうがキーボードを持っていってしまう。
//  - マーキー: ラバーバンドが動かすのは services/selection.ts で、あれはライブラリの選択。
//    ゴミ箱は自分の選択を持つ（services/trash-view.ts）。
//  - カードの動作のほとんど: ゴミ箱に入った投稿は外へドラッグできない（ゴミ箱から外への
//    ドラッグは、この操作を教えているどの場所でも「ここへ戻す」を意味するし、ブラウザ自身の
//    ドラッグは内部の asset:// の URL を運んでしまう）。動詞はこの表示の操作行にある。
//    cardActions が持つのはクリックとダブルクリックだけで、他は無い。
// 背景のクリックによる選択解除は今も効く。こちら側には共有の登録簿が要らないため。
import { useSyncExternalStore } from 'react';
import { PostCard } from '../_shared/PostCard.tsx';
import { GridMount, useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.tsx';
import type { GridCellProps } from '../_shared/VirtualGrid.tsx';
import { gridSlot } from '../services/content-area.ts';
import { hologramTrashGridSource } from '../services/grid.ts';
import { clearSelection, getSnapshot, subscribe } from '../services/trash-view.ts';

const EMPTY: ReadonlySet<string> = new Set();
const getSelected = () => getSnapshot().selected ?? EMPTY;

function Cell({ index, data }: GridCellProps) {
  const model = useGridModel();
  const selected = useSyncExternalStore(subscribe, getSelected);
  const shape = model.shape as HologramGridModel['shape'];
  const m = model.modelOf(data, index);
  m.selected = selected.has(m.postKey);
  return <PostCard m={m} shape={shape as NonNullable<typeof shape>} overview={model.overview} group={data} actions={model.cardActions} />;
}

const onBackgroundClick = () => clearSelection();
const container = () => gridSlot('trash');

export function TrashGrid() {
  return <GridMount bridge={hologramTrashGridSource} container={container} renderHost={(model) => <VirtualGridHost model={model} cell={Cell} onBackgroundClick={onBackgroundClick} />} />;
}
