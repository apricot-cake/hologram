# Codex の入口

Hologram リポジトリまたはその worktree で作業する前に、リポジトリ直下の `CLAUDE.md` を全文読む。プロジェクトの規則の正本は `CLAUDE.md` とし、このファイルには重複して書かない。

# Codex のメモリ参照

Hologram リポジトリまたはその worktree を対象に作業するときは、開始時に `C:\Users\apricot\.claude\projects\C--Users-apricot-local-dev-hologram\memory\MEMORY.md` を索引として読み、依頼に関係するメモリ本体を読む。

作業の途中でも、対象が新しい機能領域・ビルド方式・実機検証・設計判断へ移ったら、`MEMORY.md` を再照合する。Issue、コード、ドキュメント、ユーザー指示から新しい論点が現れた場合も同じとする。

再照合で関係する項目があれば、その本体を読んでから、当該論点の設計判断・編集・検証方針の決定へ進む。索引だけで「読んだ」とは扱わない。

# 拡張の実機HMR

専用 worktree で拡張または拡張開発基盤を編集する時は、最初の編集前にその worktree で `npm run ext:preview:acquire` を実行する。所有 ID は `CODEX_THREAD_ID` が使われ、別セッションが日常 Chrome を検証中なら横取りせず止まる。終了処理では、成功・失敗にかかわらず同じ worktree から `npm run ext:preview:release` を実行して main 配信へ戻す。手順と実機検証は skill `test-in-worktree` / `verify-extension` が正本。
