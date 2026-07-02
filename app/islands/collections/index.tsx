// Virtualized collection-grid island (window.corpusCollectionGrid bridge).
// React owns cell rendering + windowing; viewer.js keeps owning the collection
// data, records/thumbs computation, the count badge, and ALL event delegation
// on #collectionGrid. Host attach/detach + flushSync semantics live in the
// shared wireGridIsland (_shared/VirtualGrid.tsx).
import { wireGridIsland } from '../_shared/VirtualGrid.tsx';
import { CollectionsHost } from './Collections.tsx';

wireGridIsland({
  bridge: window.corpusCollectionGrid,
  containerId: 'collectionGrid',
  hostId: 'collectionGridReact',
  renderHost: (model) => <CollectionsHost model={model} />,
});
