// i18n helper for the extension's content scripts (capture banner + drag drop-zone).
// Manifest-level strings (name, description, action title, command descriptions)
// are handled by Chrome's native i18n via _locales/*/messages.json. The few UI
// strings below are embedded here so content scripts (which cannot fetch
// _locales/ files reliably) get them without extra network round-trips.
//
// Consumers do: const { getMessage, lang, resolved } = await window.hologramI18n;
// then call getMessage('key', [sub1, sub2]).
// Note: this file may be re-executed by chrome.scripting.executeScript on every
// Alt+S press, so window.hologramI18n is reassigned each time. The banner language
// follows the browser locale (navigator.language); the desktop app (the former
// in-extension viewer) now owns all viewer/settings strings in app/renderer/i18n.ts.
(function () {
  const MESSAGES = {
    ja: {
      // content.js capture banner
      bannerSelect: '保存する投稿をクリック（Esc または右クリックでキャンセル）',
      bannerSaving: '保存中...',
      bannerSaved: '画像を保存しました',
      // $1 = how many images of this post are saved now (2nd, 3rd, …). Shown when
      // a save hits a post already saved this session — the app folds same-post
      // records into ONE stacked card, so nothing "new" appears in the grid.
      bannerSavedGrouped: '保存しました — さっきの画像とグループ化されます（$1枚目）',
      bannerSavedNoMeta: '保存しました（投稿情報の取得に失敗）',
      // Reason-specific partial-save wording (metaReason from background.js).
      bannerSavedNoMetaProtected: '保存しました（鍵付きアカウントのため投稿情報は取得できません）',
      bannerSavedNoMetaAgeRestricted: '保存しました（年齢制限付き投稿のため投稿情報は取得できません）',
      bannerFailed: '保存に失敗しました',
      // $1 = reason. Shown when a save fails with a known cause, so the banner
      // says WHY instead of a bare "failed".
      bannerFailedReason: '保存に失敗: $1',
      reasonNoPermalink: '投稿リンクを取得できません',
      reasonNoPost: '投稿を特定できません',
      // Native host not found (unregistered, or registered but Chrome not yet
      // restarted). Chrome reads native-host registrations at startup, so the
      // first suggestion is a restart.
      bannerHostMissing: 'Hologram の保存先に接続できません。Chrome を再起動してください',

      // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
      dragDropHint: 'ここにドロップで Hologram に保存',

      // badge.js: tooltip on the timeline's "already saved" mark
      badgeSaved: 'Hologram に保存済み',
    },

    en: {
      bannerSelect: 'Click a post to save (Esc or right-click to cancel)',
      bannerSaving: 'Saving...',
      bannerSaved: 'Image saved',
      bannerSavedGrouped: 'Saved — grouped with your earlier image ($1 of this post)',
      bannerSavedNoMeta: 'Saved (post info unavailable)',
      bannerSavedNoMetaProtected: 'Saved (post info unavailable: private account)',
      bannerSavedNoMetaAgeRestricted: 'Saved (post info unavailable: age-restricted post)',
      bannerFailed: 'Save failed',
      bannerFailedReason: 'Save failed: $1',
      reasonNoPermalink: 'could not find the post link',
      reasonNoPost: 'could not identify a post here',
      bannerHostMissing: "Can't reach Hologram's saver. Please restart Chrome.",

      // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
      dragDropHint: 'Drop here to save to Hologram',

      // badge.js: tooltip on the timeline's "already saved" mark
      badgeSaved: 'Saved in Hologram',
    },
  };

  window.hologramI18n = (async () => {
    // The banner follows the browser locale. The extension no longer stores a
    // language preference (the viewer moved to the desktop app, which keeps its
    // own setting in config.json that a content script cannot read).
    const resolved = navigator.language && navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
    const table = MESSAGES[resolved] || MESSAGES.en;

    const getMessage = (key, subs?) => {
      let text = table[key];
      if (text == null) return key;
      if (subs && subs.length) {
        for (let i = 0; i < subs.length; i++) {
          text = text.split('$' + (i + 1)).join(subs[i] == null ? '' : String(subs[i]));
        }
      }
      return text;
    };

    // Partial-save wording: pick the reason-specific string when the
    // background classified WHY the post info is missing (metaReason), fall
    // back to the generic one for unclassified failures.
    const partialSaveText = (reason) => getMessage(reason === 'protected' ? 'bannerSavedNoMetaProtected' : reason === 'ageRestricted' ? 'bannerSavedNoMetaAgeRestricted' : 'bannerSavedNoMeta');

    return { lang: resolved, resolved, getMessage, partialSaveText };
  })();
})();
