# sns-post-to-save: EXIF/XMP メタデータ対応の検討

## 背景

sns-post-to-saveはSNS投稿をスクリーンショットキャプチャしてPNG保存するChrome拡張。現在メタデータはPNG iTXtチャンクに埋め込んでいるが、専用ツールなしでは読めない。

## やりたいこと

保存画像のメタデータを**Windowsエクスプローラーのファイルプロパティ（詳細タブ）で検索・閲覧**できるようにする。EXIF/IPTC/XMPの標準フィールドに書き込む方式。

## 方針

- 保存形式は拡張がキャプチャ時に指定するので自由に選べる（PNG/JPGどちらでもOK）
- エクスプローラーで「作成者:@username」等の検索ができることがゴール
- 特別なソフトの導入は不要で、誰でも検索・閲覧できることが条件
- 既存のiTXt埋め込みとの併用 or 置き換えは未決定

## マッピング案

| SNSメタデータ | EXIF/XMPフィールド |
|---|---|
| @screenName | 作成者 (Author) |
| 投稿テキスト | タイトル (Title) or コメント (Comment) |
| ハッシュタグ | タグ (Keywords) |
| 投稿日時 | 日時 (DateTimeOriginal) |
| 投稿URL | ソースURL (Source) |
| 投稿者情報詳細 | 説明 (Description / ImageDescription) |

## 関連リポジトリ

- https://github.com/apricot-cake/sns-post-to-save
- https://github.com/apricot-cake/eagle-metadata-enhancer （Eagle版、完成済み）

## ユーザーの運用方針

- タグへの自動書き込みは避ける（Eagleの場合。エクスプローラーのタグは別の話）
- メタデータはannotation/メモ欄に集約する方針（Eagle版での決定）
- PNG/WebPのプロパティ書き込みのOS制限を事前に調査すること
