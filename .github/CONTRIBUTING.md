# 貢献者ガイドライン

Hologram は開発を公開していますが、保守しているのは1人です。Issue は不具合と機能の要望を記録し、Project で優先度と進捗を管理します。

## どこへ持っていくか

| 伝えたいこと | 行き先 |
| --- | --- |
| 壊れている | [不具合の報告](https://github.com/apricot-cake/hologram/issues/new?template=bug_report.yml) |
| 質問（どうすれば…？） | [Discussions → Q&A](https://github.com/apricot-cake/hologram/discussions/categories/q-a) |
| 機能の案 | [機能を提案する Issue](https://github.com/apricot-cake/hologram/issues/new?template=feature_request.yml) |
| 脆弱性 | [非公開の報告フォーム](https://github.com/apricot-cake/hologram/security/advisories/new) — [SECURITY.md](SECURITY.md) を参照してください。**これを公開の Issue に書かないでください** |
| そのほか | [Discussions → General](https://github.com/apricot-cake/hologram/discussions/categories/general) |

機能の要望は Issue に記録します。採用や優先度は、既存の Issue と射程を確認して判断します。

ブラウザ拡張機能を使っている場合、Chrome ウェブストアの掲載ページにも問い合わせフォームがあります。GitHub アカウントではなく Google アカウントが必要で、扱えるのは拡張機能の話だけです。

## 不具合をうまく報告するには

不具合報告のフォームはアプリのバージョン・OS・再現手順を尋ねます。これらが無いと、たいてい手の打ちようがないからです。逆に、次の2つは書かないでください。

- **ライブラリのパス** — 不具合よりもあなたの PC のことを多く語ってしまいます。
- **保存した投稿の本文や画像** — 他人のコンテンツを持ち出さなくても不具合は説明できます。

アプリのログは `%APPDATA%\Hologram\logs\main.log` に出ます。添えるなら失敗の前後の行だけで十分です。ファイル全体が役に立つことはまれで、見せたくないパスが混じることもあります。

## プルリクエスト

修正の域を超える変更なら、先に Issue か Discussion を立ててください。予告なく届いたプルリクエストは、単にこのプロジェクトが向かっていない方向だという理由で断ることがあります。それはこちらより、あなたの時間を無駄にします。

プッシュする前に:

```
npm run check
```

Biome・型検査・単体テストが走ります。CI も同じものを走らせるので、手元が緑なら CI もたいてい緑になります。

コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/) に従います（`fix(renderer): …`・`docs(privacy): …`）。

ローカルでアプリ・拡張機能・Native Messaging ホストを動かす手順は `docs/build.md` にあります。表示言語を追加する場合は `docs/localization.md`、全体がどう組み合わさっているかは `docs/architecture.md`、このプロジェクトが何を目指し何を目指さないかは `docs/scope.md` にあり、大きな提案をする前に読む価値があります。

## ライセンス

貢献したものは、プロジェクトの他の部分と同じく [MIT License](../LICENSE) のもとで公開されることに同意したものとみなします。
