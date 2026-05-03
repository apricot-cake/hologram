# Eagle Info+

[Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) で保存した画像に SNS 投稿のメタデータを自動付与する自分用 Chrome 拡張。

## 構成

- `manifest.json` — MV3。content script は X / Bluesky のみ
- `content.js` — `dragstart` で投稿パーマリンクと画像 URL を抽出して background へ送るだけ
- `background.js` — Syndication API / getPostThread API を叩いて annotation を組み立て、Eagle ローカル API (`localhost:41595`) をポーリングして該当アイテムに付与

DOM スクレイピングは最小限 (パーマリンクアンカー検出のみ)。表示名・本文・UID 等は全てプラットフォーム公式 API から取得する。

## 対応プラットフォーム

- X (Twitter) — `https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=0`
- Bluesky — `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at://<handle>/app.bsky.feed.post/<rkey>&depth=0`
- pixiv — `https://www.pixiv.net/ajax/illust/<id>` (公式サイト frontend が叩く非ドキュメントだが安定。`credentials: 'include'` でログイン中なら R-18 もアクセス可)

## annotation フォーマット

```
@username - 投稿本文先頭

Platform: X (Twitter)
Display Name: 表示名
Author: @username
UID: 1234567890                  # X は numeric id_str / Bluesky は did:plc:...
Post ID: 2040000000000000000
Image: 1/3                        # 複数画像時のみ
Published: 2026-04-04T12:00:00.000Z
Hashtags: #illustration #fanart
Alt: 投稿者が設定した画像の説明
Text: 投稿本文
```

## インストール (ローカル開発)

1. `chrome://extensions/` でデベロッパーモード ON
2. 「パッケージ化されていない拡張機能を読み込む」→ このフォルダ選択
3. コード変更後はカードの ↻ で再読み込み

## 動作要件

- [Eagle](https://jp.eagle.cool/) デスクトップアプリ起動中
- [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) 拡張インストール済み

## デバッグ

- background のログ: `chrome://extensions/` → Eagle Info+ → **service worker** リンクで DevTools
- 詳細ログ: `background.js` と `content.js` の `DEBUG = false` を `true` に
- API リクエスト確認: service worker DevTools の Network タブ (フィルタ `cdn` で X / `bsky` で Bluesky / `pixiv` で pixiv)
- Eagle 側の保存結果: `<library>/images/<itemId>.info/metadata.json` を直接読む

## テスト

[test-matrix.md](test-matrix.md) 参照。

## TODO

[CLAUDE.md](CLAUDE.md) 参照。
