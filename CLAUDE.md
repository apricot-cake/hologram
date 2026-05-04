# Eagle Info+ — Claude Code 作業メモ

> ⚠️ このファイルは公開リポにコミットされている。**API キー・トークン・個人パス・認証情報・その他の秘密情報を書き込まないこと。** 実機固有の値や未確定のメモは `docs/` (private repo) 配下に書く。

## 知見・デバッグ情報の記録ルール

実装中に得た知見は **`docs/` 配下の markdown に書き出す**。チャットだけで完結させない。

- 既存トピックの追記なら該当ファイル (例: Eagle Plugin 関連は `docs/eagle-plugin-notes.md`) に追記
- 新トピックなら `docs/<topic>.md` を新規作成
- `docs/` は親リポの `.gitignore` 済みなので、未確定の作業メモを書いても公開リポに混入しない

## `docs/` は独立した git repo

`docs/` 配下は親 repo (`eagle-info-plus`) と別の git repo として管理されてる:

- リモート: `https://github.com/apricot-cake/eagle-info-plus-private` (private)
- 目的: マシン間で Claude メモを sync しつつ公開リポからは隔離

操作上の注意:

- `docs/` 内のファイルを変更したあと commit するときは、**`cd docs && git add ... && git commit ...`** で `docs/.git/` 側に対して操作する (親 repo に混ぜない)
- 親 repo の git 操作 (root から実行) は `docs/` を見ない (gitignore されてるので)
- 別マシンの初期セットアップ: 公開 repo を clone した後、`git clone <private repo> docs` で中身を埋める

### 書き出す対象

- **実機で確認した surprising な挙動** — 公式ドキュメントから素直に予測できないもの (silent な無視、戻り値の形が docs と違う、JSON.stringify の罠 等)
- **環境固有のメモ** — ライブラリパス、ローカルポート、バージョン、件数などこのマシン固有の値
- **失敗したアプローチと原因** — 同じ落とし穴を避けるため
- **公式ドキュメントへのリンク** — 引き写しはしない、参照だけ残す

### 書き出さない対象

- **公式ドキュメントに書いてあることの複写** — 公式リンクで足りる。コピーは古くなる
- 一回だけのコマンド実行結果
- すぐに code に反映できる小さい修正
- チャットの会話ログ
