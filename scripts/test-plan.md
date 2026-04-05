# Post Snap Test Plan

繰り返し利用可能なテストケース集。新機能追加時はケースを追加する。

## 事前準備（毎回）

```
python scripts/check-reload.py
```

表示されたハッシュを控える。拡張とテスト対象ページをリロード済みであること。

## テスト後の一括検証（毎回）

```
python scripts/verify-exif.py --recent N
```

保存した全画像の EXIF（XPComment JSON）+ ビルドハッシュを自動照合。

---

## A. プラットフォーム × ページ種別

各セルで1回保存 → verify-exif.py + ページ照合で検証。

### 検証手順

1. 対象ページで Alt+S → 投稿をクリックして保存
2. `python scripts/verify-exif.py` で EXIF JSON + ビルドハッシュを自動検証
3. X の場合は追加でページ実データと照合（パブリックAPIがないため）:
   - 保存した投稿のURLを開く
   - ページから displayName, postText, dateTime, likes, reposts, replies, userId を取得
   - verify-exif.py の JSON metadata 出力と突き合わせる

### A-1. X (Twitter)

| # | ページ | 選ぶべき投稿 | 注目点 |
|---|--------|-------------|--------|
| A-1a | TL (x.com/home) | いいね・RT・返信が全て1以上。絵文字を含むとなおよい | permalink は `a[href*="/status/"] time` から。userId は React fiber 経由。エンゲージメント取得・UCS2エンコード確認 |
| A-1b | 個別 (x.com/{user}/status/{id}) | A-1a と別の投稿 | スレッド表示。個別ページのDOM構造で permalink・userId が取れるか |
| A-1c | プロフィール (x.com/{user}) | 自分以外のユーザーページの投稿 | フォローボタンからの userId フォールバック確認 |
| A-1d | TL上のRT | リツイート | userId が null（仕様）。screenName は元投稿者 |
| A-1e | TL上の引用 | 引用ツイート | 引用元ではなく引用した側の article が対象になるか |

**全ケース共通の確認項目**:
- [ ] verify-exif.py: buildHash [OK]
- [ ] verify-exif.py: JSON内の screenName, displayName, text, date
- [ ] verify-exif.py: JSON内の likes, reposts, replies, bookmarks
- [ ] ファイル名が `YYYY-MM-DD.jpg`（images/ 配下）
- [ ] (X のみ) ページ実データと照合: displayName, text, date, likes, reposts, replies, userId

### A-2. Bluesky

| # | ページ | 選ぶべき投稿 | 注目点 |
|---|--------|-------------|--------|
| A-2a | TL (bsky.app) | いいね・リポスト・返信全て1以上 | セレクタ `feedItem-by-{handle}`。handle は data-testid から |
| A-2b | 個別 (bsky.app/profile/{h}/post/{id}) | A-2a と別の投稿 | セレクタ `postThreadItem-by-{handle}`。permalink が `location.href` フォールバックを通る可能性 |
| A-2c | プロフィール (bsky.app/profile/{handle}) | 他ユーザーの投稿 | `role="link"` + postText/repostBtn で判定される場合あり |
| A-2d | TL上のリポスト | リポストされた投稿 | 元投稿のメタデータが取れるか |

**全ケース共通の確認項目**:
- [ ] verify-exif.py: JSON内の userId (DID) が取得されている
- [ ] verify-exif.py: screenName, displayName, text, date
- [ ] verify-exif.py: likes, reposts, replies

### A-3. Misskey

| # | ページ | 選ぶべき投稿 | 注目点 |
|---|--------|-------------|--------|
| A-3a | TL ({instance}/) | リアクション・リノート・返信全て1以上 | `div[tabindex="0"]` + article で検出。permalink は time リンクから |
| A-3b | 個別 ({instance}/notes/{id}) | A-3a と別のノート | ノート内リンクで取れない場合 `location.href` フォールバック |
| A-3c | プロフィール ({instance}/@{user}) | 他ユーザーのノート | `a[href^="/@"]` からプロフィール抽出 |
| A-3d | TL上のリノート | リノートされたノート | renoteCount が API 経由で取得される |

**全ケース共通の確認項目**:
- [ ] verify-exif.py: screenName, displayName, userId（API補完）
- [ ] verify-exif.py: likes（リアクション合計）, reposts, replies
- [ ] verify-exif.py: text（MFM書式の場合はプレーンテキスト化）

---

## B. UI / インタラクション

| # | 操作 | 確認項目 |
|---|------|---------|
| B-1 | Alt+S で起動 | バナー表示（日本語 or 英語）。「右クリックで設定」を含む |
| B-2 | アイコンクリックで起動 | B-1 と同じ動作 |
| B-3 | 投稿にホバー | 青い枠（border-radius: 4px）。投稿間でスムーズにアニメーション |
| B-4 | 投稿外にマウス | 枠が非表示 |
| B-5 | 投稿をクリック | 保存中（グレー）→ 成功（緑）→ 1.5秒後に消える |
| B-6 | Escキー | キャプチャモード終了。バナー・枠が消える |
| B-7 | 右クリック | ビューアページが開く。キャプチャモード終了 |
| B-8 | 画面外の投稿をクリック | 自動スクロール → キャプチャ → スクロール位置復元 |
| B-9 | Alt+S 連打（二重起動） | 最初のセッションがクリーンアップされエラーにならない |

---

## C. ビューア

### C-1. 投稿一覧

| # | 操作 | 確認項目 |
|---|------|---------|
| C-1a | ビューアを開く | 保存済み投稿がカード形式で表示される |
| C-1b | 投稿がない場合 | 「投稿がありません」の空状態が表示される |
| C-1c | 投稿カードをクリック | 元の投稿URLが新しいタブで開く |
| C-1d | カード表示内容 | サムネイル画像、プラットフォームバッジ、ユーザー名、テキスト抜粋、エンゲージメント数、日時 |

### C-2. 検索・ソート・フィルタ

| # | 操作 | 確認項目 |
|---|------|---------|
| C-2a | テキスト検索 | 投稿テキストに含まれる単語で絞り込める |
| C-2b | ユーザー名検索 | screenName / displayName で絞り込める |
| C-2c | 検索結果なし | 「見つかりませんでした」の空状態が表示される |
| C-2d | ソート: 新しい順 | 日時の降順 |
| C-2e | ソート: 古い順 | 日時の昇順 |
| C-2f | ソート: いいね順 | いいね数の降順 |
| C-2g | ソート: リポスト順 | リポスト数の降順 |
| C-2h | ソート: 返信順 | 返信数の降順 |
| C-2i | フィルタ: X | X の投稿のみ表示 |
| C-2j | フィルタ: Bluesky | Bluesky の投稿のみ表示 |
| C-2k | フィルタ: Misskey | Misskey の投稿のみ表示 |
| C-2l | 件数表示 | フィルタ適用後の件数が表示される |

---

## D. 設定（ビューア内）

| # | 操作 | 確認項目 |
|---|------|---------|
| D-1 | フォルダ名を変更して保存 | 次回の保存先が変わる |
| D-2 | フォルダ名を空にして保存 | デフォルト「Post Snap」に戻る |
| D-3 | 「..」を入力して保存 | エラー表示。保存されない |
| D-4 | 「/」や「\」を含む名前で保存 | 同上 |
| D-5 | saveAs ON にして保存 | 「名前を付けて保存」ダイアログが出る |
| D-6 | saveAs OFF に戻して保存 | サイレント保存に戻る |
| D-7 | ショートカットリンクをクリック | chrome://extensions/shortcuts が開く |
| D-8 | ビルドハッシュ表示 | ページ下部に `Build: {hash}` が表示。check-reload.py と一致 |

---

## E. エクスポート

| # | 操作 | 確認項目 |
|---|------|---------|
| E-1 | ZIP エクスポート | `post-snap-export-YYYY-MM-DD.zip` がダウンロードされる |
| E-2 | ZIP 内容確認 | `images/` に JPEG、`metadata.json` にメタデータ配列 |
| E-3 | metadata.json | 各投稿の url, platform, text, displayName, screenName, userId, likes, reposts, replies, bookmarks, date, capturedAt, imageFile |
| E-4 | HTML エクスポート | `post-snap-export-YYYY-MM-DD.html` がダウンロードされる |
| E-5 | HTML を別ブラウザで開く | 画像とメタデータが表示され、検索・ソート・フィルタが動作する |
| E-6 | データなしでエクスポート | 「エクスポートするデータがありません」トースト表示 |

---

## F. インポート

| # | 操作 | 確認項目 |
|---|------|---------|
| F-1 | 画像からインポート | JPEG ファイルを選択 → EXIF XPComment の JSON を読み取り → storage に復元 |
| F-2 | 複数画像の一括インポート | 複数ファイル選択可能。全て復元される |
| F-3 | 重複スキップ（画像） | 同じ URL の投稿は既存データがある場合スキップ |
| F-4 | HTML からインポート | エクスポート HTML を選択 → JSON 抽出 → storage に復元 |
| F-5 | 重複スキップ（HTML） | 同じ URL の投稿はスキップ |
| F-6 | 無効ファイルのインポート | EXIF JSON がない JPEG / `postSnapData` がない HTML はスキップ or エラー表示 |
| F-7 | 復元フロー: storage クリア → 画像インポート | データが完全に復元される |
| F-8 | 復元フロー: storage クリア → HTML インポート | データが完全に復元される |

---

## G. データ削除

| # | 操作 | 確認項目 |
|---|------|---------|
| G-1 | 「全データを削除」をクリック | 確認ダイアログが表示される |
| G-2 | キャンセル | データは削除されない |
| G-3 | 削除実行 | chrome.storage.local の posts が削除される。投稿一覧が空になる |
| G-4 | 削除後の確認 | ダウンロード済みの画像ファイルは影響を受けない |

---

## H. ファイル名・ダウンロード

| # | 条件 | 確認項目 |
|---|------|---------|
| H-1 | 通常保存 | `images/YYYY-MM-DD.jpg`（投稿日ベース） |
| H-2 | 同日に複数保存 | `images/YYYY-MM-DD (1).jpg` と番号付与 |

---

## I. エンゲージメント数

| # | 条件 | 確認項目 |
|---|------|---------|
| I-1 | いいね・RT・返信 全てあり | JSON に likes, reposts, replies, bookmarks |
| I-2 | いいね 0 の投稿 | `likes: 0` が保存される |
| I-3 | カンマ区切り (1,234) | 1234 に変換される（X の aria-label） |
| I-4 | bookmarks | X のみ。Bluesky/Misskey は null |

---

## J. セキュリティ

| # | 条件 | 確認項目 |
|---|------|---------|
| J-1 | 非対応サイトで Alt+S | getSiteConfig が null → 何も起きない |

---

## K. ビルドハッシュ

verify-exif.py 実行時に自動チェックされる。手動確認は不要。
