---
name: verify-with-cdp
description: Hologram を CDP（Chrome DevTools Protocol）で計測・撮影・駆動して確かめる時の作法と罠。スクショが固着・白紙・ハングする、Base UI 部品がマウス合成で動かない、IPC を直叩きして検証データを仕込む、拡張が実機で生きているか診断する、といった場面で読む。どのインスタンスで検証するかは skill run-hologram、起動と反映は docs/build.md が正本。
---

# verify-with-cdp — CDP で確かめる時の作法

前提は2つとも別の場所が正本。**変更が反映される状態か**（`build:islands` 等）と**どのインスタンスを使うか**（隔離3段構え）は skill `run-hologram` と `docs/build.md`「検証ルール（隔離3段構え）」。ここはその上で踏む罠だけを持つ。

## 駆動する

- **⛔ 合成マウスで Base UI 部品を触らない**（実害 2026-07-18）。Base UI の Select / Popover トリガー / Slider は floating-ui の pointer 経路で動くため、`Input.dispatchMouseEvent` は発火しないだけでなく**それ自体がハングし、ポインタキャプチャが残ってレンダラごと固まる**（CDP 完全無応答＝curl が `http_code=000`／復帰は `restart-app.ps1`）。
  - 代わりに**キーボード**（トリガーへ focus → Enter で開く／スライダーは thumb へ focus → Arrow）か、プレーンな `<button>` なら evaluate 内 `el.click()`（React の onClick は発火する）。値の読み取りは `evaluate` のみ。
  - ポップオーバーをキーボードで開くのは**再起動直後だけフレークする**ので数回リトライ。
- **駆動は1フロー1起動**。多数のフローを1スクリプトに詰めると相互に絡んで解析不能になり、自分の駆動残留を「ユーザーが触った」と誤診する（docs/build.md「実機で異常を見たら、まず自分の駆動の残留を疑う」）。
- **ユーザーデータをトグルする検証をしない**（実害 2026-07-13）。仮想グリッドの DOM 順は click 間で不定＝`querySelector('.clip-btn')` が別カードに当たり往復が成立しない。さらに掃除のつもりで `.in` を外して回ると**実ライブラリのクリップまで巻き込む**。ミューテーションが要る検証は `HOLOGRAM_CONFIG_DIR=<tmp>` のサンドボックスで行うか、表示だけで確かめられる経路を選ぶ。
- **起動中のアプリの JSON を外から書き換えない**。アプリの次回書き込みで消える＝停止 → 書き戻し → 再起動の順で。

### 仮想グリッドを駆動して計測する時

- **プログラム的な大ジャンプ（`sc.scrollTop=N` や `scrollBy(0,20000)`）は仮想グリッドの描画窓を実 scrollTop からずらす**＝カードが1枚も可視でない状態になり、以後の計測が全部無意味になる（`elementFromPoint` が null・`.post-card` が画面外）。**小刻みな `scrollBy` は追従する。これはアプリのバグではない**＝クリーン再起動すると正常。
- 座標は**スクローラ基準**で取る。`#postGrid` の rect はスクロールすると負になり、`grid.top+300` のような指定は画面外を指す。
- カーソル位置の probe は**実カードの中心**を使う（ビューポート中心は高確率でタイル間の隙間に当たる）。
- グリッドセルは `.card` クラスを持たない＝件数は `#postGridReact` の子孫要素数で見る。モーダル等の React 再描画待ちは 300ms 超。
- **「エラー0」の確認**は `Runtime.exceptionThrown`・`consoleAPICalled`・`Log.entryAdded` を ws で購読しながら reload する（購読前に出たエラーは取れない）。

## 撮る

- **`clip` 罠**: `Page.captureScreenshot` に `clip` を渡すと可視ビューポートがその寸法に縮んで固着する（`clearDeviceMetricsOverride` でも戻らない）。**clip を使わずフル撮影して Python PIL でクロップ・縮小**（`im.crop(...).resize(...)`、quality 70 前後で Read できるサイズに）。固着したらアプリ再起動で復帰。
- **`captureBeyondViewport:true` は使わない**（数千カードの全文書を撮る）。
- **背面撮影が既定**（`cdp-verify.cts shot`）＝`fromSurface:true` ＋ `bringToFront` しない。**ユーザーのアクティブウィンドウを奪わないため**。`CDP_FOCUS=1` で旧経路（OS 復元＋前面化）を強制できる。
- **`fromSurface:true` は完全に隠蔽・throttle された窓で永久ハングし、GPU ごとアプリを落とす**（実害 2026-07-05）。撮影は **1.5s のタイムアウトでレース**し、来なければフォールバックへ——この安全弁が `cdp-verify.cts` に入っている前提で運用する。
- **最小化ウィンドウ**は OS サーフェスを持たず `-32000 Unable to capture screenshot`（`screenX/Y` が -32000・`visibilityState` は "visible" のままで紛らわしい）。`cdp-verify.cts shot` が検知 → OS 復元（user32 `ShowWindowAsync` の `SW_RESTORE`。**この Electron ビルドは CDP `Browser.*` 非対応**＝`-32601` で復元できない）→ 撮影 → 再最小化まで自動でやる。**ユーザーは普段アプリを最小化して使う**＝最小化は起動バグではない。
- **白フレーム（ペイント停止）** が返ったら、確認を取らずにアプリを再起動して描画を復帰させる（手順は docs/build.md）。
- **採寸は最小化でも有効**（`getBoundingClientRect`・`innerWidth/Height` は実寸）＝スクショ無しで判定できることは多い。画像トークンは重いので、computed style やコントラスト比で足りるなら撮らない。
- 計測・撮影用の使い捨て `scripts/cdp-*.cts` は調査後に削除する（リポに残さない）。
- **ユーザーが「リモート」と宣言したセッションだけ**、スクショは `Read` ツールで開く（ツール結果の画像がトランスクリプトに埋まってスマホで見える。`SendUserFile` は見えなかった）。宣言が無ければ既定＝PC 前とみなし、どちらでもよい。

## 測る

- **`Emulation.*` はデバッガ接続ごとの状態**＝毎回 connect/close する使い捨てコマンドでは次のコマンド時点で消えている。エミュレート → 検証 → 撮影は**1本の WebSocket セッション内で完結**させる（雛形は scratchpad へ書き捨てでよい。`ws` はリポジトリ root の node_modules から require できる）。
- **エミュレート直後の `getComputedStyle` は旧値を返すことがある**（filter は新・background は旧、のような部分的旧値も出る＝「CSS が片方だけ効かない」に見える）。`requestAnimationFrame` を2回待ってから読む。CSSOM にルールが在るのに計算値が合わない時は、まずこの再計算レースを疑う。
- **SMOKE の eval**（`node scripts/test-app-*.cts`）は `EVAL_RESULT {json}` を返す。遅延 DOM は `waitFor(()=>cond,ms)` でポーリングしてから読む。**1回ハングしたら即見切る**（再実行かインスタンスを変える）＝ハーネスのデバッグに深入りしない。
- **DOM イベント合成は click だけでなく DragEvent も SMOKE で動く**＝ロジックや DOM 構造の動的検証は SMOKE で足りる。隠しウィンドウで再現しないのは CSS transition と inline 配置（transform/left）の**見た目**だけ。

### IPC を直叩きして検証データを仕込む

`window.hologram.set*` を CDP eval から呼べば検証データを素早く置けるが、**preload の引数規約がメソッドごとに非対称**で、間違えると壊す。叩く前に `app/preload.cts`（`HologramPreload`）でシグネチャを確認する（preload のメソッド名は camelCase で IPC チャンネル名と違う＝`app-info`→`getAppInfo`）。

- `setTagTypes(types, labels)` = **素の types オブジェクト**。`{types:{...}}` でラップすると main が `{types: 受け取った引数}` として保存して**二重ネスト**になり、`tagKindOf` が全タグ null＝種別ドット消失として表面化する（実装バグに見えるが呼び出しミス。本物データは内側に温存＝可逆）。
- `setPosterTags(data)` = `{tags:{...}}` **ラップが正しい**（main が `data.tags` を取り出す）。
- 鉄則: ①set 前にディスクのファイルをバックアップ ②set 後に get で読み返して shape と件数を確認 ③検証後はダミーを除去して再 get で 0 件＋ディスク diff が IDENTICAL であることを確認。ダミーには識別プレフィックス（例 `__vt_`）を付ける。
- renderer の関数スコープ変数（`posterTags`/`tagTypes`）は set 後に `location.reload()` しないと反映されない（起動時ロードでしか読まれない）。
- **Node が読む JSON を PowerShell で書かない**（実害 2026-06-13）。`Set-Content`/`Out-File -Encoding utf8` は Windows PowerShell 5.1 で UTF-8 BOM を付け、`JSON.parse` が throw → `~/.hologram/config.json` なら次回起動で**デフォルト上書き**され `extensionId` まで消える。Node の `fs.writeFileSync(p, JSON.stringify(x,null,2),'utf8')` か、CDP 越しの `window.hologram.setPref` を使う。

## 拡張を診断する

- **実機の Chrome が読んでいるのは本体ツリーの `extension/.output/chrome-mv3`**＝dev ビルドと production ビルドが同じフォルダに書かれる（`outDirTemplate`＝docs/build.md）。挙動を検証する前に**今どちらのビルドが載っているか**を確認する＝`dev:ext` の常駐の有無と対象バンドルのビルド時刻（確認を怠って1時間、旧バンドルの挙動を「修正後のコード」として推測し外した・2026-07-26）。
- dev と prod は manifest の `key` が同じ＝**拡張 ID が同一**で、resident.js も両方が自己完結バンドル＝**ページ側からどちらが載っているかは判別できない**。判別できるのは `chrome://extensions` のロード元だけ。
- **拡張側のグローバルは isolated world**＝ページの JS コンソール（`javascript_tool`／DevTools）からは常に `undefined`/`false` に見える。`false` を「拡張が動いていない」根拠にしない。正しい観測点は**共有 DOM の副作用**＝合成 `dragstart` で `#__hologramDropZone`（`z-index:2147483647` の body 直下 div）が出れば注入は生きている。
- **アイコン無反応の一次診断は `~/.hologram/capture.log`**: click 行なし＝クリックが SW に届いていない（別ウィンドウ/別アイコンの疑い）／`phase:"skip"`＝非 http タブ／`phase:"fail"`＝executeScript のエラー内容つき。
- **全自動テストは `scripts/e2e-capture-test.cts`**（使い捨て Chrome＋SW evaluate で activateOnTab 相当 → バナー → 保存 → API 照合 → 掃除）。⚠️SW 注入の files リストは `background.ts` と**手動同期**＝本体の注入リストを変えたら e2e も直す。
- 拡張 ID は manifest `key` から決定的に計算できる: `SHA256(base64decode(key))` の先頭16バイトを a〜p の16進アルファベットへ。
- **`chrome-extension://`（拡張自身のページ）へは `location.href` 代入で遷移できる**（MCP の navigate は URL 頭に https:// を強制付与するため）。ただし他拡張のページは触れない。**⛔ この回避策は `chrome://` に効かない**＝別スキーム。`chrome://extensions` でのリロード・有効/無効・エラー確認は自分でやらずユーザーに依頼する。
- **ネイティブホストの登録を変えたら Chrome を完全再起動**（実害 2026-06-14）。起動中の Chrome は登録をプロセス起動時に確定し再読込しない＝レジストリ・manifest・allowed_origins が**全部正しくても** "Specified native messaging host not found." が出る（拡張の remove+readd でも直らない）。切り分けの鍵は **Chrome の起動時刻 vs manifest の更新時刻**。コールドな E2E は通るのにウォームな実 Chrome だけ失敗、がこのシグネチャ。

### 実 Chrome でページを見る時

奪ってはいけないのはフォーカスだけで、実 Chrome での検証自体は歓迎（グローバル CLAUDE.md「Chrome のフォーカスを奪わない」）。背面タブのまま CDP で読む／JS を走らせるのを既定にする。ヘッドレス（`scripts/e2e-capture-test.cts`）で足りるならそちら。

- **スクロール検証は `document.visibilityState` を先に読む**（2026-07-26）。**背面タブでは X の仮想リストがそもそも動かない**（hidden のまま `window.scrollBy` で 5824px 進めても投稿件数もページ高も不変）。可視タブなら合成スクロール（`scrollIntoView`＋`scrollBy`）でもメディア画像は読み込まれた。「合成スクロールだから読まれない」と結論する前に「背面だから何も動いていない」を潰す。
- **X で `performance.getEntriesByType('resource')` を件数の根拠にしない**（実地被弾 2026-07-26）。X 自身が `clearResourceTimings()` を定期的に呼ぶのでバッファは直近の消去以降しか残らない。**画像が読めたかの判定は `img.complete && img.naturalWidth>0`**。
- 合成 Alt+S は CDP Input ゆえ `chrome.commands` を発火しない。代わりに常駐 content_script の drag 経路を使う＝投稿画像に `dragstart` を合成 → `#__hologramDropZone` へ `dragover`/`drop`。page main world からの dispatch でも isolated world のリスナに届き `saveDragged`→`connectNative` が走る。到達確認は overlay の `textContent` と bridge.log の `launched` 行。
- `javascript_tool` の返り値に URL やクエリ文字列が混じると `[BLOCKED: Cookie/query string data]` で落ちる＝boolean かサニタイズ（`replace(/https?:\/\/\S+/g,'<url>')`）して返す。
