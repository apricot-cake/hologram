// ESM stand-in for the CJS 'use-sync-external-store' shim package (a react-aria /
// react-stately transitive dep). React 18+ ships useSyncExternalStore natively,
// and the CJS package's literal require("react") survives into the lib-IIFE
// island bundles (externals are global-mapped only for ESM imports) and throws at
// load under file://. Aliased in islands/build.mjs (prod) + vite.config.mjs (dev).
export { useSyncExternalStore } from 'react';
