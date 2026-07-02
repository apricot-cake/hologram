// Virtualized poster-grid island (window.corpusPosterGrid bridge). React owns
// cell rendering + windowing; viewer.js keeps owning posterList, the count
// badge, the grid density classes, the inspected highlight (model-driven via
// modelOf), and ALL event delegation on #posterGrid (click → info/tag/open,
// contextmenu → menu). Host attach/detach + flushSync semantics live in the
// shared wireGridIsland (_shared/VirtualGrid.tsx).
import { wireGridIsland } from '../_shared/VirtualGrid.tsx';
import { PostersHost } from './Posters.tsx';

wireGridIsland({
  bridge: window.corpusPosterGrid,
  containerId: 'posterGrid',
  hostId: 'posterGridReact',
  renderHost: (model) => <PostersHost model={model} />,
});
