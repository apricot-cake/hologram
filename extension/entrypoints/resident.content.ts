import { RESIDENT_MATCHES } from '../utils/extractor/index.ts';
import { startDrag } from '../utils/drag.ts';
import { startOverlay } from '../utils/overlay.ts';

export default defineContentScript({
  // Every site whose extractor declares a resident surface (#212) — adding a
  // site does not touch this file.
  matches: RESIDENT_MATCHES,
  runAt: 'document_idle',
  async main() {
    await startOverlay();
    await startDrag();
  },
});
