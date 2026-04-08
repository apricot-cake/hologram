# Eagle Info+

[English](README.md) | **日本語**

> **免責事項:** 本拡張機能は非公式の第三者製です。Eagle の開発元との提携・承認・所有関係は一切ありません。「Eagle」および「Eagle for Chrome」は各権利者の商標です。

[Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) と併用して、保存した画像に SNS 投稿のメタデータを自動で付与するコンパニオン拡張機能です。

公式拡張で画像を保存すると、投稿者情報・投稿詳細などのメタデータを [Eagle](https://jp.eagle.cool/) のアノテーション欄に書き込みます。

## 動作要件

- [Eagle](https://jp.eagle.cool/) デスクトップアプリ（起動している必要があります）
- [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) ブラウザ拡張

## 対応プラットフォーム

- X (Twitter)
- Bluesky
- [misskey.io](https://misskey.io/)

## 取得する情報

- プラットフォーム
- 表示名
- 投稿者 (@screenName)
- UID (X の数値 ID / Bluesky の DID)
- 投稿 ID
- 画像インデックス (例: 1/3)
- 投稿日時
- ハッシュタグ
- 代替テキスト (Alt)
- 本文
- ソース URL

## 活用例

- **投稿者で検索** — アノテーション欄に書き込まれた `@screenName` や表示名を Eagle の検索で絞り込めば、保存済みの画像から特定の投稿者の作品をまとめて参照できます。
- **逆引き** — 後から「この画像は誰の投稿だったか」を調べたいときも、アノテーションを開けば投稿者・元 URL・日時を一目で確認できます。
- **Eagle のセマンティック検索と相性◎** — 最近の Eagle はアノテーションに対するセマンティック検索に対応しているため、取得した本文や Alt テキストを自然言語で検索できます。

## 仕組み

1. コンテンツスクリプトが画像の `dragstart` イベントを監視
2. 親の投稿要素からメタデータを抽出
3. バックグラウンドスクリプトが Eagle API (`localhost:41595`) をポーリングして新規保存アイテムを検出
4. URL でアイテムを照合し、アノテーション欄にメタデータを書き込み

ポーリングはドラッグ操作の後最大 30 秒のみ動作し、常時 API を叩くことはありません。

## アノテーションの出力例

```
@username - 投稿本文

Platform: X (Twitter)
Display Name: 表示名
Author: @username
UID: 1234567890
Post ID: 2040000000000000000
Image: 1/3
Published: 2026-04-04T12:00:00.000Z
Hashtags: #illustration #fanart
Alt: 投稿者が設定した画像の説明
Text: 投稿本文
```

## インストール

Chrome ウェブストアでの公開を準備中です。公開後はウェブストアからインストールし、[Eagle](https://jp.eagle.cool/) デスクトップアプリと [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) 拡張も併せて導入してください。

## ファイル構成

```
manifest.json       Manifest V3
content.js          dragstart イベントのリスナー + メタデータ抽出
background.js       Eagle API ポーリング + アイテム更新 + X Syndication API
page-context.js     X: ページコンテキストの React fiber からユーザー ID を抽出
icons/              アイコン
```

## 制限事項

- [Eagle REST API](https://api.eagle.cool/) の `/api/item/update` はアイテムのリネームに対応していないため、タイトル情報はアノテーションの 1 行目に配置しています
- 既存のタグ整理を壊さないよう、タグの書き込みは意図的に行っていません
