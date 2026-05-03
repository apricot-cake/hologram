# Eagle Info+

[Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) と併用して、ドラッグ保存した画像に **SNS 投稿のメタデータを自動付与** する Chrome 拡張です。投稿者・投稿本文・ハッシュタグ・公開日時・代替テキスト等を [Eagle](https://jp.eagle.cool/) のアノテーション欄に書き込みます。

## 対応プラットフォーム

- X (Twitter)
- Bluesky
- pixiv (R-18 含む / ログイン中)

## 取得できる情報

Eagle のアノテーション欄に下記が書き込まれます (取得できた項目のみ):

```
@username - 投稿本文先頭

Platform: X (Twitter)
Display Name: 表示名
Author: @username
UID: 1234567890                  # X は数値 id_str / Bluesky は did:plc:... / pixiv は user id
Post ID: 2040000000000000000
Image: 1/3                        # 複数画像時のみ
Published: 2026-04-04T12:00:00.000Z
Hashtags: #illustration #fanart
Alt: 投稿者が設定した画像の説明
Text: 投稿本文
Description: pixiv のキャプション (pixiv のみ)
```

## 活用例

- **投稿者で検索** — Eagle の検索で `@screenName` や表示名を絞り込めば、保存済み画像から特定の投稿者の作品をまとめて閲覧できます
- **逆引き** — 後から「この画像は誰の投稿か」を調べたい時、アノテーションに投稿者・元 URL・公開日時が残っています
- **Eagle のセマンティック検索と相性◎** — 取得した本文・Alt テキストを自然言語で横断検索できます

## 動作要件

- [Eagle](https://jp.eagle.cool/) デスクトップアプリ (起動している必要あり)
- [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) 拡張

## インストール

Chrome ウェブストアでは未公開です。ローカルで読み込んで使用してください:

1. このリポジトリを clone またはダウンロード
2. `chrome://extensions/` を開いてデベロッパーモードを ON
3. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダを選択

## 仕組み

ドラッグした画像から投稿パーマリンク URL を取得し、各プラットフォームの公開系 API から投稿メタデータを取得 → Eagle ローカル API (`localhost:41595`) 経由で保存済みアイテムにアノテーションを追記します。DOM スクレイピングは投稿 ID 抽出の最小限のみで、サイトのレイアウト変更に強い設計です。

## 免責事項

本拡張は非公式の第三者製です。Eagle の開発元との提携・承認・所有関係はありません。「Eagle」「Eagle for Chrome」は各権利者の商標です。

各プラットフォームの API 利用は利用規約の範囲内で個人のメタデータ整理用途を想定しています。スクレイピング・大量取得用途には使用しないでください。
