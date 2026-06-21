# 並列開発タスク台帳

> 進行中の並列タスクと担当ブランチの一覧。運用は [docs/parallel-ops.md](../docs/parallel-ops.md)。
> 統合（オーケストレータ）が毎ラウンド更新する。新セッションはまずここと `git branch --list 'parallel/*'` を読む。

最終更新: 2026-06-21（round 2 完了: 実装2本マージ・設計/調査4本レポート完了）

## 現状（新セッションはまずここ3行）

- 並列運用 round 2 完了。進行中ワーカー: **なし**。実装2本マージ済み（icon-fill-mark `751e7bd` / poster-tag-filter `ce3d1df`）。
- 設計・調査4本（名寄せ/重複保存/詳細検索/WD14）はレポート完了＝要点を BACKLOG 該当項目へ反映済み（フルはセッション履歴 .jsonl）。
- 次の一手（統合の手元タスク）: ①投稿者タグ②を main で実機検証（CDP）②ロゴ採用案を確定（B推奨）→ `electron scripts/make-icons.js` で PNG 再生成→ `assets/icon-{light,dark}.svg` を採用案へ確定。

## 進行中

| slug | branch | round | status | verify | notes |
|------|--------|-------|--------|--------|-------|
| —    | —      | —     | —      | —      | （なし）|

## 完了（マージ済み）

| slug | branch | merged | notes |
|------|--------|--------|-------|
| poster-tags | parallel/poster-tags | 7ef9e03 | 投稿者へのタグ付け①付与基盤。実機確認はユーザーが実施。 |
| icon-fill-mark | parallel/icon-fill-mark | 751e7bd | 塗り主体の正方アイコンマーク2案（A/B×light/dark）＋make-icons.js 刷新（旧インディゴ是正・採用案1箇所切替・既定B）。**残**: 採用確定→PNG再生成（electron）→icon-{light,dark}.svg 確定（統合の手元） |
| poster-tag-filter | parallel/poster-tag-filter | ce3d1df | 投稿者モードのサイドバーにタグ絞り込み（②）。`posterTagFilter`(Set/AND/非永続)・`filteredPosters` でAND・フライアウト(`showQfPopAt('poster-tag')`)再利用・種別ドット。**残**: 実機検証（統合） |

## 設計・調査ファンアウト（round 2・ブランチ無し＝レポート完了。要点はBACKLOG／フルはセッション履歴）

| slug | type | status | 反映先 |
|------|------|--------|-------|
| poster-merge-design | Plan | done | BACKLOG「同一投稿者がSNS別にばらける→名寄せ」 |
| dup-save-design | Plan | done | BACKLOG「重複保存の警告」 |
| search-panel-design | Plan | done | BACKLOG「検索バーの対象コントロール（詳細検索画面）」 |
| wd14-ml-survey | survey | done | BACKLOG「タグ付けの手間を軽減 or 根本解決」 |

## 凡例

- **status**: `queued`（起動待ち）/ `running`（ワーカー走行中）/ `returned`（成果が戻りレビュー待ち）/ `merged` / `done`（設計レポート完了）
- **verify**: `none` / `unit`（ワーカーが単体まで）/ `pending-live`（統合の実機検証待ち）/ `done`
- **round**: 起動ラウンド番号
