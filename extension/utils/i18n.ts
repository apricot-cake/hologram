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
  // domFilled（#202）= API がそれらに何も答えなかったためページが供給
  // したレコードの欄。それが投稿者やテキストを救い出していたら、保存
  // は依然として一部欠けているが、もう空ではなく、文言はそれを言わな
  // ければならない＝両方を持つレコードに「投稿情報が取得できません」
  // は端的に事実と違う。
  partialSaveText: (reason?: string | null, domFilled?: readonly string[] | null) => string;
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
    // content.js キャプチャバナー
    // 保存の単位はクリックされた画像ファイルではなく投稿だ: アプリは
    // 同じ投稿のレコードを1枚のカードに折りたたむので、これを
    // 「image」と言う文言にすると、バナーの直後にライブラリが見せるも
    // のと矛盾していた。
    // $1 = この投稿の画像が今何枚保存されているか（2枚目、3枚目、…）。
    // このセッションですでに保存済みの投稿へ保存が当たったときに表示
    // する＝アプリは同じ投稿のレコードを1枚の重なったカードに折りたた
    // むので、グリッドには「新しいもの」が何も現れない。
    bannerSavedMissingMedia: '保存は完了しましたが、原寸画像 $1枚が未保存です。作品ページで各画像を個別に保存できます。',
    bannerSavedNoMeta: '保存しました（投稿情報の取得に失敗）',
    // 理由ごとの一部欠けた保存の文言（background.js からの
    // metaReason）。
    bannerSavedNoMetaProtected: '保存しました（鍵付きアカウントのため投稿情報は取得できません）',
    bannerSavedNoMetaAgeRestricted: '保存しました（年齢制限付き投稿のため投稿情報は取得できません）',
    // #202: API は何も返さなかったが、本文/投稿者は画面表示から読み取っ
    // て埋めた。⚠️これを成功（緑）に格上げしてはいけない＝画面から読ん
    // だ数字は「1.2万」のような概数であり、API の正確な値とは品質が違
    // う。その違いを隠さないことこそが partial（琥珀色）の仕事だ。
    // 理由（鍵アカウント/年齢制限）は述べない＝レコードが空でなくなっ
    // た時点で、「API がなぜ黙っていたか」はユーザーが対応する必要のな
    // いことになる。
    bannerSavedFromPage: '保存しました。投稿情報は画面から補完しています。数値は概数です。',
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
    bannerHostMissing: 'Hologram の保存先に接続できません。Chrome を再起動してください',
    bannerHostUnavailable: 'Hologram の保存プログラムを起動できませんでした。拡張機能の設定から診断ページを開いてください。',
    bannerOriginRejected: 'Hologram の保存設定が一致していません。Hologram を再インストールしてください',
    // 投稿自体を取得できなかった（削除・凍結・非公開・年齢制限）=何も
    // 壊れていない。直すものが何もないので、診断ページを指す
    // bannerFailedUnknown とは分けて文言にしてある。⚠️これらはすべて
    // 「何も保存されなかった」と読めなければならない＝上の
    // bannerSavedNoMeta* の文言は逆のケース（画像は保存されたが投稿情
    // 報だけが欠けている、#505）のためのものだ。
    bannerPostUnavailable: '投稿を取得できないため、何も保存できませんでした（削除・非公開・年齢制限など）',
    bannerPostUnavailableProtected: '鍵付きアカウントのため、何も保存できませんでした',
    bannerPostUnavailableAgeRestricted: '年齢制限付き投稿のため、何も保存できませんでした（X が投稿情報を返しません）',
    // 一度も応答を得られないままタイムアウトに達した（#507）。原因の
    // ほとんどは一時的なもの（ネットワークの瞬断、service worker の停
    // 止）なので、最も安く済む直し方＝再試行を最初に提示する。診断
    // ページを指すのは2番目の一手で、「それでも繰り返す場合」向け＝そ
    // れは bannerFailedUnknown の役目だ。
    bannerTimedOut: '保存が完了しないため中止しました。もう一度試してください。繰り返す場合は Chrome を再起動してください。',
    // すでに同時に多すぎる保存が走っているために拒否された（#323）。
    // 何も壊れておらず直すものもない＝待てば通るので、これは診断ページ
    // を指さない。
    bannerBusy: '保存が集中しています。少し待ってからもう一度試してください。',
    bannerFailedUnknown: '保存に失敗しました。拡張機能の設定から診断ページを開いてください。',
    // #203: 保存が実際に再試行キューへ退避されたとき（そのときだけ）
    // 失敗バナーに追加する＝推測で約束することは絶対にない。
    bannerQueued: '接続が回復したら自動で保存します。',
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
    cornerSaved: 'Hologram に保存済み',
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
    bulkSummaryUnavailable: '取得できず $1件（削除・非公開など）',
    // 年齢制限は上のものからさらに分けてある（#505）＝投稿は消えたの
    // ではなく生きている。削除とは違うものとして伝わる必要がある。何
    // 回再取り込みしても常に同じ結果になるという点で（X の embed
    // API は匿名なので、絶対にそこへ到達できない）。
    bulkSummaryAgeRestricted: '年齢制限のため保存できず $1件',
    bulkSummaryFailed: '失敗 $1件',
  },

  en: {
    bannerSavedMissingMedia: 'Saved, but $1 original image(s) remain unsaved. Save them individually from the artwork page.',
    bannerSavedNoMeta: 'Saved (post info unavailable)',
    bannerSavedNoMetaProtected: 'Saved (post info unavailable: private account)',
    bannerSavedNoMetaAgeRestricted: 'Saved (post info unavailable: age-restricted post)',
    // ja の注記を参照: API は何も返さず、ページが返した。それでも琥珀
    // 色＝ページから読んだ数は丸められている（"1.2K"）が、API の数は
    // 正確だ。
    bannerSavedFromPage: 'Saved (post info read from the page; counts are approximate)',
    // ja の注記を参照: 保存は成功した。2つの半分がずれているだけだ。
    bannerSavedHostOld: 'Saved — please update the Hologram app (it no longer matches this extension)',
    bannerSavedExtensionOld: 'Saved — please update the extension (it no longer matches the Hologram app)',
    bannerHostMissing: "Can't reach Hologram's saver. Please restart Chrome.",
    bannerHostUnavailable: "Hologram's saver could not start. Open the diagnostics page from the extension settings.",
    bannerOriginRejected: "Hologram's save configuration does not match. Reinstall Hologram.",
    bannerPostUnavailable: 'Nothing was saved: the post could not be fetched (deleted, private, age-restricted, …)',
    bannerPostUnavailableProtected: 'Nothing was saved: this account limits who can view its posts',
    bannerPostUnavailableAgeRestricted: 'Nothing was saved: age-restricted post (X serves no post info for it)',
    bannerTimedOut: 'Save timed out and was stopped. Try again (restart Chrome if it keeps happening).',
    // ja の注記を参照: 一度に多すぎる保存、何も壊れていない、診断な
    // し。
    bannerBusy: 'Too many saves at once. Wait a moment and try again.',
    bannerFailedUnknown: 'Save failed. Open the diagnostics page from the extension settings.',
    // ja の注記を参照: 実際に再試行用にキューへ入ったときだけ追加する
    // （#203）。
    bannerQueued: 'Will save automatically once the connection is back.',
    bannerNotQueued: "This save could not be queued and won't be retried automatically.",
    // ja の注記を参照: 何も壊れていない＝このタブは更新によって取り残
    // された。直し方は1つ、再試行なし、診断ページなし。
    bannerExtensionReloaded: 'The extension was updated. Please reload this page.',

    // overlay.ts: 隅の操作の4つの面＝アクセシブルな名前であって
    // tooltip ではない（ja の注記を参照）。
    cornerSaved: 'Saved in Hologram',
    cornerSave: 'Save post',
    cornerSaveImage: 'Save this image',
    cornerSaveAll: 'Save all post images',
    cornerSaving: 'Saving',
    cornerRetry: 'Save failed. Press to retry',

    // bulk-capture.ts: chase モードの取り込みバナー（#362、#280 で X 以外にも一般化）
    bulkStop: 'Stop',
    bulkProgress: 'Saved $1 · already saved $2',
    // $1 = 今の一覧の合計、$2 = そのうち最終結果に達した件数、$3 = 保
    // 存件数、$4 = 保存済みでスキップした件数。
    bulkProgressTotal: '$2 of $1 processed (saved $3 · already saved $4)',
    bulkStopped: 'Import stopped',
    bulkFinished: 'Import finished',
    bulkSummarySaved: '$1 saved',
    bulkSummarySkipped: '$1 already saved',
    bulkSummaryUnavailable: '$1 unavailable (deleted or private)',
    bulkSummaryAgeRestricted: '$1 not saved (age-restricted)',
    bulkSummaryFailed: '$1 failed',
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
    // DOM で救い出したケース（#202）を最初にチェックし、理由を無視す
    // る: 理由別の文字列はどれも「投稿情報を取得できません」で終わっ
    // ていて、ページが投稿者やテキストを供給していたら、その文は表示
    // すべきでない＝レコードが空でなくなった瞬間、API がなぜ黙ってい
    // たかは重要でなくなる。どちらにせよ状態は琥珀色のままだ。ページ
    // から読んだ数字は概数で、API のものはそうではないから。
    const partialSaveText = (reason, domFilled?) => (domRescuedEssentials(domFilled) ? getMessage('bannerSavedFromPage') : getMessage(reason === 'protected' ? 'bannerSavedNoMetaProtected' : reason === 'ageRestricted' ? 'bannerSavedNoMetaAgeRestricted' : 'bannerSavedNoMeta'));

    // partialSaveText と同じ形だが、逆の結果向け: 何も書き込まれな
    // かった場合。理由を取るのは 'post-unavailable' だけで、他の種類
    // はこちら側の配管が壊れているだけで、投稿には関係がない（#505）。
    const postUnavailableText = (reason) => getMessage(reason === 'protected' ? 'bannerPostUnavailableProtected' : reason === 'ageRestricted' ? 'bannerPostUnavailableAgeRestricted' : 'bannerPostUnavailable');

    const saveFailureText = (kind, reason?, queued?) => {
      const base =
        kind === 'post-unavailable'
          ? postUnavailableText(reason)
          : getMessage(kind === 'host-missing' ? 'bannerHostMissing' : kind === 'host-unavailable' ? 'bannerHostUnavailable' : kind === 'origin-rejected' ? 'bannerOriginRejected' : kind === 'timeout' ? 'bannerTimedOut' : kind === 'busy' ? 'bannerBusy' : 'bannerFailedUnknown');
      // #203: 基本の理由を置き換えるのではなく、その上に重ねる＝1回
      // の保存が「host がタイムアウトした」かつ「再試行用にキューへ
      // 入った」の両方でありうる。再試行キュー自身のチェックにそもそ
      // も到達しなかったすべての失敗（busy、キューに入れられない経
      // 路、host が実際に答えを返した場合）では queued は undefined
      // で、その場合は何も追加しない。
      if (queued === true) return `${base} ${getMessage('bannerQueued')}`;
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
