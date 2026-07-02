// i18n helper for the extension's content scripts (capture banner + drag drop-zone).
// Manifest-level strings (name, description, action title, command descriptions)
// are handled by Chrome's native i18n via _locales/*/messages.json. The few UI
// strings below are embedded here so content scripts (which cannot fetch
// _locales/ files reliably) get them without extra network round-trips.
//
// Consumers do: const { getMessage, lang, resolved } = await window.corpusI18n;
// then call getMessage('key', [sub1, sub2]).
// Note: this file may be re-executed by chrome.scripting.executeScript on every
// Alt+S press, so window.corpusI18n is reassigned each time. The banner language
// follows the browser locale (navigator.language); the desktop app (the former
// in-extension viewer) now owns all viewer/settings strings in app/renderer/i18n.js.
(function () {
  const MESSAGES = {
    ja: {
      // content.js capture banner
      bannerSelect: '保存する投稿をクリック（Esc または右クリックでキャンセル）',
      bannerSaving: '保存中...',
      bannerSaved: '画像を保存しました',
      bannerSavedNoMeta: '保存しました（投稿情報の取得に失敗）',
      bannerFailed: '保存に失敗しました',
      // $1 = reason. Shown when a save fails with a known cause, so the banner
      // says WHY instead of a bare "failed".
      bannerFailedReason: '保存に失敗: $1',
      reasonNoPermalink: '投稿リンクを取得できません',
      reasonNoPost: '投稿を特定できません',
      // Native host not found (unregistered, or registered but Chrome not yet
      // restarted). Chrome reads native-host registrations at startup, so the
      // first suggestion is a restart.
      bannerHostMissing: 'Corpus の保存先に接続できません。Chrome を再起動してください',

      // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
      dragDropHint: 'ここにドロップで Corpus に保存',
    },

    en: {
      bannerSelect: 'Click a post to save (Esc or right-click to cancel)',
      bannerSaving: 'Saving...',
      bannerSaved: 'Image saved',
      bannerSavedNoMeta: 'Saved (post info unavailable)',
      bannerFailed: 'Save failed',
      bannerFailedReason: 'Save failed: $1',
      reasonNoPermalink: 'could not find the post link',
      reasonNoPost: 'could not identify a post here',
      bannerHostMissing: "Can't reach Corpus's saver. Please restart Chrome.",

      // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
      dragDropHint: 'Drop here to save to Corpus',
    },
  };

  window.corpusI18n = (async () => {
    // The banner follows the browser locale. The extension no longer stores a
    // language preference (the viewer moved to the desktop app, which keeps its
    // own setting in config.json that a content script cannot read).
    const resolved = navigator.language && navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
    const table = MESSAGES[resolved] || MESSAGES.en;

    const getMessage = (key, subs) => {
      let text = table[key];
      if (text == null) return key;
      if (subs && subs.length) {
        for (let i = 0; i < subs.length; i++) {
          text = text.split('$' + (i + 1)).join(subs[i] == null ? '' : String(subs[i]));
        }
      }
      return text;
    };

    return { lang: resolved, resolved, getMessage };
  })();
})();
