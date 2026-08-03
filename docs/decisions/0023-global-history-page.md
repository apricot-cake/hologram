# 0023. グローバル履歴ページ（ブラウザの chrome://history 相当）

- 状態: 採用（2026-07-18〜2026-08-02 Issue コメントで確定・2026-08-03 実装）
- 関連: #145・#144（タブ内履歴・エントリ形の前提）・#5（SQLite 真実源化）・#146（却下・入口の先例）・#28／[0016](0016-one-candidate-engine-three-faces.md)（コマンドパレット）・[0018](0018-labeled-navigation-rail-default.md)（サイドバーの器）

## 背景

#144 がタブ内の戻る/進む（`{u, kind, state}` のタグ付きユニオン、kind は `posts`/`posters`/`image`、#183 で `timeline` が4値目に追加）を確定させた。その永続ログ全体を時系列で一覧・検索・削除できる面が本Issue。

## 決定

### 保存先

ライブラリ DB（`~/.hologram` ではない）の `history` テーブル。行が captureId／フォルダ ID／タグ名を指す以上、履歴はライブラリに属する（`tabs` テーブルと同じ帰属）。

```sql
CREATE TABLE history (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,   -- epoch ms
  u TEXT NOT NULL,       -- 擬似URL（#144 の navEntryUrl と同じ生成器）
  kind TEXT NOT NULL,    -- 'posts' | 'posters' | 'image' | 'timeline'
  title TEXT NOT NULL,   -- 表示ラベル（tabTitleOf / imageTabTitleOf を流用、専用生成器は作らない）
  state TEXT NOT NULL    -- #144 の HologramNavEntry.state を verbatim 保存（間引き済み — 後述）
);
```

`state` は必須（u だけでは posts/posters を復元できない — #144 は「u は state からの導出、復元契約ではない」と確定済み）。「間引き」は書き込み側の責務だが、HologramNavEntry.state はもともと選択状態・スクロール位置を含まない（それらは `HologramTab` 側のフィールド）ため、実装上は何も削らずそのまま保存すれば十分だった。

### 記録対象の線引き・記録経路

記録するのは #144 の **push のみ**（replace は記録しない）。`tab-state.ts` の `makeNavHistory` に `onPush` フックを追加し、`push()` が実際に新しいエントリを積んだ時だけ発火させた（`replace()` からは呼ばない）。連続する同一 `u` はレンダラ側でアプリ全体を通してdedupする（`services/history.ts` の `lastU`）。

書き込みは **レンダラの push 時に main へ fire-and-forget IPC**（`append-history`）。main 一元書き込みで多窓（#32）でも順序と整合が保たれる。

### 器

**非モーダルの Base UI Popover**（幅 360px・高さ `min(70vh, 28rem)`）。錨はサイドバーフッターに新設した「履歴」行（`shell/LeftSidebar.tsx`、パレット行と同じ体裁）。入口は3つ：①この行 ②`Ctrl+H` ③コマンドパレットの `cmd:history`。サイドバーが `Ctrl+Shift+B` で隠れている間に `Ctrl+H` を押した場合は、ウィンドウ左下を仮想錨（`getBoundingClientRect` オブジェクト、`ContextMenu.tsx`/`KindMenu.tsx` と同じ技法）にして同じ位置へ出す（`services/history-panel.ts`）。

**却下**: 特殊タブ（`kind` に4つ目を足すとタブ側の `applyState` ディスパッチと永続化の検証が増える）／モーダル Dialog（作業面が scrim で沈む体感を避ける）／サイドバーの常設ナビ行（履歴は「場所」ではない）。2026-07-18 時点の「⋮ ボタンを錨」という初期決定は #146（⋮ メニュー却下）で前提が消え、2026-08-02 に本決定へ差し替えられた。

### 保持・削除

90日／上限5万件の早い方、掃除は**ライブラリ DB を開いた時に1回**（`main/index.ts` の `ensureDb()`、`dbHandle` メモ化の初回パスにフック — アプリ起動時と #176 のライブラリ切替時の両方をカバーする）。v1 の削除操作は個別削除（行ホバー ×）と全消去（確認ダイアログ）のみ。期間指定削除は v2（DB 実装のため後付けが安い）。

### コマンドパレットの history セクション

Chrome omnibox の `@history` 相当。`services/command-registry.ts` の `CommandSection` に `'history'` を追加。パレットの候補生成は同期関数（`entries(query)`）である一方 DB は非同期なので、`services/history.ts` が直近の push を保持する小さなリングバッファ（`recentHistory()`、上限50件）を持ち、それをパレットの provider が読む。クエリが空の間は何も返さない（`corpus` provider と同じ理由 — 不完全なリストを既定表示にしない）。**削除操作と日付見出しはパレットに乗らない**（それは履歴パネル側の仕事）。

## 影響

- `lib-db.ts` に `add-history-table` マイグレーションを追加（append-only の `MIGRATIONS` 配列）。
- `lib-db-write.ts` に `appendHistory` / `queryHistory`（`(ts, id)` の keyset ページング） / `deleteHistoryRow` / `clearHistory` / `pruneHistory`。
- `ipc-history.ts` を新設（`get-folders` と同じ「ライブラリ共有・isPrimarySender 不要」の形。`get-tabs` の per-window ガードとは違う）。
- `tabs-builder.ts` に `openHistoryEntry`（現在タブで復元・push として記録）と `openHistoryEntryInBackgroundTab`（中クリック、`duplicateTab` と同じ `_navHist`/`_navIdx` 直接構成で `nav` シングルトンに触れない）。

## 標準はどうか

Chrome の `chrome://history` を主要アンカーにした。日付見出し・部分一致検索・個別/全消去・omnibox の `@history` は同型を踏襲。「同日の再訪を畳むか」は Chrome 側の挙動を一次ソースで確認できなかった（未確認）ため、本アプリは独自に「畳まない」と決定した（`services/history.ts`/`makeNavHistory` の dedup は直前の1件のみが対象で、それより前の同一箇所への再訪は別行として積む）。
