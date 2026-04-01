# SNS Post to Save

[English](README.md) | **日本語**

SNS の投稿をクリックして PNG 画像として保存する Chrome 拡張です。

投稿URL、ハンドルネーム、ユーザーID、投稿日時などのメタデータも一緒に残すことで、あとから検索しやすい状態にします。

## 使い方

1. ツールバーの拡張機能アイコンをクリック（または `Alt+S`）
2. 保存したい投稿をクリック
3. メタデータ付きの PNG がダウンロードフォルダに保存されます


## デモ

![Demo](docs/demo.gif)

## 機能

- X / Bluesky / Misskey の投稿を選択して画像保存
- ファイル名は `2026-03-29_08-20-15_x.com_screenname_postid.png` のように短く維持
- PNG の `iTXt` チャンクにメタデータを埋め込み
- 必要なら同名の sidecar JSON も保存

## 保存されるメタデータ

- `schema` — データ形式のバージョン
- `capturedAt` — 保存した日時
- `platform` — SNS の種類（`x` / `bluesky` / `misskey` など）
- `pageTitle` — 保存時のタブタイトル
- `pageUrl` — 保存時に開いていたページの URL
- `postUrl` — 投稿の URL（タイムラインから保存しても記録されます）
- `sourceHost` — サイトのホスト名（`x.com`、`bsky.app` など）
- `postId` — 投稿の ID
- `screenName` — アカウントの表示名（`@〇〇` の部分）
- `userId` — SNS 側のユーザー ID
- `uid` — 表示名とは別の、変わりにくいユーザー識別子（Bluesky の DID など）
- `postPublishedAt` — 投稿された日時
- `extension.name` / `extension.version` — 保存に使った拡張機能の名前とバージョン

## メタデータはどこにある？

メタデータは別DBではなく PNG 本体の中にあります。画像だけを移動しても一緒に持ち運べます。

> **注意:** SNS へのアップロードや画像編集ソフトでの再保存でメタデータが消えることがあります。元の PNG を残しておくと安心です。

## JSON オプション

オプション画面の `PNG と一緒に JSON も保存する` は既定でオフです。

- 利点: テキストで扱いやすく、検索や外部ツール連携がしやすい
- 利点: 画像を再保存してもメタデータが別ファイルに残る
- 注意点: 画像と JSON の 2 ファイル管理になる

## メタデータ形式

PNG には次の JSON を UTF-8 の `iTXt` チャンクとして埋め込みます。キーワードは `sns-post-to-save` です。

```json
{
  "schema": "sns-post-to-save/v1",
  "capturedAt": "2026-03-29T12:34:56.789Z",
  "platform": "x",
  "pageTitle": "Home / X",
  "pageUrl": "https://x.com/home",
  "postUrl": "https://x.com/user/status/123",
  "sourceHost": "x.com",
  "postId": "123",
  "screenName": "user",
  "userId": null,
  "uid": null,
  "postPublishedAt": "2026-03-29T08:20:15.000Z",
  "extension": {
    "name": "SNS Post to Save",
    "version": "0.1.0"
  }
}
```
