# Eagle Info+

[Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) でドラッグ保存した画像に、SNS の投稿者情報や本文を [Eagle](https://jp.eagle.cool/) のアノテーション欄に書き込む拡張です。

## 対応サイト

- X (Twitter)
- Bluesky
- pixiv (ログイン中なら R-18 も)

## 書き込まれる内容

取れた項目だけ追記します。例 (X / Bluesky):

```
Platform: X (Twitter)
Display Name: 表示名
Author: @username
Image: 1/3
Hashtags: #illustration #fanart
Alt: 投稿者が設定した画像の説明
Text: 投稿本文
```

pixiv のときは `Text:` の代わりに `Title:` (作品タイトル) が入り、`Alt:` は出ません。Image は複数画像投稿のときだけ付きます。

## 使い道

投稿者ハンドルで Eagle を検索すればその人の作品だけ抽出できます。元 URL もアノテーションに残るので逆引きも楽。

## 必要なもの

- [Eagle](https://jp.eagle.cool/) デスクトップアプリ
- [Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) 拡張

## 入れ方

ウェブストアには出していません。ローカルで読み込んでください。

1. このリポジトリを clone またはダウンロード
2. `chrome://extensions/` を開いてデベロッパーモードを ON
3. 「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選択

## 仕組み

ドラッグした画像から投稿パーマリンクの URL を拾って、各サイトの公開系 API で投稿の詳細を取得し、Eagle のローカル API (`localhost:41595`) に保存済みのアイテムを探してアノテーションを書き加えます。DOM の読み取りは投稿 ID を取るところだけで、サイトのレイアウトが変わってもあまり壊れません。

## 免責

非公式の個人製拡張です。Eagle の開発元とは無関係。「Eagle」「Eagle for Chrome」は各権利者の商標です。

各サイトの API は個人のメタデータ整理用途を想定して使っています。クロール用途や大量取得には使わないでください。
