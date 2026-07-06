// Virtualized post-grid island (window.corpusGrid bridge) — owns cell rendering
// + windowing for ALL grid views (card / tile / list). Host attach/detach + flushSync
// semantics live in the shared GridMount (_shared/VirtualGrid.tsx). Rendered under the
// single App root (app/App.tsx renders <PostGrid/>).
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { GridHost } from './Grid.tsx';

export function PostGrid() {
  return <GridMount bridge={window.corpusGrid} containerId="postGrid" hostId="postGridReact" renderHost={(model) => <GridHost model={model} />} />;
}
