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
