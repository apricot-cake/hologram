# 設計判断の記録（ADR）

このディレクトリは Architecture Decision Record＝**決めたことと、その理由と、捨てた案**を1決定1ファイルで残す。連番は採番順で、欠番も再利用もしない。

`architecture.md` は「今どうなっているか」、ここは「なぜそうなったか」。実装が変われば前者を書き換え、判断が変われば**ここには追記せず新しい番号を起こして、古い方の状態を「置き換え」にする**（過去の判断を消さないのが記録の目的）。

決定の詰めは GitHub Issues で行い、実装まで進んだものがここへ昇格する。まだ議論中のものは Issue に置いたままにする。

## 様式

```markdown
# NNNN. 見出し

- 状態: 採用（YYYY-MM-DD） / 置き換え（NNNN へ） / 撤回（YYYY-MM-DD）
- 関連: #Issue番号・関連する決定の番号

## 背景
## 決定
## 影響
## 却下した案
```

書くことが無い節は落としてよい（埋めるために推測を書かない）。

## 一覧

| # | 決定 | 状態 |
| --- | --- | --- |
| [0001](0001-react-for-component-discipline.md) | React 化の目的は部品化の強制とドリフト防止 | 採用 |
| [0002](0002-dependency-adoption-criteria.md) | 依存を入れる基準 | 採用 |
| [0003](0003-build-vs-borrow-boundary.md) | 自前で持つものと委ねるものの線引き | 採用 |
| [0004](0004-own-styling-headless-behaviour.md) | 見た目は自前・挙動はヘッドレス | 置き換え（0006 へ） |
| [0005](0005-no-visual-change-during-migration.md) | 移行作業では見た目を意図的に変えない | 採用 |
| [0006](0006-plain-shadcn-look.md) | 素の shadcn ルックを採る | 採用 |
| [0007](0007-horizontal-tabs-not-vertical.md) | タブは上部水平に置く（縦タブを採らない） | 採用 |
| [0008](0008-single-smart-search.md) | 検索モードの切替を廃し単一のスマート検索にする | 採用 |
| [0009](0009-bottom-floating-selection-bar.md) | 選択中の操作は底部中央のフローティングバーに置く | 採用 |
| [0010](0010-sqlite-as-the-metadata-truth-source.md) | メタデータの正本を SQLite に置き、ファイルは実体だけを持つ | 採用 |
| [0011](0011-preserve-acquisition-payloads.md) | 取得したペイロードを原本として残し、正規化フィールドへの昇格だけを実需で絞る | 採用 |
| [0012](0012-accent-color-scoped-to-selection-and-active-state.md) | アクセント色は選択・作用中の状態表示だけに使う | 採用 |
