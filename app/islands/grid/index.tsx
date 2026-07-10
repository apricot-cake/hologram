// Virtualized post-grid island (renderer/grid.ts's corpusPostGridSource) — owns cell rendering
// + windowing for ALL grid views (card / tile / list). Host attach/detach + flushSync
// semantics live in the shared GridMount (_shared/VirtualGrid.tsx). Rendered under the
// single App root (app/App.tsx renders <PostGrid/>). P4-B slice⑩: the source is
// PULLED (corpusStore-derived), not pushed — see renderer/grid.ts.
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { GridHost } from './Grid.tsx';
import { corpusPostGridSource } from '../../renderer/grid.ts';

export function PostGrid() {
  return <GridMount bridge={corpusPostGridSource} containerId="postGrid" hostId="postGridReact" renderHost={(model) => <GridHost model={model} />} />;
}
