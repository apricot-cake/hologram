# 0022. レンダラは `app://` で配り、CSP は応答ヘッダで配る

- 状態: 採用（2026-08-02）
- 関連: [#7](https://github.com/apricot-cake/hologram/issues/7)・[#683](https://github.com/apricot-cake/hologram/issues/683) レンダラー CSP の仕上げ・[#640](https://github.com/apricot-cake/hologram/issues/640) サンドボックスの木の同定・[ADR 0012](0012-asset-documents-are-raster-only.md)

## 背景

製品版のレンダラは `loadFile()`＝`file://` の文書として読み込んでいた。これが引き寄せていた制約は2つある。

**ひとつ目は特権。** Electron 公式のセキュリティチェックリスト **18. Avoid usage of the `file://` protocol and prefer usage of custom protocols** は「Electron の `file://` はブラウザより多くの特権を持つ。ローカルのページは独自プロトコルで配れ」と明記している。特権の実体は fuse `grantFileProtocolExtraPrivileges`（既定 **有効**）が列挙する3つ＝①`file://` のページが他の `file://` を `fetch` できる ②Service Worker を使える ③sandbox 設定によらず `file://` の子フレームへ universal access を持つ。**Hologram の本番バンドルが `<script type="module">` で動いていたこと自体、この特権に乗っていた可能性が高い**（チェックリストは「`file://` には正しい MIME が無いので ES6 モジュールを拒む」と書いているのに、実機では動いていた）。⚠️ただし **「ESM の可否がこの fuse に含まれる」と明記した一次ソースは見つけられていない**＝ここは推測のまま残す。

**ふたつ目は配信路。** CSP は `index.html` の `<meta http-equiv>` に置いていたが、`frame-ancestors` は `<meta>` では**エラーにもならず黙って無視される**（CSP 仕様 / MDN）。ヘッダで配るしかないのに、Electron のチェックリストは「`file://` では HTTP ヘッダによる配信は不可能」と書いている（[electron/electron#23485](https://github.com/electron/electron/issues/23485) でも確認）。#683 はこれを「配信路が存在しない」と結論して見送り、本 Issue へ持ち越していた。

## 決定

**レンダラは `app://bundle/index.html` から配り、CSP はその応答のヘッダに載せる。**

- **スキームは `standard` + `secure` + `supportFetchAPI` の3つだけ**で登録する（Electron の `protocol` ドキュメントが載せている `app://bundle` の例そのまま）。`corsEnabled` は**付けない**＝レンダラと `asset://` は別オリジンで、CORS が無いことが「ライブラリのバイト列は IPC 経由でしか読めない」を成立させる（下記「ADR 0012 との関係」）
- **ハンドラは `fs.readFile` + `Response`**。ドキュメントの例は `net.fetch(pathToFileURL(...))` だが、その `file://` が asar の**中**を読めるかを一次ソースで確認できなかった。製品版のレンダラは `app.asar` の中にいるので、Electron が asar 透過にパッチしている `fs` を採る（実測で packaged ビルドから読めている）
- **ホストは `bundle` ひとつ、文書になれるのは `index.html` ひとつ。** 他のホストは 404、`will-navigate` はレンダラの入口以外を拒む＝**スキームを丸ごと通さない**。ADR 0012 が `asset:` で踏んだ「スキーム丸ごとの許可」を繰り返さないため
- **content-type は拡張子表で決め、知らない拡張子は配らない（415）。** ビルド成果物用の表を `asset://` のメディア用表とは**別に持つ**＝片方の都合でもう片方が緩むのを防ぐ。`nosniff` を全応答に付ける
- **CSP の文字列は main の1モジュール（`renderer-csp.ts`）が持ち、`<meta>` は削除する。** `frame-ancestors 'none'` をここで初めて足す。他のディレクティブは #683 の結論を据え置き（`style-src 'unsafe-inline'` は React の `style={{…}}` が要求する）
- **dev（`electron-vite dev` の http）にも同じ文字列を `onHeadersReceived` で載せる。** 空けると dev と prod で実効ポリシーが変わり、違反が prod でしか出なくなる
- **`grantFileProtocolExtraPrivileges` を `false` で焼く**（electron-builder の `electronFuses`）。**app:// で動くだけでは移行は終わっていない**＝`file://` の追加特権に依存しない状態になって初めて完了になる

### dev だけ script-src に nonce を足す

dev には1点だけ差がある。`@vitejs/plugin-react` は Fast Refresh の preamble を**インラインの module script**として注入するので、`script-src 'self'` のもとでは Chromium がそれを落とし、レンダラは何もマウントせずに `@vitejs/plugin-react can't detect preamble` で止まる（2026-08-02 実測＝違反は `script-src-elem` の1件だけで、他のディレクティブには1件も出ていない）。

対処は **Vite 自身が持っている `html.cspNonce`**＝これを設定すると Vite は自分が出すタグすべてに nonce を付ける。そのnonce を dev のポリシーで名指しすることで、**通るのは Vite のツール類だけ**になり、アプリが書いたインラインスクリプトは dev でも prod と同じように落ちる。`'unsafe-inline'` へ倒すとこの性質が消えるので採らなかった。nonce は固定文字列でよい＝dev マシンの外へ出ず、製品版のポリシーには nonce が1文字も入らない。

### ADR 0012 との関係（前提が崩れていないことの確認）

ADR 0012 は「`asset://img/*` はライブラリ全体でひとつのオリジン」「トップレベル文書になれるのはラスタ画像だけ」「応答自体に CSP」で成り立っている。レンダラのオリジンが opaque な `file://` から実体のある `app://bundle` に変わるため、3点を確認した。

- **レンダラから `asset://` は読めないまま。** 以前は「`file://` のページは `asset://` を fetch できない」に依存していたが、いまは**別オリジン**であること＋`asset://` に `corsEnabled` が無いこと＋レンダラの CSP の `connect-src` に `asset:` が無いことの3つで塞がっている。実測でも `fetch('asset://…')` は落ち、`<img>` の表示は通る。**`corsEnabled` の追加と `connect-src asset:` は今後も入れない**（入れた瞬間、レンダラが XSS を踏んだ時に IPC の許可リストを迂回できる）
- **入口の許可リストは広げていない。** `asset://` へのトップレベル遷移がラスタ画像限定なのは据え置き
- **`asset://` の応答 CSP は無改修。** あれが縛るのは「その応答から作られた文書」なので、レンダラ側のポリシーとは独立している

### #640（サンドボックスの木の同定）の作り直し

サンドボックス検証は「CDP の page target の URL がどの作業ツリーから起動されたかを名指しする」ことで、別ツリーのインスタンスを黙って操作する事故を防いでいた。`app://bundle/index.html` は**どのツリーでも同じ文字列**なので、この同定は移行と同時に全ケースで「判別不能」に落ちる＝#640 が塞いだ穴が、しかも静かに開き直る。

そこで**同定をポートを listen しているプロセスの pid へ移した**（`.sandbox/instance.json` が記録した pid と突き合わせる）。URL に依存せず、リロードでも壊れず、`electron-vite dev` のインスタンス（http の URL に木の名前が無い）にも効く。「判別不能を『問題なし』と読ませない」という #640 の約束はそのまま残している。

## 影響

- **レンダラのオリジンが変わるので、`localStorage` のキャッシュは初回だけ空になる**（サイドバー幅・パネル開閉・プライバシーモード・画像アスペクト比）。いずれも耐久値は `config.json` 側（IPC）にあり、アスペクト比は再学習で埋まるため移行コードは書いていない
- **`registerSchemesAsPrivileged` は ready より前・1回だけ**という Electron の制約があるので、**新しいスキームは `index.ts` の同じ配列に足す**しかない（2度目の呼び出しを書かない）
- **`npm run check` ではこの領域を何も確かめられない。** fuse はパッケージ済みバイナリにしか効かず、CSP の実効も module script の MIME 判定も Chromium が要る＝`scripts/test-app-renderer-origin.cts`（実 Electron）と、パッケージしてからの実起動が検証の本体になる
- **ESM とコード分割の制約が外れた。** ただし本 Issue では使っていない（バンドルの形は変えていない）

## 却下した案

- **`file://` のまま `<meta>` で CSP を配り続ける** — `frame-ancestors` が原理的に配れない。加えて、いま preamble が dev で通っていたのは「注入されたスクリプトが `<meta>` より前にある」という**位置に依存した偶然**で、守れているつもりで守れていない状態だった
- **`net.fetch(pathToFileURL(...))` で返す**（ドキュメントの例のまま） — asar の中を読めるかを一次ソースで確認できず、製品版のレンダラは asar の中にいる。読めなければ製品版だけが白紙になる種類の失敗なので、確実な方を採った
- **`app://` に `corsEnabled` を足してレンダラから `asset://` を直接 fetch する** — うごイラの再生（#506）などが素直に書けるようになるが、ADR 0012 の前提を自分から壊す。ライブラリのバイト列に触れる経路は IPC の許可リスト1本に保つ
- **dev の script-src を `'unsafe-inline'` にする** — 症状は同じように消えるが、「アプリが書いたインラインスクリプトは dev でも落ちる」という性質まで一緒に捨てることになる。nonce ならツールだけを通せる
- **dev だけ `<meta>` へ落とす**（#7 の設計が用意していた退避案） — 上の nonce で本案のまま通ったので使っていない。ポリシーを2箇所に持つのは最後の手段
