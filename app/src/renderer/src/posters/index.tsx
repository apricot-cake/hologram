// Virtualized poster-grid island (renderer/grid.ts's hologramPosterGridSource). React owns
// cell rendering + windowing; viewer.js keeps owning posterList, the count
// badge, the grid density classes, the inspected highlight (model-driven via
// modelOf), and ALL event delegation on #posterGrid (click → info/tag/open,
// contextmenu → menu). Host attach/detach + flushSync semantics live in the
// shared GridMount (_shared/VirtualGrid.tsx). Rendered under the single App root
// (app/App.tsx renders <PosterGrid/>). The source is PULLED (hologramStore-derived),
// not pushed — see renderer/grid.ts.
import { GridMount } from '../_shared/VirtualGrid.tsx';
import { PostersHost } from './Posters.tsx';
import { hologramPosterGridSource } from '../../renderer/grid.ts';

export function PosterGrid() {
  return <GridMount bridge={hologramPosterGridSource} containerId="posterGrid" hostId="posterGridReact" renderHost={(model) => <PostersHost model={model} />} />;
}
