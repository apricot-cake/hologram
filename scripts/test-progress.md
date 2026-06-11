# テスト進捗

## A-1. X (Twitter)

| # | 状態 | 結果メモ |
|---|------|---------|
| A-1a | OK | TL。likes:0, replies:1, views:81, lang:ja。全フィールド正常 |
| A-1b | - | https://x.com/satera723/status/2032743545937834490 |
| A-1c | - | |
| A-1d | - | |
| A-1e | - | |
| A-1f | - | |
| A-1g | - | |
| A-1h | OK | A-1bと同一投稿で確認済み（isThread:true） |
| A-1i | - | |
| A-1j | - | |
| A-1k | - | |
| A-1l | - | |
| A-1m | - | |
| A-1n | - | ★修正検証（ライトボックスドラッグ） |
| A-1o | - | ★修正検証（アバター/バナードラッグ） |

## A-2. Bluesky

| # | 状態 | 結果メモ |
|---|------|---------|
| A-2a | - | |
| A-2b | OK | bsky.app/.../post/3mmwmla3xph26。個別ページ postThreadItem 検出。displayName/DID/text/date/likes3016・reposts523・replies523 全API一致、画像1枚を原寸webp保存。verify-store PASS（ストア版dev除去後の回帰確認も兼ねる） |
| A-2c | - | |
| A-2d | - | |
| A-2e | OK | E2E自動。リプライ詳細でリプライ本人を保存（親に化けない）。URL一致 |
| A-2f | OK | ★E2E自動。引用ポスト詳細クリックで**引用した側**を保存（引用元に化けない）。URL一致 |
| A-2g | OK | E2E自動。複数画像（3枚）、media3枚原寸保存、API一致 |
| A-2h | - | |
| A-2i | OK | E2E自動。ドラッグ保存、url canonical、API一致 |
| A-2j | - | |
| A-2k | OK | ★E2E自動（負例）。プロフィールのアバターをドラッグ→ドロップゾーン非表示・保存なし（捏造防止） |

## A-3. Misskey

| # | 状態 | 結果メモ |
|---|------|---------|
| A-3a | - | |
| A-3b | OK | E2E自動。詳細ページの主ノートをID一致で特定→クリック、media1枚、API一致 |
| A-3c | - | |
| A-3d | - | |
| A-3e | OK | ★E2E自動。リプライ詳細でリプライ本人を保存（親ノートに化けない）。URL一致 |
| A-3f | - | |
| A-3g | - | |
| A-3h | - | |

## A-4. Mastodon

| # | 状態 | 結果メモ |
|---|------|---------|
| A-4a | - | |
| A-4b | OK | E2E自動。detailed-status クリック、media2枚保存、API一致（likes/reposts/replies） |
| A-4c | - | |
| A-4d | - | |
| A-4e | OK | ★E2E自動。リプライ詳細でリプライ本人を保存。URL一致 |
| A-4f | - | ★修正検証（4.4引用・要手動: 公開TLで引用投稿を発見） |
| A-4g | - | |
| A-4h | - | |

## A-5. pixiv

| # | 状態 | 結果メモ |
|---|------|---------|
| A-5a | OK | E2E自動（e2e-capture-test.js）。単ページ作品、media1枚原寸保存、API照合PASS |
| A-5b | OK | E2E自動。複数ページ作品（pages API）、media2枚保存、API照合PASS。★修正検証OK |
| A-5c | - | |
| A-5d | OK | E2E自動。ドラッグ保存、imageIndex=1/2、API照合PASS |
| A-5e | - | ★修正検証（フォールバックcrop） |

> 正常系（A-2b/g/i・A-3b・A-4b・A-5a/b/d）と★回帰（A-2e/f/k・A-3e・A-4e）は
> `node scripts/e2e-capture-test.js` で全自動検証（実Chrome＋拡張＋ブリッジ→
> **URL一致**＋API照合→後始末）。2026-06-11 拡張v1.1.0＋ランチャ修正後に
> 全PF（X以外）ALL PASS。★回帰＝引用クリックで引用した側・リプライで本人・
> アバタードラッグは保存しない（監査の誤帰属修正の回帰防止）。
> X は要ログインのためデフォルト除外（`node scripts/e2e-capture-test.js x`
> ＝認証済みプロファイルが必要）。引数でPF絞り込み可。
