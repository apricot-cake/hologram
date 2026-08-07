# Security Policy

## Supported versions

Only the latest published release receives security fixes. Older versions are not maintained in parallel.

## Reporting a vulnerability

Please report security issues privately through GitHub, using the **[Report a vulnerability](https://github.com/apricot-cake/hologram/security/advisories/new)** button on this repository's Security tab.

**Do not open a regular issue or pull request for a security problem.** Reproduction steps, proof-of-concept code, and details of an unfixed weakness are all things that should stay private until a fix is available.

Useful things to include, as far as you can:

- Which component is affected — the Electron app, the browser extension, or the native messaging host
- The version you are running, and your OS and browser
- What an attacker gains, and what access they need to get there
- Steps to reproduce, ideally against a throwaway library rather than your real one

## What to expect

Reports are reviewed privately in a draft security advisory. We will confirm the report, work on a fix there, and coordinate disclosure once a fixed version is available.

We do not commit to a fixed response time or a fixed patch deadline. Whether an advisory is published, and whether a CVE is requested, is decided per case — based on whether a published version is affected and whether users need to be notified.

## Scope notes

Hologram stores your library as ordinary files in a folder you choose, and sends nothing to any server of ours. Reports that are especially relevant include anything that lets a web page reach the native messaging host or the local library beyond what saving a post requires, anything that writes outside the configured library folder, and anything that leaks the contents of your library to a remote host.

Vulnerabilities in third-party dependencies should be reported to the project that maintains them. If a dependency issue affects Hologram specifically — for example through how we call it — a report here is welcome.

---

# セキュリティポリシー

## サポート対象

セキュリティ修正の対象は**最新の公開版のみ**です。それより古い版を並行して保守することはありません。

## 脆弱性の報告

セキュリティ上の問題は、このリポジトリの Security タブにある **[Report a vulnerability](https://github.com/apricot-cake/hologram/security/advisories/new)** から、非公開で報告してください。

**通常の Issue や Pull Request で報告しないでください。** 再現手順・実証コード・未修正の弱点の詳細は、修正版が出るまで非公開にしておくべきものです。

分かる範囲で、次の情報があると助かります。

- 影響する部分（Electron アプリ / ブラウザ拡張 / ネイティブメッセージングホストのどれか）
- 使用しているバージョンと、OS・ブラウザ
- 攻撃者が何を得られるか、そのために何の権限が必要か
- 再現手順（できれば実際のライブラリではなく、壊してよいライブラリに対するもの）

## 対応の流れ

報告は draft security advisory の中で非公開に確認します。そこで再現を確かめ、修正を進め、修正版が利用可能になってから公開の調整を行います。

初動までの時間や修正期限をあらかじめ約束することはしません。advisory を公開するか、CVE を申請するかは、公開版に影響があるか・利用者への通知が必要かを見て個別に判断します。

## 対象範囲について

Hologram はライブラリを利用者が選んだフォルダに普通のファイルとして保存し、こちらのサーバーへは何も送りません。とくに関係が深いのは、ウェブページが投稿の保存に必要な範囲を超えてネイティブホストやローカルのライブラリへ到達できてしまうもの、設定されたライブラリフォルダの外へ書き込めてしまうもの、ライブラリの中身が外部へ漏れるものです。

依存ライブラリ自体の脆弱性は、その保守元へ報告してください。呼び出し方などを通じて Hologram 固有の影響が出る場合は、こちらへの報告も歓迎します。
