# プロジェクト概要
Hologram = ウェブのコンテンツ（現対応はSNS投稿）を出自・エンゲージメントごとローカル保存し検索・整理できる「自分だけのコンテンツライブラリ」（X/Bluesky/Misskey/Mastodon/pixiv対応、Chrome拡張→Native Messaging→Electronアプリの3構成、サーバー送信なし。射程の正＝docs/scope.md）。

# ドキュメント
射程・機能の採否＝docs/scope.md／詳細=docs/architecture.md／**設計判断とその理由＝docs/decisions/（ADR・1決定1ファイル・実装まで進んだ設計はIssueからここへ昇格）**／ビルド・実機検証=docs/build.md／テスト一覧=docs/testing.md／**確定した用語（UI日本語⇔コード英語）と「固有名を付けない」と決めた領域＝docs/glossary.md（新語をここで作らない）**／機能説明=README.md／残タスク=GitHub Issues＋Project「Hologram Backlog」（apricot-cake/hologram）。実装のhow・私的文脈はメモリ`hologram-backlog`、訴求の物差し（文言を書く前に読む）はメモリ`hologram-positioning`（ともにrepo外）

# ストレージと実行環境
- 配置は`~/.hologram`(config/ログ)と`saveFolder`(既定`~/Hologram/library`)＝**AppData外必須**（MSIX仮想化でのライブラリ消失事故対策・2026-06-23）
- この開発機（MSIXコンテナ内）固有の作法＝アプリ起動は`HologramLaunch`タスク経由・レジストリ確認は自分で実行せずユーザーに依頼・テストは`HOLOGRAM_CONFIG_DIR`でサンドボックス化。手順と理由はdocs/build.md「コード変更の反映」「検証ルール」

# ルール
- lint/format＝Biome（`npm run lint`／2.5.6完全固定・設定と固定理由は biome.jsonc）
- **CIはマージのゲート＝緑になるまでマージしない**（2026-08-04 #883 で決定＝2026-07-27 #15 の「チェックが実行中でも待たずに自己マージしてよい」を**置き換える**。当時ゲートにしなかった理由は「待ちが惜しい」ではなく**private + Free では branch protection / rulesets の API 自体が 403 で存在しなかった**ことで、#75 の public 化がその前提を消した）: `main` の ruleset が**直接 push を禁止**し、PR に必須チェック2本を課す＝`ci.yml`（lint/typecheck/test・Linux・**約1.5分**）と `app-tests.yml`（Electron 実起動ハーネス＋拡張のブラウザE2E・Windows・**約3分**）。⚠️**app-tests の所要はランナー個体差で2.5〜5分に振れる**＝短縮策の効果を前後1回ずつの比較で判定しない（#967 で「準備 68→50秒」と読んだ差が、次の回には回ごとの差に埋もれた）。所要が縮んだ経緯＝#933 実起動ハーネスの並列化・#935 依存とブラウザのキャッシュ・#937 シャード分割・#967 冗長キャッシュの撤去・#968 全テストの共有プール化と割り直し。⚠️**docs だけの PR（`*.md` と `docs/**` のみ）は重い工程を飛ばして即緑になる**（#928/#929）＝0秒に近い実行を見ても壊れていない。必須チェックに paths フィルタを掛けられないための作り（掛けるとスキップされたチェックが `expected` のまま残りマージを塞ぐ）。どちらも `pull_request` で走り、検査するのは `refs/pull/N/merge`＝**マージ結果**（行が衝突しないのに互いを壊す2本を、ここで捕まえる）。⚠️**"Require branches to be up to date before merging" は不採用**＝#415 の設計は「PR を直列に捌いている」前提だったが、実態は並行セッション5〜6本が常態で、有効にすると1本マージするたび残り全部が古くなり再実行の連鎖になる（2026-08-04 に実測して外した）。⚠️**手元で `npm run check` を通す習慣は変えない**＝CIに投げてから直すより速いというだけの理由で、ゲートの代わりではない。⚠️**bot も例外ではない**＝`schema-canary.yml`（#465・Linux・1日1回 03:07 JST）は基準スナップショットを**自動 PR＋auto-merge** で返す（`chore(canary): …` ＝**身に覚えの無い PR が立っていたらこれ**）。**個人リポジトリの ruleset は bypass に GitHub Actions を指定できない**（organization 限定＝API が 422 で拒否・2026-08-04 実測）ので、bot にも直接 push の道が無い。終了コードの扱いと「警報が出た回はコミットしない」理由は docs/testing.md が正。⚠️**それでもCIが踏まない領域＝パッケージング（`npm run dist`）**。ここの更新は緑でも何も確かめられていない＝**手元で該当経路を走らせてから判断する**。⚠️**Dependabot の運用規則はユーザースコープの `CLAUDE.md` が正**（Issue が引き取った依存は `.github/dependabot.yml` の `ignore` で止める＝#932）＝ここは**このリポジトリの実例**だけ：#394（electron-builder 系5本を「個別にマージせず本Issueで一括」と本文に明記していたのに、緑を理由に単独マージした事故）。
- **main/preload/renderer・native-hostを直したら`npm run build --workspace=app`**（native-hostのブリッジ本体を直した時は`npm run build:native-host-bridge --workspace=app`も。走らせないと古いバンドルのまま動き、直っていないものを検証してしまう）。npmスクリプトの置き場と反映手順の全体はdocs/build.md「コード変更の反映」
- **本体作業ツリーの同期と拡張機能の反映は確認なしで行う**: 共有`main`の更新を本体へ取り込む前に未コミット変更と差分を確認し、安全に統合できると分かれば同期する。**開発と日常利用はChromeプロファイルごと分かれている**（#732）＝日常のChromeは本体の`extension/.output/chrome-mv3`だけを読み、そこに入るのは`npm run deploy:ext`を通った検証済みreleaseだけ。昇格は本体ツリーの`post-merge`フックが自動で走らせ、拡張は#650の自己リロードで手動操作なしに入れ替わる（保存・一括取込・キャプチャUIが進行中なら終わるまで待つ）。**拡張の開発は専用プロファイル**＝`npm run dev:ext`（常駐しない）＋一度だけLoad unpackedした`~/.hologram-dev/chrome-mv3-dev`で、保存は別ホスト名`com.hologram.host.dev`経由で`~/.hologram-dev`へ隔離される（初回だけ`npm run ext:dev:register`）。release/ZIPは`npm run build:ext`／`npm run zip:ext`。手順はskill `verify-extension`、理由はdocs/build.md「拡張機能の開発・配布」。並行作業との衝突確認は維持するが、ユーザーへの可否確認は不要（2026-07-25、#732で更新）。
- **個人ライブラリと後方互換を製品判断のゲートにしない**（2026-07-11 統合改訂）:
  - 私個人ライブラリの事情（規模・件数・利用実態）に合わせた機能開発・採否・優先度・**据置の発火条件**・性能目標の判断をしない。一般ユーザーにも有用な機能、もしくは単なるライブラリの整理や修正ならOK。
  - 私のライブラリに気を使って（既存データとの互換維持などを理由に）**設計を歪めない**。
  - **リリース前につき「他人のライブラリ」は存在しない**＝既存ユーザーデータとの後方互換・移行コード・旧名の焼き付きを理由に、命名や設計を妥協しない。
  - 手元ライブラリを壊さないための一回きりの移行手順は、設計でなく作業手順として可（リリース前に撤去してよい仮設コード）。
