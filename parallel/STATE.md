# 並列開発タスク台帳

> 進行中の並列タスクと担当ブランチの一覧。運用は [docs/parallel-ops.md](../docs/parallel-ops.md)。
> 統合（オーケストレータ）が毎ラウンド更新する。新セッションはまずここと `git branch --list 'parallel/*'` を読む。

最終更新: 2026-06-21（poster-tags をマージ・実機確認はユーザーが普通に使って実施）

## 進行中

| slug | branch | round | status | verify | notes |
|------|--------|-------|--------|--------|-------|
| —    | —      | —     | —      | —      | （なし）|

## 完了（マージ済み）

| slug | branch | merged | notes |
|------|--------|--------|-------|
| poster-tags | parallel/poster-tags | 7ef9e03 | 投稿者へのタグ付け①付与基盤（main/preload/lib-archive/viewer/i18n/index.html）。ワーカー commit e72f9fc を 3-way マージ。実機確認はユーザーが普通に使って実施。要確認点: タグ編集セクションを常時表示にした設計判断・undo非対応 |

## 凡例

- **status**: `queued`（起動待ち）/ `running`（ワーカー走行中）/ `returned`（成果が戻りレビュー待ち）/ `merged`
- **verify**: `none` / `unit`（ワーカーが単体まで）/ `pending-live`（統合の実機検証待ち）/ `done`
- **round**: 起動ラウンド番号
