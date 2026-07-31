// Virtualized poster-grid component (services/grid.ts's hologramPosterGridSource). React
// owns cell rendering, windowing and every gesture ON a card; orchestrator.ts keeps
// owning posterList, the count badge and the grid density classes. Host attach/detach +
// flushSync semantics live in the shared GridMount (_shared/VirtualGrid.tsx). Rendered
// under the single App root (AppShell renders <PosterGrid/>). The source is PULLED
// (hologramStore-derived), not pushed — see services/grid.ts.
import { useSyncExternalStore } from 'react';
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { PostersHost } from './Posters.tsx';
import { gridSlot, registerGridSlot } from '../services/content-area.ts';
import { hologramPosterGridSource } from '../services/grid.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

const container = () => gridSlot('poster');
const setSlot = registerGridSlot('poster');
const subPosterView = (cb: () => void) => storeSubscribe('posterView', cb);
const getPosterView = () => (storeGet('posterView') as string | undefined) || 'card';

/**
 * The box in the content column the poster masonry is attached into. It carries the
 * poster grid's own density class, which its legacy CSS styles the cells through —
 * React-derived from the store rather than toggled onto an element found by id.
 */
export function PosterGridSlot({ hidden }: { hidden?: boolean }) {
  const view = useSyncExternalStore(subPosterView, getPosterView);
  return <div ref={setSlot} data-slot="poster-grid" className={`poster-grid${view === 'tile' ? ' tile-view' : view === 'list' ? ' list-view' : ''}`} hidden={hidden} />;
}

export function PosterGrid() {
  return <GridMount bridge={hologramPosterGridSource} container={container} renderHost={(model) => <PostersHost model={model} />} />;
}
