// Virtualized poster-grid component (services/grid.ts's hologramPosterGridSource). React
// owns cell rendering, windowing and every gesture ON a card; orchestrator.ts keeps
// owning posterList and the count badge. Host attach/detach + flushSync semantics live
// in the shared GridMount (_shared/VirtualGrid.tsx). Rendered under the single App root
// (AppShell renders <PosterGrid/>). The source is PULLED (hologramStore-derived), not
// pushed — see services/grid.ts.
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { PostersHost } from './Posters.tsx';
import { gridSlot, registerGridSlot } from '../services/content-area.ts';
import { hologramPosterGridSource } from '../services/grid.ts';

const container = () => gridSlot('poster');
const setSlot = registerGridSlot('poster');

/**
 * The box in the content column the poster masonry is attached into. It carries no
 * density class any more (#630): which shape a cell is drawn at comes from the model
 * the cells read, exactly as on the post side — nothing styles a cell through its
 * container.
 */
export function PosterGridSlot({ hidden }: { hidden?: boolean }) {
  return <div ref={setSlot} data-slot="poster-grid" hidden={hidden} />;
}

export function PosterGrid() {
  return <GridMount bridge={hologramPosterGridSource} container={container} renderHost={(model) => <PostersHost model={model} />} />;
}
