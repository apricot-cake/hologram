# Eagle Metadata Enhancer

SNSの画像をEagleにドラッグ保存する際、投稿者情報などのメタデータをEagleのメモ欄に自動書き込みするChrome拡張機能。

## 対応プラットフォーム

- X (Twitter)
- Bluesky

## 取得データ

| データ | 通常タイムライン | メディアグリッド |
|---|---|---|
| Platform | o | o |
| Display Name | o | - |
| Author (@screenName) | o | o |
| UID (X数値ID / Bluesky DID) | o | o |
| Post ID | o | o |
| Image Index (n/m or n) | o | o (URLから) |
| Published | o | - |
| Hashtags | o | - |
| Alt Text | o | - |
| Text | o | - |
| Source URL | o | o |

## 仕組み

1. Content scriptがページ上の画像の`dragstart`イベントを監視
2. ドラッグされた画像の親投稿からメタデータを抽出
3. Background scriptがEagle API (`localhost:41595`) をポーリングして新規アイテムを検知
4. URL照合でマッチしたアイテムのメモ欄にメタデータを書き込み

ポーリングはドラッグ操作後のみ実行され（最大30秒）、常時のAPI呼び出しは発生しない。

## メモ欄の出力例

```
@username - 投稿テキスト

Platform: X (Twitter)
Display Name: 表示名
Author: @username
UID: 1234567890
Post ID: 2040000000000000000
Image: 1/3
Published: 2026-04-04T12:00:00.000Z
Hashtags: #イラスト #ファンアート
Alt: 投稿者が設定した画像の説明
Text: 投稿テキスト
```

## インストール

1. このリポジトリをクローン
2. `chrome://extensions/` を開く
3. 「デベロッパーモード」をON
4. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択

Eagleデスクトップアプリが起動している状態で使用する。

## ファイル構成

```
manifest.json       Manifest V3
content.js          dragstartイベント監視 + メタデータ抽出
background.js       Eagle APIポーリング + アイテム更新
page-context.js     X用: ページコンテキストでReact fiberからUID取得
icons/              プレースホルダーアイコン
```

## 制限事項

- Eagle REST APIの`/api/item/update`はアイテム名の更新に非対応のため、タイトル情報はメモ欄の先頭行に記載
- メディアグリッド表示ではDisplay Name, Published, Hashtags, Alt Text, Textは取得不可
- タグへの書き込みは意図的に行わない（既存のタグ運用を保護するため）
