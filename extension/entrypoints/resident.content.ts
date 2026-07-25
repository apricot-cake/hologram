import { startDrag } from '../utils/drag';
import { startOverlay } from '../utils/overlay';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*', 'https://bsky.app/*', 'https://www.pixiv.net/*', 'https://pixiv.net/*'],
  runAt: 'document_idle',
  async main() {
    await startOverlay();
    await startDrag();
  },
});
