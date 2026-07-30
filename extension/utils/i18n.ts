// i18n helper for the extension's content scripts (capture banner + drag drop-zone).
// Manifest-level strings (name, description, action title, command descriptions)
// are handled by Chrome's native i18n via _locales/*/messages.json. The few UI
// strings below are embedded here so content scripts (which cannot fetch
// _locales/ files reliably) get them without extra network round-trips.
//
// The banner language follows the browser locale; the desktop app owns all
// viewer/settings strings in app/renderer/i18n.ts.
import type { ProtocolSkew } from '../../native-host/protocol.mts';
import type { SaveFailureKind } from './native-error.ts';

export interface HologramI18nApi {
  lang: string;
  resolved: string;
  getMessage: (key: string, subs?: ReadonlyArray<unknown>) => string;
  partialSaveText: (reason?: string | null) => string;
  saveFailureText: (kind?: SaveFailureKind | null, reason?: string | null) => string;
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
    bannerSaved: '画像を保存しました',
    // $1 = how many images of this post are saved now (2nd, 3rd, …). Shown when
    // a save hits a post already saved this session — the app folds same-post
    // records into ONE stacked card, so nothing "new" appears in the grid.
    bannerSavedGrouped: '保存しました — さっきの画像とグループ化されます（$1枚目）',
    bannerSavedNoMeta: '保存しました（投稿情報の取得に失敗）',
    // Reason-specific partial-save wording (metaReason from background.js).
    bannerSavedNoMetaProtected: '保存しました（鍵付きアカウントのため投稿情報は取得できません）',
    bannerSavedNoMetaAgeRestricted: '保存しました（年齢制限付き投稿のため投稿情報は取得できません）',
    // 拡張とアプリ側の保存プログラムの版が合っていない（#205）。⚠️「失敗」ではない＝
    // 保存自体は済んでいる。合っていない事実だけを伝え、動作は一切変えない。
    // どちらを更新すればよいかまで言い切る＝ユーザーには「どちらが古いか」を
    // 調べる手段が無い（診断ページには両方の版が並ぶ）。
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
    // 投稿そのものが取得できなかった（削除・凍結・鍵付き・年齢制限）＝壊れていない。
    // 直すものが無いので、診断ページへ誘導する bannerFailedUnknown とは別文言。
    // ⚠️どれも「何も保存されていない」と読めること＝上の bannerSavedNoMeta* は
    // 画像が保存できた上で投稿情報だけ欠けた場合で、意味が正反対（#505）。
    bannerPostUnavailable: '投稿を取得できないため、何も保存できませんでした（削除・非公開・年齢制限など）',
    bannerPostUnavailableProtected: '鍵付きアカウントのため、何も保存できませんでした',
    bannerPostUnavailableAgeRestricted: '年齢制限付き投稿のため、何も保存できませんでした（X が投稿情報を返しません）',
    // 応答が返らないまま上限に達した（#507）。原因の多くは一過性（ネットワークの
    // 詰まり・サービスワーカーの停止）なので、最も安く効く再試行を先頭に置く。
    // 診断ページへの誘導は「繰り返す場合」の第2手＝bannerFailedUnknown が持つ。
    bannerTimedOut: '保存が終わらないため中止しました。もう一度お試しください（繰り返す場合は Chrome を再起動）',
    // 同時に走っている保存が多すぎて受け付けられなかった（#323）。壊れておらず、
    // 直すものも無い＝待てば通るので、診断ページへは誘導しない。
    bannerBusy: '保存が立て込んでいます。少し待ってからもう一度お試しください',
    bannerFailedUnknown: '保存に失敗しました。拡張機能の設定から診断ページを確認してください',

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
    // Says the WORD "再試行". The old wording was the failure reason alone, so
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
    // 取得できなかった投稿（#492）。「失敗」と分けて数える＝直すもののある不具合と、
    // 投稿が既に無いだけの正常な結果を、同じ言葉で並べない。
    bulkSummaryUnavailable: '取得できず $1件（削除・非公開など）',
    // 年齢制限は上とさらに分ける（#505）＝投稿は生きていて、消えたわけではない。
    // 何度取り込み直しても同じ結果になる（Xの埋め込み用APIは匿名なので届かない）
    // ことが、削除との違いとして伝わる必要がある。
    bulkSummaryAgeRestricted: '年齢制限のため保存できず $1件',
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
    // #158: ライブラリには無いが、ゴミ箱に現物が残っている投稿。ここで保存すると
    // 気付かないまま同じ投稿を2つ持つことになる（後で復元すれば本当に2つになる）。
    // ⚠️「復元」は選択肢に出せない＝保存プログラムはライブラリに対して読み取り専用
    // で、復元はアプリ側の操作。どこにあるかだけ伝えて、戻すのはアプリに任せる。
    // 選択肢は「コピー」と「スキップ」の2つ（置換は相手の現行レコードが無い）。
    // $1 = 削除した日（時刻は出さない＝「いつ要らないと決めたか」は日単位の話）。
    trashedTitleOn: 'この投稿はゴミ箱にあります（$1 に削除）',
    // 削除日時が記録されていない場合（記録の書き込みが中断された等）。
    trashedTitle: 'この投稿はゴミ箱にあります',
  },

  en: {
    bannerSelect: 'Click a post to save (Esc or right-click to cancel)',
    bannerSaving: 'Saving...',
    bannerSaved: 'Image saved',
    bannerSavedGrouped: 'Saved — grouped with your earlier image ($1 of this post)',
    bannerSavedNoMeta: 'Saved (post info unavailable)',
    bannerSavedNoMetaProtected: 'Saved (post info unavailable: private account)',
    bannerSavedNoMetaAgeRestricted: 'Saved (post info unavailable: age-restricted post)',
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
    dupReplace: 'Replace',
    dupReplaceHint: 'Move the earlier save to the trash, keeping its tags and folders',
    dupSkip: 'Skip',
    dupSkipHint: "Don't save",
    dupSkipped: 'Not saved',
    dupReplaced: 'Replaced (the earlier save goes to the trash)',
    dupSuppress: "Don't ask again",
    // #158 — see the ja notes. Restoring is not offered: the host is read-only
    // over the library, so putting the post back is done in the app.
    trashedTitleOn: 'This post is in the trash (deleted $1)',
    trashedTitle: 'This post is in the trash',
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
    const partialSaveText = (reason) => getMessage(reason === 'protected' ? 'bannerSavedNoMetaProtected' : reason === 'ageRestricted' ? 'bannerSavedNoMetaAgeRestricted' : 'bannerSavedNoMeta');

    // Same shape as partialSaveText, but for the opposite outcome: nothing was
    // written at all. Only 'post-unavailable' takes a reason — the other kinds
    // are our own plumbing breaking, which the post has no say in (#505).
    const postUnavailableText = (reason) => getMessage(reason === 'protected' ? 'bannerPostUnavailableProtected' : reason === 'ageRestricted' ? 'bannerPostUnavailableAgeRestricted' : 'bannerPostUnavailable');

    const saveFailureText = (kind, reason?) =>
      kind === 'post-unavailable'
        ? postUnavailableText(reason)
        : getMessage(kind === 'host-missing' ? 'bannerHostMissing' : kind === 'host-unavailable' ? 'bannerHostUnavailable' : kind === 'origin-rejected' ? 'bannerOriginRejected' : kind === 'timeout' ? 'bannerTimedOut' : kind === 'busy' ? 'bannerBusy' : 'bannerFailedUnknown');

    // The save worked; the halves it travelled between did not match (#205).
    // Returns null for 'match' and for no answer yet, so this can be tried
    // FIRST by a caller and fall through to its ordinary success wording.
    const skewSaveText = (skew) => (skew === 'host-old' ? getMessage('bannerSavedHostOld') : skew === 'host-new' ? getMessage('bannerSavedExtensionOld') : null);

    return { lang: resolved, resolved, getMessage, partialSaveText, saveFailureText, skewSaveText };
  })();
}
