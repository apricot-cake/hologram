# SNS Post to Save

SNS の投稿をクリックして、そのまま PNG 画像として保存する Chrome 拡張です。

## Features

- X / Bluesky / Misskey の投稿を選択して画像保存
- PNG の `iTXt` チャンクにメタデータを埋め込み
- 必要なら同名の sidecar JSON も保存

## Metadata

PNG には次の JSON を UTF-8 の `iTXt` チャンクとして埋め込みます。

```json
{
  "schema": "sns-post-to-save/v1",
  "capturedAt": "2026-03-29T12:34:56.789Z",
  "platform": "x",
  "pageTitle": "Home / X",
  "pageUrl": "https://x.com/home",
  "postUrl": "https://x.com/user/status/123",
  "sourceHost": "x.com",
  "extension": {
    "name": "SNS Post to Save",
    "version": "0.1.0"
  }
}
```

## JSON Option

オプション画面の `PNG と一緒に JSON も保存する` は既定でオフです。

- 利点: テキストで扱いやすく、検索や外部ツール連携がしやすい
- 注意点: 画像と JSON の 2 ファイル管理になる
