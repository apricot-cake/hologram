// Native Messaging ブリッジ（Chrome が起動する素の Node）と Electron デスクトップ
// アプリの両方が使う、共有の設定ディレクトリを解決する。
//
// ブリッジは Electron に userData の位置を問い合わせられない。だから両側が独立に、
// 必ず同じ絶対パスを解決しなければならない。Electron アプリは起動時に
// app.setPath('userData', configDir()) を呼んでここに固定する。つまりこのディレクトリ
// には自前のファイルだけでなく、Chromium 自身が userData に置くもの（Cache、
// Local Storage、Preferences、…）も入る。
//
// 優先順: HOLOGRAM_CONFIG_DIR（明示指定）が勝ち、無ければ Windows の既定である
// %APPDATA%\Hologram（Roaming AppData＝Electron 自身の既定）を使う。
//
// Windows はかつて MSIX のストレージ仮想化を避けるため ~/.hologram（ホーム直下の
// ドットファイル）を既定にしていた。MSIX パッケージ化されたデスクトップアプリの
// ホストの中から起動されると、
// 子プロセスの %APPDATA%/HKCU への書き込みがパッケージ専用の LocalCache へ黙って
// 逸らされ、ユーザーの実物のアプリや Chrome が見ているものとずれた（2026-06 の保存
// フォルダのずれ、約9082件）。この環境ではもうその仮想化は起きていない（2026-08-06、
// #1003）＝パッケージ化されたホストがパッケージの外に移り、FS と HKCU の読み書きが
// 実物だと実測できた。そこで回避策は #232 で取り下げ、Windows の OS 標準の位置を使う。
// ホストの構成が元に戻ったときは、#1009 の
// 起動時の防ぎ（app/src/main/lib-storage-redirect-guard.ts）が LocalCache に逸らされた
// configDir() や保存フォルダを検出し、また黙ってずれる代わりに起動を拒む。
//
// #232 は移行コードを意図して入れずに出した。リリース前なので、既存の設定ディレクトリは
// 作者自身のマシンにしかなく、一度だけ手で運用作業として移した（アプリが持ち続ける
// 設計ではない）。新しい位置が空のときに旧 ~/.hologram を読む退避を足してはいけない。
// 同じ形の以前の試み（migrateConfigDirFromAppData、891a6ba で削除）は、恒久的に何も
// しないまま居座ったうえに実害があった。設定前の起動が、置き去りにされた古い設定を
// 拾いかねなかった。
//
// HOLOGRAM_CONFIG_DIR 自体は今や別の理由で残っている。仮想化避けではなく、テストの
// 隔離（テストやサンドボックスの実行ごとに自前の mkdtemp ディレクトリを指す）。
//
// ライブラリの既定は別の話で、動かさない。#232 を参照＝その理由づけはこの話ではなく
// 既にプロダクトとしての判断になっている。

import path from 'node:path';
import os from 'node:os';

export const APP_NAME = 'Hologram';

export function configDir(): string {
  if (process.env.HOLOGRAM_CONFIG_DIR) return process.env.HOLOGRAM_CONFIG_DIR;
  if (process.platform === 'win32') {
    // homedir() + 'AppData/Roaming' を繋ぐのではなく環境変数から読む。フォルダ
    // リダイレクトや移動プロファイルは %APPDATA% をその既定の相対パスから動かすので、
    // 繋いで作ったパスは黙って外す。
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}

// ライブラリ（キャプチャ）の既定フォルダ＝どの OS でも ~/Hologram/library。ユーザーが
// 保存フォルダを明示的に選ぶまで、ブリッジとアプリの両方がこれを使う。configDir() とは
// 必ず分ける。ライブラリは元のメディアを蓄積して大きくなりうるので、
// 小さな設定ディレクトリに混ぜず、自前のトップレベルのフォルダに置く。
//
// OS ごとの app-data 領域ではなくホームディレクトリを選ぶのは、回避策ではなくプロダクト
// としての判断（#232）。保存されるファイルはユーザー自身の中身だから、ユーザーが開き、
// 動かし、バックアップする場所にあるべきだ。app-data は既定で隠されていて、逆のことを
// 言っている。収集アプリの定着した先例も同じ（Zotero はどの OS でも ~/Zotero を使う）。
// Documents や Pictures は意図して避けている。OneDrive 系のフォルダバックアップが狙うのが
// そこで、同期フォルダにライブラリを実時間で書き込むと壊れる（#95 は、ユーザーがそういう
// フォルダを選んだときにこれを警告する）。
//
// Windows はかつて MSIX のストレージ仮想化を避けるため別の場所を使っていたが、
// その理由は 2026-08-06 に失効した（#1003）。現在はこの利用者が直接扱える場所へ置く。
export function defaultLibraryDir(): string {
  return path.join(os.homedir(), APP_NAME, 'library');
}

// ローカルの拡張機能ビルドが自分を名乗る場所（#650）。置き場が揃った時点で
// `npm run build:ext` が書き、ブリッジが読む。こうしてどの応答にもトークンを載せられる
// ＝パッケージ化せず読み込んだ拡張機能は、これでディスク上の自分のバンドルが差し替わった
// と知り、自分を読み込み直す。
//
// ビルド出力の隣ではなく configDir() に置くのは、そこが2つのプロセスが教えられずとも
// 既に一致している唯一の絶対パスだから。ブリッジはレジストリの登録から Chrome に起動
// され、リポジトリの位置を知らない。拡張機能をビルドしていないマシンには存在せず、
// それがリリース版のインストールでこの経路まるごとを不活性にしている。
export function extensionBuildStampPath(): string {
  return path.join(configDir(), 'extension-build.json');
}

// #71: 拡張機能がインストールされていて、一度でもアプリと話したことがある、という
// アプリ側の唯一の手がかり。Native Messaging ホストは Chrome が接続ごとに起動する
// 使い捨てのプロセスで（bridge.mts の冒頭を参照）、「今つながっているか」を尋ねられる
// 生きた鼓動は無い。そこでブリッジは、確認（{type:'query'}）や保存を処理するたびに
// この印に触る。アプリはファイルが在ることだけを「一度でも接触があった」と扱う
// （empty/EmptyState.tsx の firstRun と、インストール案内の側の出し分け、#71）。中身は
// 素の ISO タイムスタンプで、それ以外は一切書き込まない。拡張機能の id もブラウザ名も
// URL も書かないのは、アプリが中身を読まず、存在だけを見るから。
export function extensionContactPath(): string {
  return path.join(configDir(), 'extension-contact.json');
}
