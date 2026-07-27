// Virtualized post-grid island (renderer/grid.ts's hologramPostGridSource) — owns cell rendering
// + windowing for ALL grid views (card / tile / list). Host attach/detach + flushSync
// semantics live in the shared GridMount (_shared/VirtualGrid.tsx). Rendered under the
// single App root (app/App.tsx renders <PostGrid/>). The source is PULLED
// (hologramStore-derived), not pushed — see renderer/grid.ts.
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { GridHost } from './Grid.tsx';
import { hologramPostGridSource } from '../services/grid.ts';

export function PostGrid() {
  return <GridMount bridge={hologramPostGridSource} containerId="postGrid" hostId="postGridReact" renderHost={(model) => <GridHost model={model} />} />;
}
