// Virtualized post-grid island (window.corpusGrid bridge) — owns cell rendering
// + windowing for ALL grid views (card / tile / list). Unlike the other islands,
// React does NOT root on #postGrid itself: viewer.js still blanket-clears the
// container (empty state's innerHTML=''), and React must never watch its managed
// nodes vanish underneath it. So the island renders into its OWN host <div> and
// attaches/detaches that host as a whole — container clears can only ever remove
// the (detached-safe) host, never React-managed children.
//
// Renders are prop-driven from the bridge listener and flushed SYNCHRONOUSLY
// (flushSync): viewer.js relies on a render() having fully committed before its
// next line runs (e.g. restoring scrollTop right after a push). Bridge pushes
// always originate outside React (viewer.js), so flushSync is legal here.
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { GridHost } from './Grid.jsx';

const host = document.createElement('div');
host.id = 'postGridReact';
host.style.width = '100%';
const root = createRoot(host);

function sync() {
  const model = window.corpusGrid.get();
  if (model) {
    if (!host.isConnected) document.getElementById('postGrid').appendChild(host);
    flushSync(() => root.render(<GridHost model={model} />));
  } else {
    flushSync(() => root.render(null));
    host.remove();
  }
}

window.corpusGrid.subscribe(sync);
// Catch a model pushed before this island loaded (dev: deferred ES module).
if (window.corpusGrid.isActive()) sync();
