// Virtualized post-grid component (services/grid.ts's hologramPostGridSource) — owns
// cell rendering + windowing for BOTH post layouts (grid / list, #618). Host
// attach/detach + flushSync semantics live in the shared GridMount
// (_shared/VirtualGrid.tsx). Rendered under the single App root (AppShell renders
// <PostGrid/>). The source is PULLED (hologramStore-derived), not pushed — see
// services/grid.ts.
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { GridHost } from './Grid.tsx';
import { gridSlot, registerGridSlot } from '../services/content-area.ts';
import { hologramPostGridSource } from '../services/grid.ts';

// Module scope: GridMount re-runs its attach effect whenever this identity changes,
// and React detaches/re-attaches a ref whose callback identity changed.
const container = () => gridSlot('post');
const setSlot = registerGridSlot('post');

/** The box in the content column the masonry is attached into. */
export function PostGridSlot({ hidden }: { hidden?: boolean }) {
  return <div ref={setSlot} data-slot="post-grid" hidden={hidden} />;
}

export function PostGrid() {
  return <GridMount bridge={hologramPostGridSource} container={container} renderHost={(model) => <GridHost model={model} />} />;
}
