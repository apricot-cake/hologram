# 並列開発の運用（オーケストレータ ＋ worktree 隔離ワーカー）

> BACKLOG の独立タスクを並列で進めるための運用ルール。
> 新規セッション / clear 後も、この文書 ＋ [`parallel/STATE.md`](../parallel/STATE.md) ＋ git を読めば同じ方式で再開できる。

## 役割

- **統合（オーケストレータ）= メインの対話セッション**。タスク分割・ワーカー起動・main へのマージ・実機検証を一手に握る。
- **ワーカー = `Agent(isolation:"worktree")` で起こすサブエージェント**。main から切られた専用の一時 worktree でコードを書き、`parallel/<slug>` にコミットする。最終メッセージ（成果サマリ）だけが統合に返る。

## なぜこの形か（corpus 固有の制約）

実データを固定パスで共有するため、複数の実機を同時に動かせない:

- 設定・DB → `%APPDATA%/Corpus`（`native-host/paths.js` `configDir()`）
- ライブラリ実体 → `%LOCALAPPDATA%/Corpus/library`（git 管理外）
- シングルインスタンスロック（`app/main.js`）が2つ目の実機を弾く

→ **ワーカーは実機検証しない**。コード＋静的検証 / ユニットテストまでが守備範囲。動的・実機検証は統合が main で直列に行う。
（実機が見るのは main の作業ツリーなので、ワーカーの worktree 変更は実機に流れ込まない＝ホットリロード衝突も起きない。）

## 1ラウンドの手順（統合がやる）

1. **分割**: BACKLOG からタスクを独立単位に。依存チェック —
   - 同じファイルを触る2タスクは同一ラウンドで並列にしない
   - 実機検証が要るものは「コード化（ワーカー）」と「検証（統合）」に分ける
2. **起動**: `Agent` を1メッセージに並べて並列起動（`isolation:"worktree"`、長時間は `run_in_background:true`）。
3. **取り込み**: 戻った成果をレビュー → ブランチ `parallel/<slug>` を main へ順次マージ、衝突は統合が解消。
4. **検証**: main で実機確認（CDP `:9222`。起動前にユーザーへ「今は触らないで」、終了後「もうOK」）。
5. **記録**: `parallel/STATE.md` を更新。意味のある単位でコミット、一段落で push。

## ワーカー起動テンプレ

- `subagent_type`: 既定は `claude`（汎用）。探索だけなら `Explore`。
- `prompt` に必ず含める:
  - タスク内容と完了条件
  - 「ブランチ `parallel/<slug>` で作業しコミットすること」
  - 「実機起動・アプリ再起動・実機検証はしないこと（統合が行う）」
  - 「最後に下記 schema で報告すること」
- `schema`（ハンドオフ）: `{ branch, changedFiles[], commits[], remaining[], verifyState }`
  - `verifyState`: ワーカー側で済んだ検証（lint / unit）と、統合に委ねる実機検証の別を書く。

## マージ規約

- ワーカーは `parallel/<slug>` に積むだけ。main へは出さない。
- 統合が `git log main..parallel/<slug>` で中身を確認し、`git merge --no-ff` か `cherry-pick`。
- 衝突は統合が解消（ワーカーは互いの作業を知らない）。
- **注意（実証済み）: ワーカーはセッション開始時の main から分岐する**（統合がセッション中に入れたコミットを含まないことがある）。
  `git merge-base main parallel/<slug>` で起点を確認。`git diff main..parallel/<slug>` で基盤ファイルが「消えて」見えても慌てない
  ── `git show --stat <commit>` でワーカーが実際に触ったファイルを見れば、削除ではなく古い起点に無いだけと分かる（3-way マージが main 側を保持する）。

## node_modules

- 書くだけのワーカー＝不要（worktree には `app/node_modules` が来ない＝gitignore）。
- lint / test / 実行が要るワーカーだけ、worktree の `app/node_modules` を本体へ junction 共有
  （読み取りのみで安全・worktree 内で `npm install` は走らせない）。

## セッション跨ぎの引き継ぎ

引き継げないもの: 会話の記憶、走行中のワーカー（`run_in_background` は親セッション消滅で孤児化）。
状態は3層で外部化してある:

1. **方式** = この文書（CLAUDE.md から参照）＋ auto-memory `parallel-ops`
2. **進行** = `parallel/STATE.md` 台帳
3. **成果** = ブランチ `parallel/*` とコミット（git に永続）

**新セッションの再開手順**:
1. この文書で方式を把握
2. `parallel/STATE.md` ＋ `git branch --list 'parallel/*'` ＋ `git log main..parallel/<slug>` で進行確認
3. 完了未マージ→マージ、未完→新ワーカーを当て直し

**clear する前に**: 走行中ワーカーの取り込み or 停止と `parallel/STATE.md` 更新を済ませる
（孤児化した background ワーカーの未コミット成果は失われる）。

## やらないこと（既定）

- ワーカーによる実機検証・SMOKE 静的スクショ（データ共有＋single instance のため統合に寄せる）。
- 並列実機検証が本当に要るときだけ、`app/main.js` / `native-host/paths.js` を env 対応
  （`CORPUS_CONFIG_DIR` / `CORPUS_LIBRARY_DIR` / 任意 CDP ポート）に改修してテスト用隔離環境を用意。
  代償: native-host（拡張キャプチャ）連携検証は不可、実ライブラリはコピーせずテスト用に置換。

## 関連

- 進行台帳: [`parallel/STATE.md`](../parallel/STATE.md)
- 実機検証の作法: [docs/build.md](build.md)「検証ルール（実機CDP）」
