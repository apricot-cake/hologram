// Shared React runtime for every island — bundled ONCE (react + react-dom
// included) into renderer/islands/vendor-react.js and loaded before any island
// in index.html. Each island is then built with react/react-dom marked
// `external` (see islands/build.mjs), so its bundle carries only its own code
// (a few KB) and reaches React through these globals instead of inlining its
// own ~186KB copy. Net: 16 duplicated runtimes (~3MB) collapse to one (~140KB).
//
// The global NAMES here must match the `output.globals` map in build.mjs
// exactly. We expose each import specifier's full namespace so every named
// import an island uses resolves:
//   react            → hooks (useState, useSyncExternalStore, …)
//   react-dom        → createPortal, flushSync
//   react-dom/client → createRoot (every root island)
//   react-dom/server → renderToStaticMarkup (post-card only)
//   react/jsx-runtime→ jsx/jsxs/Fragment (the automatic JSX runtime all
//                      islands compile against)
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOMServer from 'react-dom/server';
import * as ReactJsxRuntime from 'react/jsx-runtime';

window.React = React;
window.ReactDOM = ReactDOM;
window.ReactDOMClient = ReactDOMClient;
window.ReactDOMServer = ReactDOMServer;
window.ReactJsxRuntime = ReactJsxRuntime;
