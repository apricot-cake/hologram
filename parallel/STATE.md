# 並列開発タスク台帳

> 進行中の並列タスクと担当ブランチの一覧。運用は [docs/parallel-ops.md](../docs/parallel-ops.md)。
> 統合（オーケストレータ）が毎ラウンド更新する。新セッションはまずここと `git branch --list 'parallel/*'` を読む。

最終更新: 2026-06-21（round 2 クローズ。残作業は BACKLOG へ移譲・新ラウンドは未起動）

## 現状（新セッションはまずここ3行）

- 並列運用 round 2 クローズ。進行中ワーカー: **なし**。`parallel/*` ブランチ: なし（マージ後削除）。
- round2 でマージ済み: 投稿者タグ②絞り込み（`ce3d1df`）・ロゴ塗りマーク2案＋make-icons刷新（`751e7bd`）。設計4本（名寄せ/重複保存/詳細検索/WD14）は要点を BACKLOG 反映済み。すべて push 済み（`a6681f5`）。
- 残（ユーザー判断で BACKLOG 管理・並列ではなく手元/次セッション）: ①投稿者タグ②の**確認フェーズ未実施** ②**ロゴは塗りマーク不採用→根本見直し**（試作は残置・PNG未再生成）。次の新規実装ラウンドは「一旦やめる」。

## 進行中

| slug | branch | round | status | verify | notes |
|------|--------|-------|--------|--------|-------|
| —    | —      | —     | —      | —      | （なし）|

## 完了（マージ済み）

| slug | branch | merged | notes |
|------|--------|--------|-------|
| poster-tags | (削除済) | 7ef9e03 | 投稿者へのタグ付け①付与基盤。実機確認はユーザーが実施。 |
| icon-fill-mark | (削除済) | 751e7bd | 塗りマーク2案＋make-icons刷新。**結論=塗り方向は不採用・ロゴ根本見直しへ**（試作残置・PNG未再生成）。BACKLOG「ロゴ／アイコンの小サイズ対応」参照 |
| poster-tag-filter | (削除済) | ce3d1df | 投稿者モードのサイドバーにタグ絞り込み（②）。**確認フェーズ未実施**（BACKLOG 管理） |

## 設計・調査ファンアウト（round 2・ブランチ無し＝レポート完了。要点はBACKLOG／フルはセッション履歴 .jsonl）

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
