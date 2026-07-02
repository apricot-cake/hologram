// Virtualized collection-grid island (window.corpusCollectionGrid bridge).
// React owns cell rendering + windowing; viewer.js keeps owning the collection
// data, records/thumbs computation, the count badge, and ALL event delegation
// on #collectionGrid. Host attach/detach + flushSync semantics live in the
// shared wireGridIsland (_shared/VirtualGrid.jsx).
import { wireGridIsland } from '../_shared/VirtualGrid.jsx';
import { CollectionsHost } from './Collections.jsx';

wireGridIsland({
  bridge: window.corpusCollectionGrid,
  containerId: 'collectionGrid',
  hostId: 'collectionGridReact',
  renderHost: (model) => <CollectionsHost model={model} />,
});
