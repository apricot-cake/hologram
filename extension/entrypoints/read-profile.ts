import { profilePageMetadata } from '../utils/extractor/index.ts';
import type { ProfilePageExtractedMessage } from '../utils/messages.ts';

// ポップアップが開いたタブへ activeTab で注入される unlisted entrypoint。
// 結果は executeScript の戻り値ではなくメッセージで返す。read-meta.ts と同じく、
// extractor のモジュールスコープを失わずにバンドルするため。
export default defineUnlistedScript(() => {
  try {
    chrome.runtime.sendMessage({ type: 'profilePageExtracted', result: profilePageMetadata() } satisfies ProfilePageExtractedMessage).catch(() => {});
  } catch {
    /* extension context が消えたタブでは何もしない */
  }
});
