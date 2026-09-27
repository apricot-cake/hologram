import { createI18n } from './i18n.ts';
import type { RetryWebSaveMessage, SaveResponse, WebSaveNoticeMessage } from './messages.ts';
import { saveResultText } from './save-result-text.ts';
import { SaveToasts } from './save-toasts.ts';

export function installWebSaveNotices() {
  const ready = createI18n().then((i18n) => ({ i18n, toasts: new SaveToasts(i18n.getMessage) }));
  chrome.runtime.onMessage.addListener((message: WebSaveNoticeMessage, sender) => {
    if (sender.id !== chrome.runtime.id || message.type !== 'webSaveNotice') return;
    void ready.then(({ i18n, toasts }) => {
      const { token, url, result } = message;
      if (!result) {
        toasts.clearFailure(token);
        toasts.begin(token);
        return;
      }
      const complete = result.ok && result.metaOk && !result.mediaMissing && !result.acquisitionIssues?.length;
      toasts.end(token, complete);
      if (complete) return;
      const retry = () => {
        void chrome.runtime
          .sendMessage({ type: 'retryWebSave', token } satisfies RetryWebSaveMessage)
          .then((response: SaveResponse) => {
            if (response?.ok) return;
            toasts.notice(token, '', i18n.saveFailureText(response?.errorKind), undefined, 'error', { url });
          })
          .catch(() => {
            toasts.notice(token, '', i18n.getMessage('bannerExtensionReloaded'));
          });
      };
      if (result.ok) {
        const text = saveResultText(result, i18n.getMessage);
        toasts.notice(token, '', text.failure, retry, 'partial', { url, savedSummary: text.savedSummary });
      } else {
        toasts.notice(token, '', i18n.saveFailureText(result.errorKind, result.metaReason, result.queued), result.queued ? undefined : retry, result.queued ? 'idle' : 'error', { url });
      }
    });
  });
}
