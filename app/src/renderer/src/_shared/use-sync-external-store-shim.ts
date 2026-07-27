// ESM stand-in for the CJS 'use-sync-external-store' shim package (a react-aria /
// react-stately transitive dep). React 18+ ships useSyncExternalStore natively,
// and the CJS package's literal require("react") survives into the bundled
// renderer output (externals are global-mapped only for ESM imports) and throws at
// load under file://. Aliased in electron.vite.config.ts's RESOLVE_ALIAS.
export { useSyncExternalStore } from 'react';
