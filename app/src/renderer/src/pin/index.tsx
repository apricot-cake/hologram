// Pin window entry (#79) — the peer of app/index.tsx, but a much smaller bundle:
// no orchestrator, no grid/sidebar/settings, just the pieces PinApp.tsx actually
// uses (ImageTab/ViewerToolbar and the services they close over). Rollup gives
// each entry in electron.vite.config.ts's rollupOptions.input its own module
// graph, so this file's imports — not app/index.tsx's — decide what ships here.
import '../globals.css';
import './root.tsx';
