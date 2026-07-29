# 0013. アクセント色は選択・作用中の状態表示だけに使う

- 状態: 採用（2026-07-12 採否決定・2026-07-25 配線先確定・2026-07-29 実装）
- 関連: #114・#270（配線先の子 Issue）

## 背景

主要画面はほぼ完全モノトーンで、選択状態も灰色だった。トークンとしては水色（sky）系のアクセントが整備済みだったが、常用画面での出番がなかった。

## 決定

アクセント＝**`#2563eb`（標準の true blue）**。旧・水色 sky（design-tokens.css の `--accent`/`--sky-*`）は淡すぎて機能せず退場。

用途は「選択・作用中」の2種類だけに限定する：

1. **選択状態**: グリッドカードの選択リング（`::after` の輪郭）・選択チェックの塗り。
2. **「いま効いているもの」**: 検索一致ハイライト（設定検索の `<mark>`）・モード中インジケータ（今後追加されるもの）。

**CTA・常設ボタンには使わない**。常設要素に塗ると「画面に同時に出るアクセントは1〜2箇所まで」の上限が構造的に破れ、モノトーンの静けさが崩れるため。選択・作用中は「起きている時だけ光る」ので上限と自然に両立する。

配線先は `app/src/renderer/src/globals.css`（Tailwind v4 `@theme` + shadcn base-nova）の新規セマンティックトークン `--color-selected`（生値 `--ui-selected: #2563eb`）。shadcn 標準の `--color-accent`/`--ui-accent` は再利用しない — those は menu/select/sidebar の行ホバー背景に広く使われる中立色で、そこを青くすると用途が「選択・作用中」から逸脱し、ホバー全域に色が漏れる。

薄い輪郭（選択リング）は追加トークンを増やさず `color-mix(in oklch, var(--color-selected) 45%, transparent)` で都度合成する（design-tokens.css の `--focus-ring` と同じパターン）。

## 影響

- `app/src/renderer/index.html` の legacy CSS（`.post-card.selected::after` / `.post-card.selected .select-check`）を `--color-selected` へ差し替え。
- `app/src/renderer/src/settings/components/Highlight.tsx` の検索一致 `<mark>` を `bg-primary/20` → `bg-selected/20` へ。
- `app/src/renderer/design-tokens.css` は変更せず、退場予定の sky スケールにコメントだけ追記（新方針は globals.css 側が正）。

## 却下した案

- **主要 CTA（インスペクタの「追加」ボタン等）へのアクセント塗り**: 常設要素が構造的に「1〜2箇所」の上限を破るため不採用。
- **インディゴ #4f46e5**: 筋は良いがユーザー不採用（true blue を採用）。
