# 表示言語を追加する

Hologram が現在提供している表示言語は日本語（`ja`）と英語（`en`）です。新しい言語は、デスクトップアプリと Chrome 拡張機能の両方にそろった訳を出荷します。どちらか片方だけを増やすことはしません。

アプリでは設定から言語を選べ、`auto` は OS の言語に従います。拡張機能はブラウザの UI 言語に従い、拡張機能側に別の言語設定はありません。

## 訳を直す・補う

既存言語の訳の修正はプルリクエストで受け付けます。本文の文脈が分かるようにし、[貢献者ガイドライン](../.github/CONTRIBUTING.md)に従ってください。言語話者によるレビューを特に歓迎します。

数・日時・固有名詞の扱いは、その言語の自然な表現を優先します。置換スロット（アプリとページ内 UI の `$1`、Chrome メッセージの `$COUNT$` など）は、意味と数を変えずに残してください。Chrome の `messages.json` にある `description` と `placeholders` は翻訳者のための文脈なので、削除・改名しません。[Chrome のメッセージ形式](https://developer.chrome.com/docs/extensions/how-to/ui/localization-message-formats)を参照してください。

## 新しい言語を提案する

対応言語を増やす提案は、[機能を提案する Issue](https://github.com/apricot-cake/hologram/issues/new?template=feature_request.yml) に出してください。対象のロケール、訳を保守・レビューできる人、アプリと拡張機能の両方を確認できる環境を記します。

ロケール名は Chrome が対応するものを使います。Chrome は `_locales/<locale>/messages.json` を読み、完全一致、地域なし、`default_locale` の順にフォールバックします。[Chrome の i18n API](https://developer.chrome.com/docs/extensions/reference/api/i18n)で対応するロケールと解決規則を確認してください。

## 実装する

`<locale>` を追加するロケール名として、次を1つの変更で行います。

1. `app/src/renderer/src/services/i18n.ts` の `MESSAGES` に `<locale>` の表を追加します。既存の `en` を完全に複製して翻訳し、言語の解決規則と `resolved` の型に `<locale>` を加えます。`auto` でその言語タグを選ぶ規則もここで定義します。
2. `app/src/renderer/src/settings/sections/Language.tsx` に、現地語で表示する選択肢を追加します。`auto` で選ばれるだけでは、利用者が明示して選べません。
3. `extension/public/_locales/<locale>/messages.json` を追加します。`en/messages.json` の全キー、各 `description`、各 `placeholders` を保ち、`message` だけを訳します。Chrome 拡張機能の manifest・ポップアップ・設定画面はこのファイルを使います。
4. `extension/utils/i18n.ts` の `MESSAGES` に同じ言語のページ内 UI 表を追加します。これは投稿ページ上のバナー、ドラッグの案内、保存ボタン用です。content script は `_locales` を直接読む構成ではないため、この表を省略できません。
5. `extension/utils/locale.ts` の `servedLocale` を更新します。返り値の型と分岐を新しい翻訳表に合わせ、`markUiLanguage` が実際に表示する言語と同じ `lang` 属性を付けるようにします。投稿ページに載る UI はページ本体と別の言語になり得るためです。これは [WCAG 2.2 SC 3.1.2](https://www.w3.org/TR/WCAG22/#language-of-parts) の、支援技術が文言の言語を判定できるという要件にも対応します。
6. テストを新しい言語まで拡張します。`scripts/i18n-parity.test.ts` はアプリ、埋め込み UI、Chrome メッセージそれぞれについて、キー・値の形・置換スロットを基準言語と比較します。`scripts/ext-consistency.test.ts` は新しい `messages.json` を読み、使われるキーがすべてあることを検査します。`scripts/served-locale.test.ts` は配布するロケールの一覧と `servedLocale` の対応を検査します。固定された `ja`/`en` の配列を残さず、追加した言語も必ず検査対象にします。

アプリと拡張機能では言語の選択元が異なりますが、表示できる言語の集合は一致させます。アプリだけ、または拡張機能だけに新しい言語を追加して出荷しないでください。

## 確認する

`npm run check` を通します。続けて `npm run build:ext` で拡張機能を作り直し、次を実機で確認します。

- アプリの設定から `<locale>` を選び、再読み込み後にすべての画面がその言語になること
- OS の言語を `<locale>` にした `auto` のアプリが同じ言語になること
- Chrome の UI 言語を `<locale>` にした拡張機能で、ポップアップ、設定画面、投稿ページ上の保存 UI が同じ言語になること
- 支援技術に渡る `lang` 属性が、フォールバックした言語ではなく表示中の言語を示すこと

翻訳の質は自動テストだけでは判定できません。新規言語は、その言語の話者または話者コミュニティによるレビューを経てマージします。AI による下訳は使えますが、レビューの代わりにはなりません。
