---
name: subagent-ground-rules
description: Hologram のサブエージェントが作業を始める前に読む、このリポジトリ固有の約束＝壊してはいけない共有資源（実アプリ・実ライブラリ・日常の Chrome）・反映に要るビルド・検証スキルの選び方・GraphQL 枠。実装/調査/設計のどれで呼ばれた時も最初に読む。**リポジトリを問わない共通ルール（隔離・出口・報告の作法）はユーザースコープの skill `agent-ground-rules` が正本**＝そちらを先に読む。呼び出し側はブリーフで両方を名指しし、Issue 固有の設計だけを書く。
---

# サブエージェントの共通ルール（Hologram 固有分）

**まず skill `agent-ground-rules` を読む**＝隔離（最初の編集の前に専用 worktree）・着手前の判定・出口（PR〜掃除）・報告の作法・並行作業は、リポジトリを問わない共通ルールとしてそちらが正本。**このスキルは Hologram でしか効かない部分だけ**を持つ。

⚠️**ブリーフとここが食い違ったら、ブリーフが優先**（呼び出し側はこの件の事情を知っている）。

## 1. 壊してはいけない共有資源（このリポジトリ固有）

- ⚠️**本体ツリーで `npm run build --workspace=app` / `npm run build:ext` を走らせない。** 本体の `app/out` と `extension/.output/chrome-mv3` は**ユーザーが日常使いしているアプリと拡張の実体**。ビルドは worktree の中で。
- ⚠️**実ライブラリを壊さない。** 書き込みを伴う検証は `HOLOGRAM_CONFIG_DIR` でサンドボックス化する（`scripts/sandbox-app.cts`）。**設定画面の「危険な操作」セクションのボタンを押さない。**

## 2. 着手前の判定で足すもの

⚠️**UIアンカー7種は質感のリファレンスであって「何が標準か」の権威ではない**＝標準を調べる時はその外も広く見る（規則の本体は `agent-ground-rules` 3.）。

## 3. 反映と検証

- ⚠️**main / preload / renderer / native-host を直したら `npm run build --workspace=app`**（native-host のブリッジ本体なら `npm run build:native-host-bridge --workspace=app` も）。**走らせないと古いバンドルのまま動き、直っていないものを検証してしまう。**
- **`npm run check` を通す。** ⚠️ただし**変更の種類によっては check が何も見ないことがある**（`.md`/`.txt` は Biome の対象外・typecheck も Vitest も見ない）。**緑を根拠にする前に、その変更を check が実際に踏むかを確かめる。**
- **UI を変えたら見た目パスは必須**（skill `verify-with-cdp` / `run-hologram`）。ライト/ダーク両方。
- 拡張を触ったなら skill `verify-extension`（拡張検証の共通罠はユーザースコープの skill `browser-extension-verify`）。テストを worktree で回すなら skill `test-in-worktree`。

## 4. 並行作業で足すもの

⚠️**GraphQL の枠は共有**＝全数照合は REST 1回（`gh api --paginate "repos/apricot-cake/hologram/issues?state=all&per_page=100"`）でローカル grep（規則の本体は `agent-ground-rules` 7.）。
