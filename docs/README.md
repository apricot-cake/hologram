# Hologram のドキュメント

どれが何の正本かの索引。**内容はここに写さない**＝各文書が正で、この表は行き先だけを持つ。

| 文書 | 正本として持つもの |
| --- | --- |
| [scope.md](scope.md) | **射程**＝名乗り・概念モデル・取込の3段構造・採否の物差し・射程外。**個別機能の採否はここで判定する** |
| [architecture.md](architecture.md) | **いまどうなっているか**＝3構成（Chrome 拡張 → Native Messaging → Electron アプリ）と主要モジュールの役割 |
| [decisions/](decisions/README.md) | **なぜそうなったか**＝ADR。1決定1ファイルで、決めたことと理由と捨てた案を残す |
| [build.md](build.md) | ビルドと反映・起動経路・実機検証の隔離4段構え・拡張の開発と配布・保存が失敗した時に読むログ |
| [testing.md](testing.md) | テストの層と一覧・CI が何をどこで走らせるか |
| [glossary.md](glossary.md) | 確定した用語（UI の日本語 ⇔ コードの英語）。**新しい語をここで作らない** |
| [PRIVACY.md](PRIVACY.md) ／ [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) | 公開面の開示 |

機能説明は [README.md](../README.md)（[日本語](../README.ja.md)）、残タスクは GitHub Issues と Project「Hologram Backlog」。ストア掲載文は `store-description.txt` ／ `.ja.txt`。
