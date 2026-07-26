// i18n helper for the extension's content scripts (capture banner + drag drop-zone).
// Manifest-level strings (name, description, action title, command descriptions)
// are handled by Chrome's native i18n via _locales/*/messages.json. The few UI
// strings below are embedded here so content scripts (which cannot fetch
// _locales/ files reliably) get them without extra network round-trips.
//
// The banner language follows the browser locale; the desktop app owns all
// viewer/settings strings in app/renderer/i18n.ts.
import type { SaveFailureKind } from './native-error';

export interface HologramI18nApi {
  lang: string;
  resolved: string;
  getMessage: (key: string, subs?: ReadonlyArray<unknown>) => string;
  partialSaveText: (reason?: string | null) => string;
  saveFailureText: (kind?: SaveFailureKind | null) => string;
}

export function createI18n(): Promise<HologramI18nApi> {
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
      bannerHostUnavailable: 'Hologram の保存プログラムを起動できませんでした。拡張機能の設定から診断ページを確認してください',
      bannerOriginRejected: 'Hologram の保存設定が一致していません。Hologram を再インストールしてください',
      bannerFailedUnknown: '保存に失敗しました。拡張機能の設定から診断ページを確認してください',

      // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
      dragDropHint: 'ここにドロップで Hologram に保存',

      // overlay.js: tooltip on the timeline's "already saved" mark
      badgeSaved: 'Hologram に保存済み',
      // overlay.js: tooltip on the hover save button. It says IMAGE, not post:
      // this route saves the picture plus the post's text/author, never a
      // screenshot of how the post looks (that is Alt+S element capture).
      hoverSaveImage: '画像を保存',

      // bulk-capture.ts: X bookmarks chase-mode intake banner (#362)
      bulkStop: '中断',
      // $1 = saved count, $2 = already-saved (skipped) count
      bulkProgress: '保存 $1件・保存済みスキップ $2件',
      // $1 = saved, $2 = skipped, $3 = missed. Misses recover only when their
      // rows re-render, i.e. when the user passes them again SLOWLY — say so
      // (just "scroll back" sent users to the top of the list, where mid-list
      // misses never re-render; observed 2026-07-26).
      bulkProgressMissed: '保存 $1件・スキップ $2件・見送り $3件（通り過ぎた分＝ゆっくり戻ると保存されます）',
      bulkStopped: '取込を中断しました',
      bulkFinished: '取込が完了しました',
      bulkSummarySaved: '保存 $1件',
      bulkSummarySkipped: '保存済み $1件',
      bulkSummaryMissed: '見送り $1件（もう一度実行すると未保存の分だけ保存されます）',
      bulkSummaryFailed: '失敗 $1件',
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
      bannerHostUnavailable: "Hologram's saver could not start. Open the diagnostics page from the extension settings.",
      bannerOriginRejected: "Hologram's save configuration does not match. Reinstall Hologram.",
      bannerFailedUnknown: 'Save failed. Open the diagnostics page from the extension settings.',

      // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
      dragDropHint: 'Drop here to save to Hologram',

      // overlay.js: tooltip on the timeline's "already saved" mark
      badgeSaved: 'Saved in Hologram',
      // overlay.js: tooltip on the hover save button (see the ja note).
      hoverSaveImage: 'Save image',

      // bulk-capture.ts: X bookmarks chase-mode intake banner (#362)
      bulkStop: 'Stop',
      bulkProgress: 'Saved $1 · already saved $2',
      bulkProgressMissed: 'Saved $1 · skipped $2 · missed $3 (passed too fast — scroll back slowly and they save)',
      bulkStopped: 'Import stopped',
      bulkFinished: 'Import finished',
      bulkSummarySaved: '$1 saved',
      bulkSummarySkipped: '$1 already saved',
      bulkSummaryMissed: '$1 missed (run again to save just what is still unsaved)',
      bulkSummaryFailed: '$1 failed',
    },
  };

  return (async () => {
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

    const saveFailureText = (kind) => getMessage(kind === 'host-missing' ? 'bannerHostMissing' : kind === 'host-unavailable' ? 'bannerHostUnavailable' : kind === 'origin-rejected' ? 'bannerOriginRejected' : 'bannerFailedUnknown');

    return { lang: resolved, resolved, getMessage, partialSaveText, saveFailureText };
  })();
}
