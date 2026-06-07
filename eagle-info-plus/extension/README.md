# Eagle Info+ (Chrome 拡張)

[Eagle for Chrome](https://chromewebstore.google.com/detail/eagle-for-chrome/lieogkinebikhdchceieedcigeafdkid) でドラッグ保存した画像に、SNS の投稿者情報や本文を [Eagle](https://jp.eagle.cool/) のアノテーション欄に書き込む。

## 対応サイト

- X (Twitter)
- Bluesky
- pixiv (ログイン中なら R-18 も)

## 書き込まれる内容

取れた項目だけ追記する。例 (X / Bluesky):

```
Platform: X (Twitter)
Display Name: 表示名
Author: @username
Image: 1/3
Hashtags: #illustration #fanart
Alt: 投稿者が設定した画像の説明
Text: 投稿本文
```

pixiv のときは `Text:` の代わりに `Title:` (作品タイトル) が入り、`Alt:` は出ない。Image は複数画像投稿のときだけ付く。

## 使い道

投稿者ハンドルで Eagle を検索すればその人の作品だけ抽出できる。元 URL もアノテーションに残るので逆引きも楽。

[Engagement Browser](../plugin-window/README.md) (Eagle Window Plugin) と併用すると、annotation を起点に SNS API から engagement (likes / views 等) を取得してライブラリ全体をフィルタ・ソートできる。

## 入れ方

ウェブストアには出していない。ローカルで読み込んで使う:

1. リポジトリを clone またはダウンロード
2. `chrome://extensions/` を開いてデベロッパーモードを ON
3. 「パッケージ化されていない拡張機能を読み込む」で `extension/` フォルダを選択

## 仕組み

ドラッグした画像から投稿パーマリンクの URL を拾って、各サイトの公開系 API で投稿の詳細を取得し、Eagle のローカル API (`localhost:41595`) に保存済みのアイテムを探して annotation を書き加える。DOM の読み取りは投稿 ID を取るところだけで、サイトのレイアウトが変わってもあまり壊れない。
