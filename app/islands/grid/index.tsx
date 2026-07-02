// Virtualized post-grid island (window.corpusGrid bridge) — owns cell rendering
// + windowing for ALL grid views (card / tile / list). Host attach/detach +
// flushSync semantics live in the shared wireGridIsland (_shared/VirtualGrid.tsx).
import { wireGridIsland } from '../_shared/VirtualGrid.tsx';
import { GridHost } from './Grid.tsx';

wireGridIsland({
  bridge: window.corpusGrid,
  containerId: 'postGrid',
  hostId: 'postGridReact',
  renderHost: (model) => <GridHost model={model} />,
});
