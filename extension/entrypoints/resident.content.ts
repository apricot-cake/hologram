import { extensionOrigin, logSaveEvent } from '../utils/capture-log.ts';
import { startDrag } from '../utils/drag.ts';
import { startOverlay } from '../utils/overlay.ts';
import { installUncaughtReporting } from '../utils/uncaught-report.ts';
import { refreshUiRootStyles } from '../utils/ui-root.ts';

// Outside the disposable runtime on purpose: reporting must outlive a
// generation swap, and installUncaughtReporting is once-per-realm anyway (#727).
installUncaughtReporting(window, logSaveEvent, { context: 'content', ownOrigin: extensionOrigin() });

const OWNER = Symbol.for('hologram.resident-runtime');

interface ResidentOwner {
  generation: number;
  dispose: () => void;
}

const scope = globalThis as typeof globalThis & { [OWNER]?: ResidentOwner };
const generation = (scope[OWNER]?.generation ?? 0) + 1;
scope[OWNER]?.dispose();

let disposed = false;
const cleanups: Array<() => void> = [];
const owner: ResidentOwner = {
  generation,
  dispose() {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    if (scope[OWNER] === owner) delete scope[OWNER];
  },
};
scope[OWNER] = owner;

void (async () => {
  refreshUiRootStyles();
  const overlayCleanup = await startOverlay();
  if (disposed) overlayCleanup();
  else cleanups.push(overlayCleanup);

  const dragCleanup = await startDrag();
  if (disposed) dragCleanup();
  else cleanups.push(dragCleanup);
})().catch(() => owner.dispose());

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => owner.dispose());
}
