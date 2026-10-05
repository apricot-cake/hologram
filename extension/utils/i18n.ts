// 拡張機能の content script（キャプチャバナー＋ドラッグのドロップゾー
// ン）用の i18n ヘルパー。マニフェストレベルの文字列（name、
// description、action title、コマンドの説明）は Chrome ネイティブの
// i18n が _locales/*/messages.json 経由で扱う。以下のわずかな UI 文字
// 列をここに埋め込んでいるのは、content script（_locales/ のファイル
// を確実には fetch できない）が余分なネットワークの往復なしにそれらを
// 得られるようにするためだ。
//
// バナーの言語はブラウザのロケールに従う。表示側/設定のすべての文字列
// はデスクトップアプリが app/renderer/i18n.ts で持つ。
import type { ProtocolSkew } from '../../native-host/protocol.mts';
import { domRescuedEssentials } from './extractor/dom-meta.ts';
import { servedLocale } from './locale.ts';
import type { SaveFailureKind } from './native-error.ts';

export interface HologramI18nApi {
  lang: string;
  resolved: string;
  getMessage: (key: string, subs?: ReadonlyArray<unknown>) => string;
  // 投稿情報を画面から取得できた場合は、警告不要として null を返す。
  partialSaveText: (reason?: string | null, domFilled?: readonly string[] | null) => string | null;
  // queued（#203）: true なら bannerQueued を、false なら
  // bannerNotQueued を追加し、未設定/undefined なら何も追加しない＝ど
  // の失敗がどの値を運ぶかは ErrorResponse 自身の `queued` のドキュメ
  // ント（messages.ts）を参照。
  saveFailureText: (kind?: SaveFailureKind | null, reason?: string | null, queued?: boolean | null) => string;
  // 言うべきことが何もないときは null にする。それによって呼び出し元
  // は `skewText(x) ?? <通常の成功時の文言>` と書ける（#205）。
  skewSaveText: (skew?: ProtocolSkew | null) => string | null;
}

// この2つの表はモジュールスコープに置かれ、export もされている。それ
// によって各種の番人がブラウザを動かさずにこれらを読める（#130）:
// tests/integration/i18n-parity.test.ts は言語同士を比較し、
// tests/integration/ext-consistency.extension-bundle.test.ts はコードが実際に求めているキーと突
// き合わせる。どちらの失敗も、そうしなければユーザーがバナーに生のキー
// を見るまで見えないままになる。
export const MESSAGES = {
  ja: {
    toastProgress: '保存中 $1件',
    toastSaved: '$1件保存しました',
    toastFailed: '$1件保存できませんでした',
    toastFailedSingle: '保存できませんでした',
    toastDetails: '詳細',
    toastFailureDetails: '保存できなかった投稿',
    toastRetry: '再試行',
    toastOpenOriginal: '元の投稿を開く',
    savePartPost: '投稿情報',
    savePartProfile: '投稿者情報',
    savePartText: '本文',
    savePartMedia: '画像・動画',
    savePartMediaCount: '画像・動画 $1件',
    savePartSeparator: '・',
    savePartsFailed: '$1を保存できませんでした',
    savePartsSaved: '$1は保存済み',
    saveNothingSaved: '保存できませんでした',
    toastClose: '閉じる',
    // content.js キャプチャバナー
    // 保存の単位はクリックされた画像ファイルではなく投稿だ: アプリは
    // 同じ投稿のレコードを1枚のカードに折りたたむので、これを
    // 「image」と言う文言にすると、バナーの直後にライブラリが見せるも
    // のと矛盾していた。
    // $1 = この投稿の画像が今何枚保存されているか（2枚目、3枚目、…）。
    // このセッションですでに保存済みの投稿へ保存が当たったときに表示
    // する＝アプリは同じ投稿のレコードを1枚の重なったカードに折りたた
    // むので、グリッドには「新しいもの」が何も現れない。
    bannerSavedNoMeta: '保存しました（投稿情報の取得に失敗）',
    // 理由ごとの一部欠けた保存の文言（background.js からの
    // metaReason）。
    bannerSavedNoMetaProtected: '保存しました（鍵付きアカウントのため投稿情報は取得できません）',
    bannerSavedNoMetaAgeRestricted: '保存しました（年齢制限付き投稿のため投稿情報は取得できません）',
    // 拡張機能とアプリ側の保存プログラムのバージョンが一致していない
    // （#205）。⚠️これは「失敗」ではない＝保存自体はすでに完了してい
    // る。不一致という事実だけを述べる。挙動は一切変わらない。どちら
    // を更新すべきか率直に言う＝ユーザーにはどちらが古いか判断する手
    // 段がない（診断ページが両方のバージョンを並べて一覧する）。
    bannerSavedHostOld: '保存しました。拡張機能とバージョンが一致していません。Hologram アプリを更新してください。',
    bannerSavedExtensionOld: '保存しました。Hologram アプリとバージョンが一致していません。拡張機能を更新してください。',
    // $1 = 理由。既知の原因で保存が失敗したときに表示し、バナーが素の
    // 「失敗」ではなく理由を言えるようにする。
    // native host が見つからない（未登録、または登録済みだが Chrome
    // がまだ再起動していない）。Chrome は起動時に native-host の登録を
    // 読むので、最初の提案は再起動になる。
    bannerHostMissing: 'アプリに接続できません',
    bannerHostUnavailable: 'アプリに接続できません',
    bannerOriginRejected: '保存に必要な設定を確認してください',
    // 投稿自体を取得できなかった（削除・凍結・非公開・年齢制限）=何も
    // 壊れていない。直すものが何もないので、診断ページを指す
    // bannerFailedUnknown とは分けて文言にしてある。⚠️これらはすべて
    // 「何も保存されなかった」と読めなければならない＝上の
    // bannerSavedNoMeta* の文言は逆のケース（画像は保存されたが投稿情
    // 報だけが欠けている、#505）のためのものだ。
    // 一度も応答を得られないままタイムアウトに達した（#507）。原因の
    // ほとんどは一時的なもの（ネットワークの瞬断、service worker の停
    // 止）なので、最も安く済む直し方＝再試行を最初に提示する。診断
    // ページを指すのは2番目の一手で、「それでも繰り返す場合」向け＝そ
    // れは bannerFailedUnknown の役目だ。
    // すでに同時に多すぎる保存が走っているために拒否された（#323）。
    // 何も壊れておらず直すものもない＝待てば通るので、これは診断ページ
    // を指さない。
    bannerBusy: '保存が集中しています。少し待ってからもう一度試してください。',
    bannerFailedUnknown: '保存できませんでした',
    // #203: 保存が実際に再試行キューへ退避されたとき（そのときだけ）
    // 失敗バナーに追加する＝推測で約束することは絶対にない。
    bannerQueued: '接続が戻るまで保存を待機しています',
    // #203: 保存をキューに入れられなかったとき（原本を落としてもなお
    // 再試行キューのバイト予算を超える、または書き込み自体が失敗し
    // た）の対となる文言＝これによって上の「自動で保存する」という約
    // 束が、実際にはそうでないときに暗示されることがないようにしてい
    // る。
    bannerNotQueued: 'この保存は退避できませんでした。自動では再試行しません。',
    // 拡張機能が更新（またはリロード）され、このタブに取り残されたス
    // クリプトが拡張機能から切り離された（#594）。⚠️他のすべての失敗
    // と違い、これは壊れていない＝新しいバージョンは正常で、このペー
    // ジだけが取り残されている。だから直し方はちょうど1つで、文言はそ
    // れを率直に述べる。診断ページは指さない（そこにある項目はどのみ
    // ちすべて PASS を示すだけだ）し、「もう一度お試しください」とも
    // 言わない＝このタブで再度押しても、絶対に同じ結果にしかならない。
    bannerExtensionReloaded: '拡張機能を更新しました。このページを再読み込みしてください。',

    // overlay.ts: 投稿の隅にある操作の4つの面（#310）。専用の語彙だ＝
    // 以前は隅がバナーの `bannerSaving` / `bannerFailed` を2つの面のた
    // めに借りていて、それは24pxの円の文言が300pxのピルで読みやすい言
    // い回しによって決まっていたということだ。これらはアクセシブルな
    // 名前であって tooltip ではない: ここには画面に描かれるものが何も
    // ない（隅が視覚的には何も説明しない理由は overlay.ts の drawFace
    // を参照）ので、それぞれが単独で完結した文でなければならない。
    cornerOpenSaved: '保存済みの投稿を Hologram で開く',
    cornerSave: '投稿を保存',
    cornerSaveImage: 'この画像を保存',
    cornerSaveAll: '投稿の画像をすべて保存',
    cornerSaving: '保存中',
    // 「再試行」という言葉を言う。以前の文言は失敗理由だけだったの
    // で、押すと保存を回復させる唯一の操作が、押すとそうなるとは一度
    // も言っていなかった（#310）。なぜ失敗したかはバナーの役目で、そ
    // ちらには一文の余裕があり診断ページも指し示せる。
    cornerRetry: '保存に失敗しました。押すと再試行します。',

    // bulk-capture.ts: chase モードの取り込みバナー（#362、#280 で X 以外にも一般化）
    bulkIntro: 'ブックマークを Hologram に取り込みますか？',
    bulkStart: '開始',
    bulkNeverShow: '今後表示しない',
    bulkCloseIntro: '今回の案内を閉じる',
    bulkStop: '中断',
    // $1 = 保存件数、$2 = 保存済みでスキップした件数
    bulkProgress: '保存 $1件・保存済みスキップ $2件',
    // 一覧が最初から全件読み込まれているサイト（#280 — pixiv）は、上
    // の素の実行中カウントの代わりに合計を表示する。$1 = 今の一覧の合
    // 計、$2 = そのうち最終結果に達した件数、$3 = 保存件数、$4 = 保存
    // 済みでスキップした件数。
    bulkProgressTotal: '対象 $1件中 $2件処理（保存 $3件・保存済みスキップ $4件）',
    bulkStopped: '取込を中断しました',
    bulkFinished: '取込が完了しました',
    bulkSummarySaved: '保存 $1件',
    bulkSummarySkipped: '保存済み $1件',
    // 取得できなかった投稿（#492）。「失敗」とは分けて数える＝直せる
    // 欠陥と、投稿が単に消えているだけという普通の結果を一緒くたにし
    // ない。
    // 年齢制限は上のものからさらに分けてある（#505）＝投稿は消えたの
    // ではなく生きている。削除とは違うものとして伝わる必要がある。何
    // 回再取り込みしても常に同じ結果になるという点で（X の embed
    // API は匿名なので、絶対にそこへ到達できない）。
  },

  en: {
    toastProgress: 'Saving $1',
    toastSaved: 'Saved $1',
    toastFailed: 'Could not save $1',
    toastFailedSingle: 'Could not save',
    toastDetails: 'Details',
    toastFailureDetails: 'Posts that could not be saved',
    toastRetry: 'Retry',
    toastOpenOriginal: 'Open original post',
    savePartPost: 'post information',
    savePartProfile: 'author information',
    savePartText: 'text',
    savePartMedia: 'images and videos',
    savePartMediaCount: '$1 media item(s)',
    savePartSeparator: ', ',
    savePartsFailed: 'Could not save $1',
    savePartsSaved: 'Saved: $1',
    saveNothingSaved: 'Could not save',
    toastClose: 'Close',
    bannerSavedNoMeta: 'Saved (post info unavailable)',
    bannerSavedNoMetaProtected: 'Saved (post info unavailable: private account)',
    bannerSavedNoMetaAgeRestricted: 'Saved (post info unavailable: age-restricted post)',
    // ja の注記を参照: API は何も返さず、ページが返した。それでも琥珀
    // 色＝ページから読んだ数は丸められている（"1.2K"）が、API の数は
    // 正確だ。
    // ja の注記を参照: 保存は成功した。2つの半分がずれているだけだ。
    bannerSavedHostOld: 'Saved — please update the Hologram app (it no longer matches this extension)',
    bannerSavedExtensionOld: 'Saved — please update the extension (it no longer matches the Hologram app)',
    bannerHostMissing: "Can't connect to the app",
    bannerHostUnavailable: "Can't connect to the app",
    bannerOriginRejected: 'Check the save configuration',
    // ja の注記を参照: 一度に多すぎる保存、何も壊れていない、診断な
    // し。
    bannerBusy: 'Too many saves at once. Wait a moment and try again.',
    bannerFailedUnknown: 'Could not save',
    // ja の注記を参照: 実際に再試行用にキューへ入ったときだけ追加する
    // （#203）。
    bannerQueued: 'Will save automatically once the connection is back.',
    bannerNotQueued: "This save could not be queued and won't be retried automatically.",
    // ja の注記を参照: 何も壊れていない＝このタブは更新によって取り残
    // された。直し方は1つ、再試行なし、診断ページなし。
    bannerExtensionReloaded: 'The extension was updated. Please reload this page.',

    // overlay.ts: 隅の操作の4つの面＝アクセシブルな名前であって
    // tooltip ではない（ja の注記を参照）。
    cornerOpenSaved: 'Open saved post in Hologram',
    cornerSave: 'Save post',
    cornerSaveImage: 'Save this image',
    cornerSaveAll: 'Save all post images',
    cornerSaving: 'Saving',
    cornerRetry: 'Save failed. Press to retry',

    // bulk-capture.ts: chase モードの取り込みバナー（#362、#280 で X 以外にも一般化）
    bulkIntro: 'Import your bookmarks into Hologram?',
    bulkStart: 'Start importing',
    bulkNeverShow: 'Don’t show again',
    bulkCloseIntro: 'Dismiss this notice',
    bulkStop: 'Stop',
    bulkProgress: 'Saved $1 · already saved $2',
    // $1 = 今の一覧の合計、$2 = そのうち最終結果に達した件数、$3 = 保
    // 存件数、$4 = 保存済みでスキップした件数。
    bulkProgressTotal: '$2 of $1 processed (saved $3 · already saved $4)',
    bulkStopped: 'Import stopped',
    bulkFinished: 'Import finished',
    bulkSummarySaved: '$1 saved',
    bulkSummarySkipped: '$1 already saved',
  },
};

export function createI18n(): Promise<HologramI18nApi> {
  return (async () => {
    // バナーはブラウザのロケールに従う。拡張機能はもう言語設定を保持
    // しない（表示側はデスクトップアプリへ移り、アプリは content
    // script が読めない config.json に自分の設定を持つ）。
    const resolved = servedLocale(navigator.language);
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

    // 一部欠けた保存の文言: background が投稿情報の欠落理由
    // （metaReason）を分類していれば理由別の文字列を選び、分類されて
    // いない失敗では汎用のものへフォールバックする。
    //
    // 画面から投稿情報を取得できた場合、取得元や数値の概数だけでは警告しない。
    const partialSaveText = (reason, domFilled?) => (domRescuedEssentials(domFilled) ? null : getMessage(reason === 'protected' ? 'bannerSavedNoMetaProtected' : reason === 'ageRestricted' ? 'bannerSavedNoMetaAgeRestricted' : 'bannerSavedNoMeta'));

    // partialSaveText と同じ形だが、逆の結果向け: 何も書き込まれな
    // かった場合。理由を取るのは 'post-unavailable' だけで、他の種類
    // はこちら側の配管が壊れているだけで、投稿には関係がない（#505）。

    const saveFailureText = (kind, _reason?, queued?) => {
      if (queued === true) return getMessage('bannerQueued');
      const base = kind === 'post-unavailable' ? getMessage('bannerFailedUnknown') : getMessage(kind === 'host-missing' ? 'bannerHostMissing' : kind === 'host-unavailable' ? 'bannerHostUnavailable' : kind === 'origin-rejected' ? 'bannerOriginRejected' : kind === 'busy' ? 'bannerBusy' : 'bannerFailedUnknown');
      // #203: 基本の理由を置き換えるのではなく、その上に重ねる＝1回
      // の保存が「host がタイムアウトした」かつ「再試行用にキューへ
      // 入った」の両方でありうる。再試行キュー自身のチェックにそもそ
      // も到達しなかったすべての失敗（busy、キューに入れられない経
      // 路、host が実際に答えを返した場合）では queued は undefined
      // で、その場合は何も追加しない。
      if (queued === false) return `${base} ${getMessage('bannerNotQueued')}`;
      return base;
    };

    // 保存はうまくいったが、それが行き来した両半分が一致していなかっ
    // た（#205）。'match' のときとまだ答えがないときは null を返すの
    // で、呼び出し元はこれを最初に試し、通常の成功時の文言へフォール
    // スルーできる。
    const skewSaveText = (skew) => (skew === 'host-old' ? getMessage('bannerSavedHostOld') : skew === 'host-new' ? getMessage('bannerSavedExtensionOld') : null);

    return { lang: resolved, resolved, getMessage, partialSaveText, saveFailureText, skewSaveText };
  })();
}
