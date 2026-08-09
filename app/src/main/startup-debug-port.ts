'use strict';

// #1004: このプロセスが --remote-debugging-port 無しで起動されたことを警告
// すべきかどうか。それを付けるのは restart-app.ps1 だけで、このアプリの
// ディレクトリで electron.exe を起動する他の何か（古い引数を持った
// スタートメニューのショートカットが実際の真犯人だった、#1004）は黙ってそれを
// 省く: エラーは出ず、ただ scripts/cdp-verify.cts がアタッチできないインスタンス
// になるだけ。ここで警告しておけば、少なくとも main.log に残り、後で探す人の
// 助けになる。
//
// 2026-08-07 に守備範囲が縮んだ: このフラグは以前、restart-app.ps1 の停止側が
// 本物のインスタンスを見分ける印を兼ねていたので、無いとアプリを止められない
// ことも意味していた。停止は今は単一インスタンスロック（restart-signal.ts）
// 経由で、このフラグを一切読まない——残っているのは CDP の話だけ。

// 純粋関数（dev-server-guard.ts の resolveDevServerUrl にならい、argv/isPackaged
// を引数で渡す）にすることで、実際にパッケージ済みビルドを起動しなくても
// packaged/dev の分岐を回帰テストできる。
//   argv       — process.argv（未検証）
//   isPackaged — app.isPackaged。パッケージ済みビルドはこのフラグを持たず、
//                警告は不要
function shouldWarnMissingDebugPort(argv: string[], isPackaged: boolean): boolean {
  if (isPackaged) return false;
  return !argv.some((arg) => arg.startsWith('--remote-debugging-port'));
}

export { shouldWarnMissingDebugPort };
