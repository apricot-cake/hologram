# 設計: ブラウザ式タブ（複数ビューステートの並列保持）＋タイトルバー合体

実装者向けの完全設計。前提合意はバックログ（corpus-ui-backlog.md「ブラウザ式タブ」）に記録済み。
本書はそれをコードレベルに落としたもの。**実装は Phase 0 → 1 → 2 → 3 の順に独立して進め、
各 Phase ごとにコミット＆実機確認**（SMOKE eval に依存しない — corpus-verify-notes）。

## 0. 概念モデル（合意済みの再掲＋確定事項）

- **タブ＝動的ビュー1個**。実体は既存の履歴スナップショットと同一形:
  `{ f, join, search, sort, multi }`（viewer.js `snapshotState()` ≒ L1525）。
  - **含めない**: viewMode/cardSize/tileSize（表示密度はグローバル設定。DESIGN.md「履歴は表示密度・タイルサイズ対象外」と整合）、選択状態、インスペクタ。
- **Arc 式**: 通常タブ＝使い捨て・自動タイトル／ピン留め→保存ビュー（永続・左寄せ・×なし）。
- **既存の Alt+←→ 履歴はタブ内の時間軸**として共存（タブ=並列、履歴=直列）。
  `viewHistory`/`histIdx` を**タブごとに持つ**よう移管する（§5）。
- **タブ帯はタイトルバーと合体**: `titleBarStyle:'hidden'` ＋ `titleBarOverlay`（フル frameless ではない）。
  native の min/max/close は overlay が描く＝再実装不要・Win11 スナップ維持。
- 常に最低1タブ。最後のタブを閉じたら「すべて」状態にリセットして残す（ウィンドウは閉じない）。

## 1. データモデルと永続化

```js
// タブ1個（永続形）
{ id: 't' + Date.now().toString(36) + ランダム2字,  // folders.js の id 生成に倣う
  pinned: false,
  name: null,          // 手動リネーム時のみ文字列。null = 自動タイトル
  state: { f: [], join: 'and', search: '', sort: 'date-desc', multi: false } }
```

- 保存先: **`<saveFolder>/tabs.json`** = `{ tabs: [...], activeId: 'txxx' }`。
  - フィルタはタグ/フォルダ/作者などライブラリ固有の値を参照するため、**config ではなくライブラリ側**
    に置く（folders.json と同じ判断）。ライブラリを切り替えればタブも切り替わる＝正しい挙動。
  - **重要**: main.js `list-posts` のスキップリスト（L93 の `'folders.json'` 等の並び）に
    **`'tabs.json'` を追加**すること。忘れると投稿として読まれる。
- IPC: `get-tabs` / `set-tabs`（main.js の `get-folders`/`set-folders`（L313〜）をテンプレートに、
  読み時バリデーション＝`tabs` 配列・各要素の型チェック・`state` の各キーをデフォルト補完）。
  preload.js に `getTabs`/`setTabs` を追加。
- 書き込みは**デバウンス（〜800ms）**。タブ切替・状態変更・並べ替え・ピン留めのたびに発火。
- ランタイム専用（永続しない）: タブごとの `history: []` / `histIdx: -1`、スクロール位置（§5）。

## 2. タイトル自動生成（Phase 0 のプロトタイプ対象）

### 2.1 共有ラベラーの抽出

`renderQueryChips()`（viewer.js L463〜）の `switch (f.type)` ラベル分岐を
**`filterLabel(f)` として関数抽出**し、チップとタブタイトルの両方が同じ1ソースを使う。
（重複実装するとラベル改名時に乖離する。抽出は機械的で安全。）

### 2.2 `tabTitleOf(state, ctx)` — 純関数

```
入力: state = タブの state、ctx = { allCount: 全投稿数 }
出力: { text, iconType }
```

- **支配ファセットの優先順位**（バックログ合意そのまま）:
  `search ＞ tag ＞ user ＞ platform/instance ＞ postType/media/multi ＞ date ＞ kind ＞ workspace/folder`
  - workspace/folder は名前がそのまま出るので末尾優先で十分（folder はほぼ単独で使われる）。
  - instance は platform と同格（どちらか先に現れた方）。
- **text** = 支配ファセットのラベル ＋ 残り条件数:
  - 検索: `"<検索語>"`（12文字超は `…` 省略）
  - タグ: `#タグ名` ／ 作者: 表示名 ／ その他: `filterLabel(f)` の出力
  - 残り条件数 = `activeFilters.length + (search?1:0) + (multi?1:0) − 1` が 1以上なら ` ＋N` を付加
  - 条件ゼロ → **`すべて(N)`**（N = `ctx.allCount`、`formatCount` で整形。posts-changed で更新）
- **iconType** = 支配ファセットの種別キー（`'search'|'tag'|'user'|'platform'|…|'all'`）。
  描画側でサイドバーのカテゴリ行アイコン（14px lucide系）と同じ SVG を割り当てる（favicon 相当）。
- 手動リネーム済み（`name !== null`）なら自動生成せず `name` を表示。リネームを空にしたら自動へ復帰。

### 2.3 Phase 0 の見せ方（プロトタイプ）

タブ UI を作る前に納得感を確認する（合意済みの進め方）。**ゼロUIで検証**:

1. `filterLabel()` 抽出＋ `tabTitleOf()` 実装。
2. `pushHistory()` 内（＝全ての状態変化が通る場所）で `document.title = tabTitleOf(...).text + ' — Corpus'` を設定。
   → **現状のネイティブタイトルバーにライブ表示**される。ユーザーは普段の絞り込み操作をするだけで
   全パターンのタイトルを目視できる。
3. `scripts/_verify-tabtitle.js`（throwaway・gitignore対象の `_` 付き）: 代表 state を10数件
   フィクスチャで流して期待文字列をアサート（純関数なので node 単体で回る）。
4. **ユーザーの納得を得てから Phase 1 へ**。文言調整はこの段階で吸収する。

## 3. タイトルバー合体（Phase 1）

### 3.1 main.js

```js
// createWindow() の BrowserWindow オプションに追加（L793〜）
titleBarStyle: 'hidden',
titleBarOverlay: { color: dark ? '#0c0e12' : '#f6f7f9', symbolColor: dark ? '#9aa3af' : '#5b6470', height: 38 }
```

- **高さ 38px** を確定値とする（Chrome≒36/VS Code=35。タブ高 28px ＋上下余白とバランス）。
  CSS 側と必ず一致させる → `--tabbar-h: 38px` をトークンに（design-tokens.css）。
- 新 IPC `set-titlebar-overlay`: renderer から `{ color, symbolColor }` を受けて
  `win.setTitleBarOverlay()`（**try/catch 必須** — overlay 無し起動や非Windowsで throw）。
- **注意**: main.js は CRLF＋不可視文字があり大きな複数行 Edit が失敗しうる
  → 小さい単一行 Edit か node 正規表現置換で（corpus-verify-notes）。

### 3.2 theme.js

`apply(p)`（L19〜）の末尾で overlay 色を同期:
```js
if (window.corpus && window.corpus.setTitleBarOverlay) {
  var d = (resolve(pref) === 'dark');
  try { window.corpus.setTitleBarOverlay({ color: d ? '#0c0e12' : '#f6f7f9', symbolColor: d ? '#9aa3af' : '#5b6470' }); } catch (e) {}
}
```
（theme.js は `<head>` 中に走る＝preload API 未準備の可能性があるためガード必須。
初回は main 側が `dark` から正しい色で生成するので、ここはライブ切替の追従のみ。）

### 3.3 レイアウト再構成（index.html）

現在: `body { display:flex }`（横並び）＋ `#sidebar { height:100vh; sticky }`（L36）。

変更:
```html
<body>                          <!-- 縦 flex に変更 -->
  <header id="tabBar">…</header> <!-- 高さ var(--tabbar-h)・full width -->
  <div id="appBody">             <!-- 旧 body の中身。display:flex（横） -->
    <aside id="sidebar">…</aside>
    <div id="appMain">…</div>
  </div>
</body>
```

- `body { flex-direction: column }`、`#appBody { display:flex; flex:1; min-height:0 }`。
- **100vh 依存の修正（3箇所）**: `#sidebar`（L36）と `.inspector`（L1538）の `height:100vh` →
  `calc(100vh - var(--tabbar-h))`、`top:0` → `top: var(--tabbar-h)`。
  インスペクタの `max-height: calc(100vh - 24px)`（L823）も同様に減算。
- ドラッグ領域: `#tabBar { -webkit-app-region: drag }`、内部のタブ・ボタン・入力は
  `-webkit-app-region: no-drag`。
- **window コントロール領域の確保**: `#tabBar { padding-right: calc(100% - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100%)) }` 相当。実装は単純に
  `width: env(titlebar-area-width, 100%)` を内側ラッパに当てるのが簡潔（overlay 有効時のみ
  env が入る。フォールバック値を必ず書く）。
- ウィンドウタイトル文字は消える（単一ウィンドウなので可・合意済み）。
  ※ Phase 0 で仕込んだ `document.title` 連動はタスクバー/Alt+Tab 表示用として残す。

### 3.4 Phase 1 完了条件

タブ帯はまだ**スケルトン**（「すべて(N)」1個＋｢＋｣ボタンのみ・機能なし）で良い。
ドラッグでウィンドウ移動・ダブルクリックで最大化・min/max/close 動作・ライト/ダーク追従を実機確認。

## 4. タブ帯の見た目（Phase 2）— DESIGN.md 準拠

- **前例の錨**: タブ帯の構造=Chrome/Arc、アクティブ表現=macOS セグメンテッドコントロール
  （既存の「凹トラック＋浮きつまみ」語彙を流用）。採用後 DESIGN.md に記録すること。
- **帯は常設面 → ガラス禁止**（DESIGN.md「ガラスは一時面だけ」）。サイドバーと同じ
  **Mica風материал**（薄い縦グラデ＋微細ノイズ＋上端1pxハイライト）か、まずは `--bg` フラットで開始し
  サイドバーと同時に質感を入れる。
- **タブ＝角丸四角（6–8px）**: タブは「場所」なのでピル禁止（形=意味の対応）。
  - 高さ 28px・`max-width: 200px`・`min-width: 96px`・flex shrink で詰め、
    超過したら帯を横スクロール（スクロールバー非表示・ホイールで横送り）。
  - アクティブ: **`--seg-thumb` の浮きつまみ**（`--shadow-xs`）。**tint やソリッド塗りは使わない**
    （アクティブタブは「状態」ではなく「前面の場所」＝つまみ語彙が正しい）。
  - 非アクティブ: 背景透明・テキスト `--text-muted`。ホバー: `--hover` 塗り（ニュートラル）。
  - 構成: ファセットアイコン(14px・`--text-muted`) ＋ タイトル(12px・省略) ＋ ×(ホバー時のみ表示・
    アクティブタブは常時。ゴーストアイコンボタン)。
  - ピン留めタブ: 左端クラスタ・**アイコン＋短縮名（max-width 120px）・×なし**（Chrome語彙）。
- ｢＋｣新規タブ: タブ列の右隣・ゴーストアイコンボタン（既存 `.icon-btn` 語彙）。
- **右クリックメニュー**（`.fold-menu`/`.card-menu` 様式を流用・ガラス可=一時面）:
  ピン留め/ピン解除・名前を変更・複製・閉じる・他のタブを閉じる（破壊行は `fm-danger`）。
- **名前変更**: メニューから（＋タブのダブルクリックでも）インライン input に差し替え。
  Enter確定・Esc取消・空確定=自動タイトルへ復帰。input は `no-drag` を忘れずに。
- 出現/消滅モーション: 150–260ms ease-out、幅 0→auto は `max-width` トランジションで近似。
  `prefers-reduced-motion` 無効化必須。
- i18n: `tabNew/tabClose/tabPin/tabUnpin/tabRename/tabDuplicate/tabCloseOthers/tabAll` を
  app/renderer/i18n.js の ja/en 両方に追加。

## 5. タブのステート機構（Phase 3）

### 5.1 切替

```
switchTab(id):
  1. 現タブに退避: tab.state = snapshotState(); tab._history = viewHistory; tab._histIdx = histIdx;
     tab._scroll = 現スクロール位置（best-effort）
  2. activeId = id; 対象タブの _history/_histIdx を viewHistory/histIdx に戻す
     （無ければ [state] / 0 で初期化）
  3. applyState(tab.state)   // 既存関数そのまま（restoringState ガードが効く）
  4. スクロール復元（renderPosts 後に clamp して setScrollTop。窓描画で届かない分は諦める=仕様）
  5. 選択状態はクリア（タブ間で持ち越さない）
  6. renderTabs(); persistTabs()
```

### 5.2 状態変化の追従

`pushHistory()`（L1540・全状態変化の単一経路）の末尾に hook:
```
activeTab.state = snap;       // タブの内容を常に最新へ
renderTabTitle(activeTab);    // 自動タイトル再計算（name があれば skip）
persistTabsDebounced();
```
- ピン留めタブも同様に**追従する**（Arc のピン留めと違い「編集すると保存ビューが更新される」
  単純モデルを採用。差分検知や「戻す」UIは作らない＝v1の複雑性を抑える確定事項）。

### 5.3 ショートカット

- `Ctrl+T` 新規タブ（「すべて」状態で開く）／ `Ctrl+W` アクティブタブを閉じる／
  `Ctrl+Tab`・`Ctrl+Shift+Tab` 巡回。タブの中クリック=閉じる。
- **ガード必須**: 入力中・オーバーレイ表示中は奪わない（viewer.js の Ctrl+A ハンドラが雛形。
  DESIGN.md L83）。`Ctrl+W` は誤爆が痛いので「設定オーバーレイ/ライトボックス/モーダル表示中は無効」。
- `Ctrl+1..9` ジャンプは任意（v1 では見送り可）。

### 5.4 エッジケース

- **起動時**: tabs.json を読み、`activeId` のタブの state を初期適用。無ければ
  `[すべて]` 1タブを生成。復元した state が参照する タグ/フォルダ/作者がもう存在しなくても
  そのまま適用（0件表示になるだけ。チップは既存どおり安全に描画される＝folder は raw id 表示）。
- **posts-changed（fs watch）**: 表示中タブは既存の再描画経路のまま。タブ帯は
  「すべて(N)」の N と各タブの件数非依存タイトルのみ更新（再計算は安い）。
- **最後のタブの ×**: 閉じずに state を「すべて」へリセット（resetAllFilters 相当を applyState で）。
- **タブの並べ替え**: v1 では**ドラッグ並べ替えは見送り**（ピン/通常の2クラスタ順のみ保証）。
  バックログに任意項目として残す。

## 6. テスト

- `scripts/_verify-tabtitle.js`（Phase 0・純関数フィクスチャ）。
- `scripts/test-app-tabs.js`（Phase 3・CORPUS_SMOKE）: ①初期1タブ「すべて(N)」②フィルタ追加で
  タイトルが「#tag ＋1」形に ③Ctrl+T→2タブ目・初期state ④切替で activeFilters が戻る
  ⑤ピン留めで左クラスタへ ⑥リネーム→自動上書きされない ⑦tabs.json 永続（set-tabs 呼び出し検証）
  ⑧×で削除・最後の1個はリセット。
  ※ SMOKE は非表示ウィンドウで eval が返らない既知問題あり — ハマったら実機確認へ切替（深入りしない）。
- 既存テストへの影響: body 直下の DOM 再構成（§3.3）で `document.querySelector` 系セレクタは
  ほぼ無傷（id 参照のため）だが、`test-app-render.js` 等のレイアウト前提があれば追従。

## 7. 実装順序まとめ（コミット粒度）

| Phase | 内容 | 完了条件 |
|---|---|---|
| 0 | `filterLabel()` 抽出＋`tabTitleOf()`＋document.title ライブ表示＋`_verify-tabtitle` | **ユーザーがタイトル文言に納得**（ここで止めてフィードバック待ち） |
| 1 | titleBarStyle:hidden＋overlay＋`#tabBar` スケルトン＋レイアウト再構成＋テーマ追従 | ドラッグ/最大化/ボタン/ライトダーク実機OK |
| 2 | タブ帯の完全UI（描画・×・＋・右クリックメニュー・リネーム・ピン留め見た目） | 見た目とインタラクションが DESIGN.md 準拠 |
| 3 | ステート切替・タブ別履歴・永続化・ショートカット・test-app-tabs | スモーク＋実機で全項目PASS |

各 Phase 後に DESIGN.md へ語彙追記（タブ=角丸四角・アクティブ=つまみ・帯=常設面で非ガラス、前例: Chrome/Arc/macOS セグメント）。

## 8. 既知のリスク

- main.js の CRLF/不可視文字 → 編集は小さく（再掲・最重要）。
- `setTitleBarOverlay` は Windows 以外・overlay 無し生成時に throw → 全呼び出し try/catch。
- `env(titlebar-area-*)` は overlay 有効時のみ値が入る → CSS フォールバック必須。
- SMOKE（CORPUS_SMOKE=1）起動でも titleBarOverlay が無害なことを確認（問題が出たら SMOKE 時のみ
  overlay を外す分岐を main.js に）。
- タブ帯追加でグローバル `sticky top:0` 前提（content-activebar L865 は #appMain 内スクロールなので
  影響なしの想定だが、実機で上端の重なりを確認）。
