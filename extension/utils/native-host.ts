// このビルドがどの native messaging host と話すか（#732）。
//
// native messaging は拡張機能の id ではなく host の名前でルーティングす
// る: Chrome はユーザーごとの登録からその名前を引き、その host のマニ
// フェストを読み、その後で初めてマニフェストの allowed_origins を、尋ね
// てきた拡張機能と照合する。だから同じ拡張機能の2つのビルド（同じ固定
// キー、同じ id、同じ chrome.storage、同じキーボードショートカット）で
// も、違う名前を尋ねるだけで2つの別々の host、2つの別々の設定ディレクト
// リ、2つの別々のライブラリに届く。
//
// これが、開発中に行ったキャプチャを本物のライブラリから遠ざけている仕組
// みだ。開発用の host は別途登録され
// （scripts/register-dev-native-host.cts）、そのランチャーは
// HOLOGRAM_CONFIG_DIR を ~/.hologram-dev に固定するので、それが起動する
// ブリッジは間違ってすら本物を見ることができない。
//
// 環境ではなくコマンドによって決まる。この値は extension/wxt.config.ts が
// Vite 自身の `command`（serve = 開発、build = リリース）から設定する
// `define` を通して届く。`import.meta.env.DEV` は一見これを書く自然な方
// 法に見えるが罠だ＝これは NODE_ENV に従うため、テストランナーから作られ
// るリリースビルド（vitest のグローバルセットアップが拡張機能をビルドす
// る）が開発用の host を要求する形で出来上がってしまう。これは仮定の話で
// はなく、実際にこれを書いている最中に起きたことで、
// scripts/build-extension.cts のリリースチェックがそれを捕まえた。この
// チェックは残す＝リリースバンドルは開発用の名前を一切含んではならず、こ
// れは拡張機能の E2E ハーネスも守っている。ハーネスの隔離は、ビルド済み
// バンドル内のリリース用 host 名を書き換えることで動いているからだ。
//
// 素の参照ではなく `typeof` を使うのは、未宣言の識別子への参照は
// ReferenceError になるが `typeof` なら合法だからだ＝このモジュールを直
// 接 import する Vitest のスイートがまさにその状況で、そこではリリース名
// が正しい答えになる。
declare const __HOLOGRAM_NATIVE_HOST__: string | undefined;

export const RELEASE_NATIVE_HOST = 'com.hologram.host';
export const DEV_NATIVE_HOST = 'com.hologram.host.dev';

export const NATIVE_HOST: string = typeof __HOLOGRAM_NATIVE_HOST__ === 'undefined' || !__HOLOGRAM_NATIVE_HOST__ ? RELEASE_NATIVE_HOST : __HOLOGRAM_NATIVE_HOST__;
