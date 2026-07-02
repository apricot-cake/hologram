// Virtualized post-grid island (window.corpusGrid bridge). Unlike the other
// islands, React does NOT own #postGrid itself: the legacy card/tile path still
// writes #postGrid's children directly (innerHTML / replaceChildren / masonry
// node moves), and React must never watch its managed nodes vanish underneath
// it. So the island renders into its OWN host <div> and attaches/detaches that
// host as whole — the legacy path's blanket clears can only ever remove the
// (detached-safe) host, never React-managed children.
//
// Renders are prop-driven from the bridge listener and flushed SYNCHRONOUSLY
// (flushSync): viewer.js relies on render(null) having fully handed the
// container back before its next line runs the legacy DOM path. Bridge pushes
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
