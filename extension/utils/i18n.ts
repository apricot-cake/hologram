// i18n helper for the extension's content scripts (capture banner + drag drop-zone).
// Manifest-level strings (name, description, action title, command descriptions)
// are handled by Chrome's native i18n via _locales/*/messages.json. The few UI
// strings below are embedded here so content scripts (which cannot fetch
// _locales/ files reliably) get them without extra network round-trips.
//
// The banner language follows the browser locale; the desktop app owns all
// viewer/settings strings in app/renderer/i18n.ts.
import type { SaveFailureKind } from './native-error.ts';

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
      // 投稿そのものが取得できなかった（削除・凍結・鍵付き・年齢制限）＝壊れていない。
      // 直すものが無いので、診断ページへ誘導する bannerFailedUnknown とは別文言。
      bannerPostUnavailable: '投稿を取得できないため保存できません（削除・非公開など）',
      // 応答が返らないまま上限に達した（#507）。原因の多くは一過性（ネットワークの
      // 詰まり・サービスワーカーの停止）なので、最も安く効く再試行を先頭に置く。
      // 診断ページへの誘導は「繰り返す場合」の第2手＝bannerFailedUnknown が持つ。
      bannerTimedOut: '保存が終わらないため中止しました。もう一度お試しください（繰り返す場合は Chrome を再起動）',
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
      bulkStopped: '取込を中断しました',
      bulkFinished: '取込が完了しました',
      bulkSummarySaved: '保存 $1件',
      bulkSummarySkipped: '保存済み $1件',
      // Saved to disk but not yet displayable (#365 gives image-less records a
      // home). Never say "skipped" — the post IS in the library.
      bulkSummaryDeferred: '画像なし $1件も保存済み（一覧への表示は準備中）',
      // 取得できなかった投稿（#492）。「失敗」と分けて数える＝直すもののある不具合と、
      // 投稿が既に無いだけの正常な結果を、同じ言葉で並べない。
      bulkSummaryUnavailable: '取得できず $1件（削除・非公開など）',
      bulkSummaryFailed: '失敗 $1件',

      // capture.ts / drag.ts: duplicate-save warning (#34). Asked BEFORE the
      // save, because the extension writes straight to disk — with the desktop
      // app closed there is no later place to resolve it.
      dupTitle: 'この投稿はもう保存されています',
      // "Copy" = save anyway, as a second record. Named for what it leaves
      // behind (two copies), not for the click ("保存") — the whole point of the
      // warning is that the user did not know there would be two.
      dupCopy: 'コピー',
      dupCopyHint: 'もう1件として保存します',
      dupReplace: '置換',
      dupReplaceHint: '前の保存をゴミ箱へ移し、タグと入っているフォルダを引き継ぎます',
      dupSkip: 'スキップ',
      dupSkipHint: '保存しません',
      dupSkipped: '保存しませんでした',
      // Shown after a "replace" save. The old capture goes to the trash when the
      // desktop app next runs, so the wording does not claim it is gone already.
      dupReplaced: '置き換えました（前の保存はゴミ箱へ）',
      dupSuppress: '今後この確認を出さない',
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
      bannerPostUnavailable: 'Cannot save: the post could not be fetched (deleted, private, …)',
      bannerTimedOut: 'Save timed out and was stopped. Try again (restart Chrome if it keeps happening).',
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
      bulkStopped: 'Import stopped',
      bulkFinished: 'Import finished',
      bulkSummarySaved: '$1 saved',
      bulkSummarySkipped: '$1 already saved',
      bulkSummaryDeferred: '$1 image-less saved (not shown in the library yet)',
      bulkSummaryUnavailable: '$1 unavailable (deleted or private)',
      bulkSummaryFailed: '$1 failed',

      // capture.ts / drag.ts: duplicate-save warning (#34) — see the ja notes.
      dupTitle: 'This post is already saved',
      dupCopy: 'Copy',
      dupCopyHint: 'Save it again as a second record',
      dupReplace: 'Replace',
      dupReplaceHint: 'Move the earlier save to the trash, keeping its tags and folders',
      dupSkip: 'Skip',
      dupSkipHint: "Don't save",
      dupSkipped: 'Not saved',
      dupReplaced: 'Replaced (the earlier save goes to the trash)',
      dupSuppress: "Don't ask again",
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

    const saveFailureText = (kind) =>
      getMessage(kind === 'host-missing' ? 'bannerHostMissing' : kind === 'host-unavailable' ? 'bannerHostUnavailable' : kind === 'origin-rejected' ? 'bannerOriginRejected' : kind === 'post-unavailable' ? 'bannerPostUnavailable' : kind === 'timeout' ? 'bannerTimedOut' : 'bannerFailedUnknown');

    return { lang: resolved, resolved, getMessage, partialSaveText, saveFailureText };
  })();
}
