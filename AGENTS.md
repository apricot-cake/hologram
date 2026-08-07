# Codex の入口

Hologram リポジトリまたはその worktree で作業する前に、リポジトリ直下の `CLAUDE.md` を全文読む。プロジェクトの規則の正本は `CLAUDE.md` とし、このファイルには重複して書かない。

# Codex のメモリ参照

Hologram リポジトリまたはその worktree を対象に作業するときは、開始時に `C:\Users\apricot\.claude\projects\C--Users-apricot-local-dev-hologram\memory\MEMORY.md` を索引として読み、依頼に関係するメモリ本体を読む。

作業の途中でも、対象が新しい機能領域・ビルド方式・実機検証・設計判断へ移ったら、`MEMORY.md` を再照合する。Issue、コード、ドキュメント、ユーザー指示から新しい論点が現れた場合も同じとする。

再照合で関係する項目があれば、その本体を読んでから、当該論点の設計判断・編集・検証方針の決定へ進む。索引だけで「読んだ」とは扱わない。

# 拡張の実機検証

拡張の開発は日常利用とは別の Chrome プロファイルで行う（#732）。専用 worktree から開発サーバーを起動しても日常の Chrome には影響しないので、配信元の取り合いは無い。日常の Chrome に載るのは `npm run deploy:ext` を通った検証済み release だけで、昇格は本体ツリーの `post-merge` フックが行う。手順と実機検証は `docs/build.md`「拡張機能の開発・配布」が正本。