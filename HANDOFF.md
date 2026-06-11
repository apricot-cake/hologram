# Corpus — Codex ハンドオフ（2026-06-11）

SNS投稿（X / Bluesky / Misskey / Mastodon / pixiv）をJPEGキャプチャとして保存・閲覧する
**Chrome拡張（MV3）+ Electronデスクトップアプリ**。1人開発。

---

## 厳守ルール

| ルール | 内容 |
|---|---|
| **言語** | ユーザーへの返答・ツール呼び出し前の一文は**すべて日本語**。コードコメント・tool descriptionは英語可 |
| **UI変更** | `DESIGN.md` に従う（形＝意味・tintアクティブ・ホバー最大2ボタン・右クリック＝全アクション目次・モーション規約） |
| **コミット** | 日本語メッセージ + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` |
| **push** | `git push origin main`（main直push、確認不要） |
| **アプリ再起動** | コード変更後は確認せず再起動: 下記「再起動コマンド」参照 |
| **リポジトリ** | `apricot-cake/corpus` — **リリースまで private 厳守** |
| **安全操作** | Eagle ライブラリ（`C:\Users\apricot\ローカル\絵\資料.library`）は**読み取り専用** |

---

## 再起動コマンド（変更後は毎回）

```powershell
try { Get-Process electron -ErrorAction Stop | Where-Object { $_.Path -like '*corpus*' } | Stop-Process -Force -Confirm:$false } catch {}
Start-Sleep -Milliseconds 600
Start-Process -FilePath "C:\Users\apricot\ローカル\開発\corpus\app\node_modules\electron\dist\electron.exe" `
  -ArgumentList '"C:\Users\apricot\ローカル\開発\corpus\app"' `
  -WorkingDirectory "C:\Users\apricot\ローカル\開発\corpus\app"
```

開発起動: `cd app && npm start`

---

## リポジトリ構成

```
corpus/
├── extension/          Chrome拡張（MV3）
│   ├── background.js   SW: キャプチャ→Native Messaging送信
│   ├── content.js      投稿選択UI・パーマリンク抽出
│   ├── drag.js         画像ドラッグ保存
│   ├── metadata.js     X/Bluesky/Misskey/Mastodon/pixiv メタ取得・正規化
│   └── manifest.json   権限: nativeMessaging, host_permissions, Alt+S
├── native-host/        Native Messagingブリッジ
│   ├── bridge.js       JPG+サイドカーJSON書き込み・メディアDL
│   ├── install.js      ホスト登録（日本語パス対策済み）
│   └── paths.js        共有configパス
├── app/                Electronアプリ
│   ├── main.js         IPC・ファイルウォッチ・psimg://プロトコル
│   ├── preload.js      安全なIPC橋渡し
│   ├── renderer/
│   │   ├── viewer.js   投稿一覧・フィルタ・全UI（メインコード）
│   │   ├── index.html  CSS（design-tokens.css参照）
│   │   ├── i18n.js     日英切替（config.json の language: auto/ja/en）
│   │   ├── design-tokens.css  セマンティックトークン（light/dark）
│   │   └── folders.js  フォルダ・ワークスペース管理（folders.json）
│   └── vendor/         jszip.min.js
├── scripts/            テスト・ユーティリティ（gitignore対象の_*.jsは検証用）
├── CLAUDE.md           プロジェクト仕様（詳細はここ）
└── DESIGN.md           デザイン言語（UI変更前に必読）
```

---

## アーキテクチャ（保存フロー）

```
Chrome拡張（Alt+S）
  → content.js: 投稿選択・パーマリンク抽出
  → background.js: タブキャプチャ → metadata.js でAPI取得
  → Native Messaging → bridge.js
  → %LOCALAPPDATA%\Corpus\library\ に <id>.jpg + <id>.json 書き出し
                                       ↓
                               Electron app が fs.watch 監視 → 自動更新
```

**フォルダ・設定**: `%APPDATA%\Corpus\config.json`, `folders.json`, `manual-groups.json`

---

## 現在の状態（直近コミット・2026-06-11）

| コミット | 内容 |
|---|---|
| `4a552f9` | 右クリックメニュー・フォルダピッカーを外クリックで確実に閉じる（capture phase対応） |
| `9906dfa` | 同じカードのℹ再クリックでインスペクタを閉じる（トグル） |
| `d1ef76c` | ミューテーションで入場モーション再生しない（keepLimit）＋WSアイコンをハンマーに |
| `06bc650` | リスト表示の右端にホバーボタン分余白（重なり解消） |
| `04e563d` | ワークスペース: 「空にする」＋確認ダイアログ・常駐表示廃止 |
| `fbdc4ff` | サイドバーの横長コントロール上下スリム化 |
| `5af78bd` | **カード右クリックメニュー導入**・ホバーは⚡ℹの2個のみ |
| `97166ee` | **ワークスペース（一時トレイ）導入**・デフォルトフォルダ廃止 |

### 現在のカードUI仕様（重要）

- **ホバー**: ⚡（ws-btn, right:40px）とℹ（info-btn, right:8px）の2個のみ
- **右クリック**: 開く / タグ編集 / フォルダに追加 / ワークスペース / 詳細 / 削除
- **ワークスペース**: 単一の一時トレイ。`folders.json = { folders:[...], workspace:[captureId,...] }`
  - ⚡クリック: 追加/解除トグル。追加後は `.ws-btn.in`（ホバーで赤=解除予告）
  - サイドバー「空にする」: confirm ダイアログ付き
- **インスペクタ**: ℹクリックで `aside#postDetail` に常設表示（右カラム320px）
  - 同じカードのℹ再クリック → 閉じる（トグル）
  - 別カードのℹ → 中身差し替え
  - <1280px: fixed スライドオーバー
- **モーション**: `renderPosts(true)` = keepLimit = アニメなし。ミューテーション系は全て keepLimit

---

## キーファイル詳細

### `app/renderer/viewer.js`

全UIロジックが集中する巨大ファイル（約3000行）。主要な変数・関数:

```js
// 状態
let viewGroups = [];        // 表示中のグループ配列
let activeFilters = [];     // アクティブフィルタ
let inspectedKey = null;    // 現在インスペクタに表示中の postIdKey
let selectedSet = new Set();// 選択中カード

// 主要関数
renderPosts(keepLimit)      // 一覧再描画（true=アニメなし）
showDetail(g)               // インスペクタに投稿グループgを表示
closeDetail()               // インスペクタを閉じる
showCardMenu(g, x, y)       // 右クリックメニュー表示
hideCardMenu()              // 右クリックメニューを閉じる
showFoldMenu(g, x, y)       // フォルダピッカー表示
loadPosts(keepLimit)        // サイドカー走査 → viewGroups更新
```

### `app/renderer/i18n.js`

`MSG.キー` でアクセス。ja/en両方に追加が必要。

### `app/renderer/folders.js`

`CF()` で取得するシングルトン。`CF().toggleWorkspace(ids, repId)` 等。

---

## テスト

```bash
# スモークテスト一覧（node で直接実行）
node scripts/test-app-folders.js    # フォルダ操作
node scripts/test-app-search.js     # 検索
node scripts/test-app-instances.js  # インスタンスフィルタ
node scripts/test-app-users.js      # ユーザータブ
node scripts/_verify-select.js      # 選択・右クリックメニュー
node scripts/_verify-sticky.js      # sticky-visible（フィルタ外ミューテーション）
node scripts/_verify-motion.js      # モーション
node scripts/_verify-uiux.js        # UI/UX基本確認
node scripts/e2e-capture-test.js    # E2Eキャプチャ（X以外）
```

SMOKE環境変数: `CORPUS_SMOKE=1` + `CORPUS_SMOKE_EVAL=<JS>` → `EVAL_RESULT {json}` をstdoutへ出力。
**注意**: SMOKEはヘッドレスウィンドウでは返らないことがある → 実機確認が信頼できる（[[corpus-verify-notes]]）。

---

## 未着手バックログ（優先度順）

### 高優先（ユーザーが要望済み）

1. **モーション第2弾**（任意）
   - アクティブフィルタpillのpop-in
   - サイドバー節の開閉アニメ（高さ）
   - 表示モード（カード/タイル/リスト）切替遷移
   - 検索結果0↔nの入替

2. **リキッドガラス風UI**（任意）
   - CSS `backdrop-filter: blur(35px) saturate(114%)` + 半透明背景 + 内側ハイライト
   - サンプルを作って見比べてから決定（`%TEMP%\corpus-glass-sample.html` に前回サンプルあり）
   - 「本物のLiquid Glass」はCSS不可。フロステッドガラス近似なら可

3. **カードホバーにも逆引き導線（SauceNAO）**
   - 現状はインスペクタ内のみ。ホバー時（info-btn横？）にも小アイコンを追加する案

4. **`userKind` フィルタ**（記録は済み・UIだけ未実装）
   - 連続タグ付けで `userKind: plain/media` が記録されるが、サイドバーでの絞り込みが未実装
   - サイドバーの種別/メディア節に追加

5. **OCR検索**（判断留保）
   - 画像内テキスト → サイドカーに保存 → 検索対象
   - 無料×高精度×統合容易の三拍子が要件。候補: manga-ocr(Python依存) / Tesseract.js(精度低) / Vision API(キー要)
   - 三拍子揃わなければ見送り

### 低優先

- X 認証E2E（`--user-data-dir` 対応）
- A-1n / A-4f / A-5e のE2Eセル化（手動or将来）
- 既存ライブラリのメタ欠損レコードを逆引き再取得（ユーザー個人作業）

---

## リリース準備（未着手）

- `electron-updater` + GitHub Releases（リポpublic化後）
- MIT ライセンス（LICENSE ファイル + package.json）
- コード署名: **SignPath Foundation（OSS無料・第一候補）** / Azure Trusted Signing($9.99/月)
- スクリーンショット/デモ差し替え
- Chrome Web Store 公開

---

## 既知の注意点

- `app/main.js` は CRLF + 稀に不可視非改行スペースあり → 大きな複数行 Edit は失敗しうる。`node` 正規表現置換か小さな単一行 Edit を使う
- SMOKEテストのEVALは非表示ウィンドウで返らない場合あり → 実機確認が信頼できる
- `e.stopPropagation()` がカード内の複数ハンドラに存在 → メニューの外クリック検知はキャプチャフェーズ（`true`）を使う（修正済み）
- ワークスペースアイコンはlucide hammerのSVG（3箇所: カードws-btn・サイドバーwsChip・右クリックメニュー）

---

## デザイントークン（参照先）

`app/renderer/design-tokens.css` — primitiveの直書き禁止、semanticのみ参照。

主なセマンティック変数:
```css
--surface-1/2/3   背景レイヤ
--text-1/2/3      テキスト
--accent          アクセント（青）
--accent-subtle   tintアクティブ背景
--danger          赤（破壊操作）
--border / --border-strong
--sidebar-bg
```

`color-mix` の色計算は **srgb** を使う（oklchだとダーク背景で紫に転ぶ）。
