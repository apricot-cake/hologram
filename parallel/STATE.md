# 並列開発タスク台帳

> 進行中の並列タスクと担当ブランチの一覧。運用は [docs/parallel-ops.md](../docs/parallel-ops.md)。
> 統合（オーケストレータ）が毎ラウンド更新する。新セッションはまずここと `git branch --list 'parallel/*'` を読む。

最終更新: 2026-06-21（立ち上げ直後・進行タスクなし）

## 進行中

| slug | branch | round | status | verify | notes |
|------|--------|-------|--------|--------|-------|
| —    | —      | —     | —      | —      | （なし）|

## 完了（マージ済み）

| slug | branch | merged | notes |
|------|--------|--------|-------|
| —    | —      | —      | （なし）|

## 凡例

- **status**: `queued`（起動待ち）/ `running`（ワーカー走行中）/ `returned`（成果が戻りレビュー待ち）/ `merged`
- **verify**: `none` / `unit`（ワーカーが単体まで）/ `pending-live`（統合の実機検証待ち）/ `done`
- **round**: 起動ラウンド番号
