# 0024. webp/avif のサムネイルはレンダラ委譲デコードで作る（wasm-vips・OS シェル委譲は不採用）

- 状態: 採用（2026-08-03、設計自体は Issue #8 の 2026-07-11 コメントで確定）
- 関連: #8

## 背景

サムネイル生成（`lib-thumbnails.ts`の`getThumbnail`）は Electron の`nativeImage`でデコードしていたが、`nativeImage`が公式に対応するのは PNG/JPEG（+ Windows の ICO）のみで、webp/avif はデコード失敗＝空画像になる。`getThumbnail`が`buf===null`を返すと呼び出し側は原寸ファイルへフォールバックしていたため、webp/avif は「サムネイルされない＝タイル/スタック表示でも原寸を読み込む」という重さを抱えていた。

付随して、寸法スニッフィング（`lib-imgsize.ts`）と保存時の画像拡張子セット（`lib-card-dims.ts`の`IMG_EXT`）は avif を除外しており、avif の`shotW`/`shotH`は常に 0/0 だった（masonry の高さ予約が効かない）。また animated webp が原寸表示になっているのは設計判断ではなく「デコードできなかった副作用」で、GIF が受けている明示的な carve-out（カード/リストは原寸で再生・タイル/スタックは静止サムネ）とは扱いが揃っていなかった。

## 決定

**非表示の作業用 BrowserWindow で Chromium 自身に webp/avif をデコードさせ、フラット化した JPEG を返してキャッシュする**（レンダラ委譲デコード）。

- 対象は webp/avif のみ。PNG/JPEG/GIF/SVG の既存経路（`nativeImage`）は無改修。
- 実装は`lib-thumbnails.ts`の`getDelegatedThumbnail`。ウィンドウは`show:false`／`sandbox:true`／`nodeIntegration:false`で遅延生成し、`webContents.executeJavaScript()`が「main → 決まったコード実行 → `createImageBitmap`→`OffscreenCanvas`→ 短辺基準リサイズ →`convertToBlob('image/jpeg')`→`FileReader.readAsDataURL`→ 戻り値」を1回の呼び出しで往復させる。preload/contextBridge は使わない — ページ側スクリプトへ何も公開しないため、main が注入するコードだけが実行される。
- ウィンドウは使い回し、30秒アイドルで`destroy()`する（GPU/メモリの回収。#66 の別件のアイドル計測とは区別する）。同時デコードのレースで二重生成しないよう、生成中の Promise を共有する。
- サムネイルキャッシュキーの世代を`q3`→`q4`へ上げる。webp/avif は旧コードでも「デコード失敗＝ゼロバイトの否定キャッシュ」を`q3`のまま書いていたため、世代を上げないと新しいデコーダが答えを出せるようになった後も否定キャッシュを引き当て続ける。
- avif の寸法スニッフィング（`lib-imgsize.ts`の`avifSize`、ISOBMFF の`ftyp`→`meta`→`iprp`→`ipco`→`ispe`を辿るボックスウォーク）と、`IMG_EXT`への avif 追加（`lib-card-dims.ts`）。svg は座標系が別問題のため対象外のまま（v1 スコープ外、既存のまま変更なし）。
- animated webp の carve-out。VP8X コンテナの Animation フラグ（flags バイトの bit1）を`webpIsAnimated`で読み、保存時に`shotAnimated`（新しい posts 列、`shotW`/`shotH`と同じ一回限りの計測規約）へ記録する。レンダラ側`records.ts`の imgW carve-out（GIF の原寸維持ロジック）へ`p.shotAnimated`を合成条件として追加し、animated webp だけが GIF と同じ「原寸維持・タイル/スタックのみサムネ化」を受ける。静止 webp は素通しでサムネイル化される（本Issueの主眼）。

## 影響

- `getThumbnail`の分岐は「webp/avif → 委譲デコード／それ以外の THUMB_EXT →`nativeImage`／それ以外 → OS シェルサムネ（#236）」の3方向になった。
- posts テーブルに`shotAnimated INTEGER`列が増える（`add-post-shot-animated`マイグレーション）。`PostRecordShape.shotAnimated: boolean | null`、DB 層は`toDbBool`/`fromDbBool`で変換 — `isReply`等の三値 boolean 列と同じ規約。
- 追加の実行時依存はゼロ（新規 npm パッケージなし）。Chromium 自身がデコーダなので、OS のコーデックインストール状況（avif は未導入が普通）に依存しない。

## 却下した案

- **OS シェル委譲（`nativeImage.createThumbnailFromPath`）** — Windows/macOS のみで、かつ端末にインストール済みのコーデック（webp=WebP Image Extensions、avif=AV1 Video Extension）に依存する。avif 拡張は未導入が普通で、Linux は非対応。
- **wasm-vips** — レンダラ委譲で要件を満たせるため、追加の wasm 依存を入れる理由がない。
- **PNG/JPEG も同時にレンダラ委譲へ移す** — v1 対象外。webp/avif で実戦投入して安定を見てから、既存経路のリスクを分けて検討する二段構え。
