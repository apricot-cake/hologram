# 取得先と安定性

Eagle Info+ (Chrome 拡張) と Engagement Browser (Window Plugin) が叩く外部 API と、その安定性。
拡張とプラグインは**同じ SNS エンドポイント**を使う（拡張は annotation 用、プラグインは数値＋人間情報用）。

engagement の「取れるフィールド」一覧は [todo.md](todo.md) の「API engagement 取れる範囲」を参照。本書は**エンドポイントと安定性**の観点。

## 一覧

| 取得先 | エンドポイント | 安定性 | 備考 |
|---|---|---|---|
| Eagle ローカル REST | `localhost:41595/api/...` | ✅ 公式・安定 | ドキュメント化 API。拡張が item 更新に使う |
| Eagle Plugin API | `eagle.item.*` / `library.info` / `app.show` / `item.moveToTrash` 等 | ✅ 公式・安定 | 全て公式記載メソッドのみ使用。**未公開 API は意図的に不採用**（in-window preview 等を見送ったのはこのため）。`eagle.app.show` は Eagle 4.0 build18+ なので存在チェックでガード |
| Bluesky | `public.api.bsky.app/xrpc/app.bsky.feed.getPostThread` | ✅ 公式・安定 | AT Protocol の公開 XRPC。認証不要で公開投稿取得可。3 つの SNS で最も堅い |
| pixiv | `www.pixiv.net/ajax/illust/<id>` | 🟡 非公式・中程度 | pixiv フロント自身が叩く内部 AJAX。非ドキュメントだがサイトが依存しており実用上は安定。`credentials: include` で R-18/ログイン対応。仕様変更はありうる |
| X (Twitter) | `cdn.syndication.twimg.com/tweet-result?id=...&token=0` | 🔴 非公式・不安定 | 埋め込みツイートの裏 CDN。公式契約なし・レート制限非公開・`token=0` は裏技（本来は id から計算するトークン）。利用不可ツイートは `TweetTombstone` を返す。**ここだけ脆い** |

## X だけが不安定な理由

- 公式 X API v2 は**認証必須かつ有料化**。**無認証で likes 等を取る手段が実質 syndication しかない**
- syndication は仕様非公開で、X 側の都合でいつ変更/閉鎖されてもおかしくない
- 取れるのも **likes / replies のみ**（reposts/views/quotes/bookmarks は GraphQL 認証が必要 → さらに不安定なので非対応）

### X への防御（Engagement Browser 側）

- **間隔**: 1 並列 / 2.5〜3.5 秒（`minIntervalMs` + jitter）
- **429/420 で即停止**: レート制限応答を検知したら run を止め、未処理は status 据え置きで再開可能（`error` 印は付けない）
- **日次上限**: 既定 X = 500/日（`DEFAULT_DAILY_LIMIT`）。`store.data.dailyFetch` に永続化・ローカル暦日でリセット・超過は翌日へ
- **重複排除**: 同一投稿は postId 単位で 1 リクエストに集約（多ページ投稿で枠を節約）
- **大量時の確認**: X が 200 件超なら取得前に確認ダイアログ
- **tombstone**: 利用不可ツイートは `__typename: "TweetTombstone"` → `deleted` 扱い（synced+null にしない）

## 失敗時の挙動（graceful）

X が壊れても**クラッシュしない**。各取得は独立で、失敗した項目は `error` 印を付けてスキップし続行する。Bluesky / pixiv / Eagle 連携は X の状態に影響されず動き続ける。

## まとめ

「壊れたら困る中核」（Eagle 連携・Bluesky）は**公式・安定**。pixiv は非公式だが破綻リスク低。**X だけは将来壊れる可能性がある前提**で運用する（割り切り枠）。
