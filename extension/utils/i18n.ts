// i18n helper for the extension's content scripts (capture banner + drag drop-zone).
// Manifest-level strings (name, description, action title, command descriptions)
// are handled by Chrome's native i18n via _locales/*/messages.json. The few UI
// strings below are embedded here so content scripts (which cannot fetch
// _locales/ files reliably) get them without extra network round-trips.
//
// The banner language follows the browser locale; the desktop app owns all
// viewer/settings strings in app/renderer/i18n.ts.
import type { ProtocolSkew } from '../../native-host/protocol.mts';
import { domRescuedEssentials } from './extractor/dom-meta.ts';
import type { SaveFailureKind } from './native-error.ts';

export interface HologramI18nApi {
  lang: string;
  resolved: string;
  getMessage: (key: string, subs?: ReadonlyArray<unknown>) => string;
  // domFilled (#202) = the record fields the PAGE supplied because the API
  // answered nothing for them. When it rescued the author or the text, the
  // save is still partial but no longer empty, and the wording has to say so —
  // "post info unavailable" would be flatly untrue of a record that has both.
  partialSaveText: (reason?: string | null, domFilled?: readonly string[] | null) => string;
  // queued (#203): true appends bannerQueued, false appends bannerNotQueued,
  // absent/undefined appends nothing — see ErrorResponse's own `queued` doc
  // (messages.ts) for which failures carry which value.
  saveFailureText: (kind?: SaveFailureKind | null, reason?: string | null, queued?: boolean | null) => string;
  // null when there is nothing to say, so a caller can write
  // `skewText(x) ?? <its usual success wording>` (#205).
  skewSaveText: (skew?: ProtocolSkew | null) => string | null;
}

// The two tables live at module scope, and are exported, so the guards can read
// them without running a browser (#130): scripts/i18n-parity.test.ts compares
// the languages against each other, scripts/ext-consistency.test.ts compares
// them against the keys the code actually asks for. Both failures are otherwise
// invisible until a user sees a raw key on the banner.
export const MESSAGES = {
  ja: {
    // content.js capture banner
    bannerSelect: '保存する投稿をクリック（Esc または右クリックでキャンセル）',
    bannerSaving: '保存中...',
    // The unit of a save is the POST, not the image file that was clicked: the
    // app folds same-post records into ONE card, so wording this as "image"
    // contradicted what the library shows right after the banner.
    bannerSaved: '投稿を保存しました',
    // $1 = how many images of this post are saved now (2nd, 3rd, …). Shown when
    // a save hits a post already saved this session — the app folds same-post
    // records into ONE stacked card, so nothing "new" appears in the grid.
    bannerSavedGrouped: '保存しました — さっきの画像とグループ化されます（$1枚目）',
    bannerSavedNoMeta: '保存しました（投稿情報の取得に失敗）',
    // Reason-specific partial-save wording (metaReason from background.js).
    bannerSavedNoMetaProtected: '保存しました（鍵付きアカウントのため投稿情報は取得できません）',
    bannerSavedNoMetaAgeRestricted: '保存しました（年齢制限付き投稿のため投稿情報は取得できません）',
    // #202: The API returned nothing, but the body/author were read off the post as
    // shown on screen and filled in. ⚠️Do NOT promote this to success (green) = a
    // number read from the screen is an approximation like "1.2万" (roughly 12K),
    // which differs in quality from the API's exact value. Not hiding that
    // difference is partial's (amber's) job.
    // Do not state the reason (protected account / age-restricted) = once the
    // record is no longer empty, "why the API stayed silent" becomes something
    // the user does not need to act on.
    bannerSavedFromPage: '保存しました（投稿情報は画面から補完・数値は概数）',
    // The extension's and the app-side save program's versions do not match
    // (#205). ⚠️This is NOT a "failure" = the save itself already completed.
    // State only the mismatch as fact; behavior does not change at all. Say
    // outright which side to update = the user has no way to tell which one
    // is older (the diagnostics page lists both versions side by side).
    bannerSavedHostOld: '保存しました — Hologram アプリを更新してください（拡張機能と版が合っていません）',
    bannerSavedExtensionOld: '保存しました — 拡張機能を更新してください（Hologram アプリと版が合っていません）',
    // $1 = reason. Shown when a save fails with a known cause, so the banner
    // says WHY instead of a bare "failed".
    bannerFailedReason: '保存に失敗: $1',
    reasonNoPermalink: '投稿リンクを取得できません',
    // Native host not found (unregistered, or registered but Chrome not yet
    // restarted). Chrome reads native-host registrations at startup, so the
    // first suggestion is a restart.
    bannerHostMissing: 'Hologram の保存先に接続できません。Chrome を再起動してください',
    bannerHostUnavailable: 'Hologram の保存プログラムを起動できませんでした。拡張機能の設定から診断ページを確認してください',
    bannerOriginRejected: 'Hologram の保存設定が一致していません。Hologram を再インストールしてください',
    // The post itself could not be fetched (deleted, suspended, protected,
    // age-restricted) = nothing is broken. There is nothing to fix, so this is
    // worded separately from bannerFailedUnknown, which points to the
    // diagnostics page. ⚠️All of these must read as "nothing was saved" = the
    // bannerSavedNoMeta* wording above is for the opposite case, where the
    // image WAS saved and only the post info is missing (#505).
    bannerPostUnavailable: '投稿を取得できないため、何も保存できませんでした（削除・非公開・年齢制限など）',
    bannerPostUnavailableProtected: '鍵付きアカウントのため、何も保存できませんでした',
    bannerPostUnavailableAgeRestricted: '年齢制限付き投稿のため、何も保存できませんでした（X が投稿情報を返しません）',
    // Hit the timeout without ever getting a response (#507). Most causes are
    // transient (a network hiccup, the service worker stopping), so the
    // cheapest fix — retry — is offered first. Pointing to the diagnostics
    // page is the second move, for "if it keeps happening" = that belongs to
    // bannerFailedUnknown.
    bannerTimedOut: '保存が終わらないため中止しました。もう一度お試しください（繰り返す場合は Chrome を再起動）',
    // Rejected because too many saves are already running at once (#323).
    // Nothing is broken and there is nothing to fix = it will go through if
    // you wait, so this does not point to the diagnostics page.
    bannerBusy: '保存が立て込んでいます。少し待ってからもう一度お試しください',
    bannerFailedUnknown: '保存に失敗しました。拡張機能の設定から診断ページを確認してください',
    // #203: appended to a failure banner when (and only when) the save was
    // actually stashed in the retry queue — never promised on a guess.
    bannerQueued: '接続が回復したら自動で保存します',
    // #203: the companion for when the save could NOT be queued (over the
    // retry queue's byte budget even after dropping the acquisition
    // originals, or the write itself failed) — said so the "will save
    // automatically" promise above is never implied when it isn't true.
    bannerNotQueued: 'この保存は退避できず、自動では保存されません',
    // The extension was updated (or reloaded), and the script left behind in
    // this tab got detached from the extension (#594). ⚠️Unlike every other
    // failure, this one **is not broken** = the new version is fine, only
    // this page has been left behind. So there is exactly one fix, and the
    // wording states it outright. It does not point to the diagnostics page
    // (every item there would show PASS anyway), and it does not say "please
    // try again" = pressing it again in this tab can only ever give the same
    // result.
    bannerExtensionReloaded: '拡張機能が更新されました。このページを再読み込みしてください',

    // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
    dragDropHint: 'ここにドロップで Hologram に保存',

    // overlay.ts: the four faces of the control in the corner of a picture
    // (#310). Its OWN vocabulary — the corner used to borrow the banner's
    // `bannerSaving` / `bannerFailed` for two of its faces, which meant the
    // wording of a 24px circle was decided by what read well on a 300px pill.
    // These are accessible names, not tooltips: nothing here is drawn on
    // screen (see drawFace in overlay.ts for why the corner explains nothing
    // visually), so each has to be a complete sentence on its own.
    cornerSaved: 'Hologram に保存済み',
    // It says IMAGE, not post: this route saves the picture plus the post's
    // text/author, never a screenshot of how the post looks (that is Alt+S
    // element capture).
    cornerSave: '画像を保存',
    cornerSaving: '保存中',
    // Says the word "retry". The old wording was the failure reason alone, so
    // the one control whose press recovers the save never said that pressing it
    // would (#310). WHY it failed belongs to the banner, which has room for a
    // sentence and can point at the diagnostics page.
    cornerRetry: '保存に失敗しました。押すと再試行します',

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
    // Posts that could not be fetched (#492). Counted separately from
    // "failed" = do not lump a fixable defect together with the normal
    // result of a post simply no longer being there.
    bulkSummaryUnavailable: '取得できず $1件（削除・非公開など）',
    // Age-restricted is split out even further from the above (#505) = the
    // post is alive, not gone. It needs to come across as different from
    // deletion, in that re-importing it will always give the same result no
    // matter how many times (X's embed API is anonymous, so it can never
    // reach it).
    bulkSummaryAgeRestricted: '年齢制限のため保存できず $1件',
    bulkSummaryFailed: '失敗 $1件',

    // capture.ts / drag.ts: duplicate-save warning (#34). Asked BEFORE the
    // save, because the extension writes straight to disk — with the desktop
    // app closed there is no later place to resolve it.
    dupTitle: 'この投稿はもう保存されています',
    // "Copy" = save anyway, as a second record. Named for what it leaves
    // behind (two copies), not for the click ("save") — the whole point of the
    // warning is that the user did not know there would be two.
    dupCopy: 'コピー',
    dupCopyHint: 'もう1件として保存します',
    // #158: The button has the same "Copy" label, but in the trash case the
    // other copy is not on screen = the reader cannot see what is being
    // copied. Spelling out what happens to the trashed copy (it does not
    // disappear) is this wording's job alone = the plain duplicate case has
    // nothing to say here, but this one needs it.
    dupCopyHintTrashed: 'ゴミ箱の分はそのままにして、新しく保存します',
    dupReplace: '置換',
    dupReplaceHint: '前の保存をゴミ箱へ移し、タグと入っているフォルダを引き継ぎます',
    dupSkip: 'スキップ',
    dupSkipHint: '保存しません',
    dupSkipped: '保存しませんでした',
    // Shown after a "replace" save. The old capture goes to the trash when the
    // desktop app next runs, so the wording does not claim it is gone already.
    dupReplaced: '置き換えました（前の保存はゴミ箱へ）',
    dupSuppress: '今後この確認を出さない',
    // #158: A post that is not in the library but still has a physical copy
    // sitting in the trash. Saving here would leave the user with two copies
    // of the same post without realizing it (and restoring it later really
    // would make it two). ⚠️"Restore" cannot be made a button here = the save
    // program only has read-only access to the library, and restoring is an
    // app-side operation. So **the wording has to tell the user where to go
    // instead** = merely informing them would end at "something that
    // disappeared has come back", without ever conveying that there is a way
    // back. The choices are just "Copy" and "Skip" (there is no current
    // record on the other side to "Replace"). $1 = the day it was deleted (no
    // time of day = "when it was decided to be unneeded" is a day-level
    // fact).
    trashedTitleOn: 'この投稿はゴミ箱にあります（$1 に削除）。Hologram で元に戻せます',
    // For when the deletion date/time was not recorded (e.g. the write was interrupted).
    trashedTitle: 'この投稿はゴミ箱にあります。Hologram で元に戻せます',
  },

  en: {
    bannerSelect: 'Click a post to save (Esc or right-click to cancel)',
    bannerSaving: 'Saving...',
    bannerSaved: 'Post saved',
    bannerSavedGrouped: 'Saved — grouped with your earlier image ($1 of this post)',
    bannerSavedNoMeta: 'Saved (post info unavailable)',
    bannerSavedNoMetaProtected: 'Saved (post info unavailable: private account)',
    bannerSavedNoMetaAgeRestricted: 'Saved (post info unavailable: age-restricted post)',
    // See the ja note: the API gave nothing, the page did. Still amber — the
    // counts read off the page are rounded ("1.2K"), the API's are exact.
    bannerSavedFromPage: 'Saved (post info read from the page; counts are approximate)',
    // See the ja notes: the save SUCCEEDED, the two halves are out of step.
    bannerSavedHostOld: 'Saved — please update the Hologram app (it no longer matches this extension)',
    bannerSavedExtensionOld: 'Saved — please update the extension (it no longer matches the Hologram app)',
    bannerFailedReason: 'Save failed: $1',
    reasonNoPermalink: 'could not find the post link',
    bannerHostMissing: "Can't reach Hologram's saver. Please restart Chrome.",
    bannerHostUnavailable: "Hologram's saver could not start. Open the diagnostics page from the extension settings.",
    bannerOriginRejected: "Hologram's save configuration does not match. Reinstall Hologram.",
    bannerPostUnavailable: 'Nothing was saved: the post could not be fetched (deleted, private, age-restricted, …)',
    bannerPostUnavailableProtected: 'Nothing was saved: this account limits who can view its posts',
    bannerPostUnavailableAgeRestricted: 'Nothing was saved: age-restricted post (X serves no post info for it)',
    bannerTimedOut: 'Save timed out and was stopped. Try again (restart Chrome if it keeps happening).',
    // See the ja note: too many saves at once, nothing broken, no diagnostics.
    bannerBusy: 'Too many saves at once. Wait a moment and try again.',
    bannerFailedUnknown: 'Save failed. Open the diagnostics page from the extension settings.',
    // See the ja notes: appended only when the save was actually queued for
    // retry (#203).
    bannerQueued: 'Will save automatically once the connection is back.',
    bannerNotQueued: "This save could not be queued and won't be retried automatically.",
    // See the ja note: nothing is broken — this tab was left behind by an
    // update. One repair, no retry, no diagnostics page.
    bannerExtensionReloaded: 'The extension was updated. Please reload this page.',

    // drag.js: drop-zone hint (the toasts reuse the banner* keys above)
    dragDropHint: 'Drop here to save to Hologram',

    // overlay.ts: the corner control's four faces — accessible names, not
    // tooltips (see the ja notes).
    cornerSaved: 'Saved in Hologram',
    cornerSave: 'Save image',
    cornerSaving: 'Saving',
    cornerRetry: 'Save failed. Press to retry',

    // bulk-capture.ts: X bookmarks chase-mode intake banner (#362)
    bulkStop: 'Stop',
    bulkProgress: 'Saved $1 · already saved $2',
    bulkStopped: 'Import stopped',
    bulkFinished: 'Import finished',
    bulkSummarySaved: '$1 saved',
    bulkSummarySkipped: '$1 already saved',
    bulkSummaryDeferred: '$1 image-less saved (not shown in the library yet)',
    bulkSummaryUnavailable: '$1 unavailable (deleted or private)',
    bulkSummaryAgeRestricted: '$1 not saved (age-restricted)',
    bulkSummaryFailed: '$1 failed',

    // capture.ts / drag.ts: duplicate-save warning (#34) — see the ja notes.
    dupTitle: 'This post is already saved',
    dupCopy: 'Copy',
    dupCopyHint: 'Save it again as a second record',
    // #158 — see the ja note. Same button name, different situation: nothing is
    // on screen to copy, and what happens to the trashed one has to be said here.
    dupCopyHintTrashed: 'Save a new record, leaving the trashed one alone',
    dupReplace: 'Replace',
    dupReplaceHint: 'Move the earlier save to the trash, keeping its tags and folders',
    dupSkip: 'Skip',
    dupSkipHint: "Don't save",
    dupSkipped: 'Not saved',
    dupReplaced: 'Replaced (the earlier save goes to the trash)',
    dupSuppress: "Don't ask again",
    // #158 — see the ja notes. Restoring is not offered: the host is read-only
    // over the library, so putting the post back is done in the app.
    trashedTitleOn: 'This post is in the trash (deleted $1). You can restore it in Hologram',
    trashedTitle: 'This post is in the trash. You can restore it in Hologram',
  },
};

export function createI18n(): Promise<HologramI18nApi> {
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
    //
    // The DOM-rescued case (#202) is checked FIRST and ignores the reason: the
    // reason-specific strings all end in "the post info cannot be obtained",
    // and once the page has supplied the author or the text that sentence is
    // the wrong one to show — WHY the API stayed silent stopped mattering the
    // moment the record stopped being empty. The state stays amber either way,
    // because page-read counts are approximate and the API's are not.
    const partialSaveText = (reason, domFilled?) => (domRescuedEssentials(domFilled) ? getMessage('bannerSavedFromPage') : getMessage(reason === 'protected' ? 'bannerSavedNoMetaProtected' : reason === 'ageRestricted' ? 'bannerSavedNoMetaAgeRestricted' : 'bannerSavedNoMeta'));

    // Same shape as partialSaveText, but for the opposite outcome: nothing was
    // written at all. Only 'post-unavailable' takes a reason — the other kinds
    // are our own plumbing breaking, which the post has no say in (#505).
    const postUnavailableText = (reason) => getMessage(reason === 'protected' ? 'bannerPostUnavailableProtected' : reason === 'ageRestricted' ? 'bannerPostUnavailableAgeRestricted' : 'bannerPostUnavailable');

    const saveFailureText = (kind, reason?, queued?) => {
      const base =
        kind === 'post-unavailable'
          ? postUnavailableText(reason)
          : getMessage(kind === 'host-missing' ? 'bannerHostMissing' : kind === 'host-unavailable' ? 'bannerHostUnavailable' : kind === 'origin-rejected' ? 'bannerOriginRejected' : kind === 'timeout' ? 'bannerTimedOut' : kind === 'busy' ? 'bannerBusy' : 'bannerFailedUnknown');
      // #203: layered on top of the base reason, never in place of it — a
      // save can be both "the host timed out" AND "queued for retry" at
      // once. queued is undefined for every failure that never reached the
      // retry queue's own check at all (busy, a route that isn't queueable,
      // an answer the host actually gave), and then nothing is appended.
      if (queued === true) return `${base} ${getMessage('bannerQueued')}`;
      if (queued === false) return `${base} ${getMessage('bannerNotQueued')}`;
      return base;
    };

    // The save worked; the halves it travelled between did not match (#205).
    // Returns null for 'match' and for no answer yet, so this can be tried
    // FIRST by a caller and fall through to its ordinary success wording.
    const skewSaveText = (skew) => (skew === 'host-old' ? getMessage('bannerSavedHostOld') : skew === 'host-new' ? getMessage('bannerSavedExtensionOld') : null);

    return { lang: resolved, resolved, getMessage, partialSaveText, saveFailureText, skewSaveText };
  })();
}
