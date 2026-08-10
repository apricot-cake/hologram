// 与えられた言語タグが、拡張機能自身が持つどのロケールとして提供されるこ
// とになるか（#1057）。「ブラウザは何語か」とは別の問いだ＝`_locales` は
// ja と en しか持たず、wxt.config.ts は `default_locale: 'en'` を設定して
// いるので、Chrome が仕様化しているルックアップ（正確なロケール → 地域を
// 除いたロケール → `default_locale`）は、この2言語の組み合わせでは下の1
// 行に潰れる。
//
// これをここで改めて書き直しているのは、Chrome がこれを何も教えてくれな
// いからだ。`chrome.i18n.getUILanguage()` も定義済みメッセージ
// `@@ui_locale` も、どちらもブラウザの UI 言語を返す。これはフォールバッ
// クが発動した瞬間、画面上の文字列と一致しなくなる＝fr-FR の Chrome は英
// 語のテーブルを読むので、そのページに `lang="fr-FR"` を書くと、フランス
// 語の音声合成に英語の文章を渡すことになる。
//
// `_locales/` にロケールを追加するときは、ここにも追加が必要になる。この
// 集合を知っているのはここ1か所だけだ（アプリのレンダラー側は同じ ja/en
// の組を app/src/renderer/src/services/i18n.ts で解決しているが、別のプロ
// セス・別のバンドルで、ブラウザではなくユーザー自身の言語設定を基準にし
// ている）。
export function servedLocale(tag: string | null | undefined): 'ja' | 'en' {
  return tag?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

// 他人のページの上に乗っている、自分たち自身の UI の一部について言語を宣
// 言する（#1057、WCAG 2.2 SC 3.1.2 Language of Parts）。中のテキストは
// i18n.ts の createI18n が navigator.language から解決した言語だが、周り
// のページはそのサイトが何語であれその言語だ＝x.com は `<html lang="en">`
// を出しているのに、バナーは「保存中...」と言う。これがなければページの
// 宣言が継承され、スクリーンリーダーが間違った言語で読み上げてしまう。隅
// の操作にとって、その読み上げこそが唯一の出力だ（overlay.ts はテキスト
// を一切描かず、その文字列は純粋にアクセシブルな名前としてのみ存在す
// る）。
//
// ツリーの中ではなく shadow の HOST に書いている: host はページ自身の宣
// 言が届く先のノードなので、上書きはそこに属するべきであり、1つの属性で
// この root が持つことになるあらゆる surface を覆える。
export function markUiLanguage(host: HTMLElement): void {
  host.lang = servedLocale(navigator.language);
}
