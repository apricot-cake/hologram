// Chrome がブリッジを起動できるように、Hologram の Native Messaging ホストを
// 登録する（または登録を消す）。
//
// 使い方は2通り:
//   - 開発時の CLI: node native-host/install.mts  [uninstall]
//                   （ランチャーはこの Node のバイナリでブリッジを走らせる）
//   - Electron アプリ:
//                   require('.../native-host/install.mts').install({ exe, runAsNode:true })
//                   （ランチャーは Electron のバイナリを ELECTRON_RUN_AS_NODE モードに
//                    してブリッジを走らせるので、システムの Node は要らない）
//
// このモジュールは ESM で、CommonJS にバンドルされた Electron のメインプロセスから
// 生のソースのまま読み込まれる＝.mts ファイルの同期的な require() であり、Node は
// require(esm) 以降これに対応している（読み込む途中で型を剥がす）。そのため、このモジュール
// はトップレベル await を一切持たない。require(esm) はそれを持つモジュールを拒むし、
// アプリの登録は起動時に同期的に走る。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { configDir } from './paths.mts';

// 登録するホストの名前。configDir()（paths.mts）とまったく同じ理由で環境変数に従う。
// 開発用の登録（#732）は、この同じインストーラを別の名前と別の設定ディレクトリに向けた
// ものだ。マニフェストのパス、レジストリのキー、allowed_origins は必ず一緒に動かさなけれ
// ばならない。さもないと2つが黙って半分だけ登録された状態になる。Native Messaging は
// この名前で経路を決めるので、開発中に取ったキャプチャを本物のライブラリの外に留めるのは、
// 2つ目の拡張機能の id ではなくこの名前だ。
export const DEFAULT_HOST_NAME = 'com.hologram.host';
export const HOST_NAME = process.env.HOLOGRAM_NATIVE_HOST_NAME || DEFAULT_HOST_NAME;
// ソースではなくバンドル（bridge.mts とそのローカルのモジュールを1ファイルにしたもの）
// ＝app/build-native-host-bridge.mjs が作る。deployBridge() を参照。
export const BRIDGE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist', 'bridge.js');
const DEPLOYED_BRIDGE = 'bridge.js';

// ブリッジを（ASCII の）設定ディレクトリへ複写し、そこから走らせる。リポジトリが
// 非 ASCII のパスの下に在ることがある（たとえば日本語のフォルダ）。cmd.exe は .bat を
// コンソールの OEM コードページで読み、非 ASCII のパスを壊してしまうので、ランチャーは
// 必ず ASCII だけの場所を参照しなければならない。
//
// 配置するのはバンドルだ。実行時のモジュール解決が1つも残っていない1ファイル。生の
// ソースを配置していた頃は、bridge.mts が require() するモジュールをここに列挙する必要が
// あった。上流で足されたのにその並びから漏れたモジュールがあると、起動したホストが起動時
// に落ち（「Error when communicating with the native messaging host」）、それ以上の手がかり
// は無かった。1ファイルならずれる並びが無いし、ホストが npm の依存を使えるようにもなる
// （node の組み込みモジュールの外は、手で複写できなかった）。ホストのソースを編集したら、
// ビルドをやり直してから install すること。
function deployBridge(): string {
  if (!fs.existsSync(BRIDGE_PATH)) {
    // はっきり言って、次に何をすればよいかも言う。バンドルが無いことは、そうしないと
    // ずっと後になって、このバンドル化が退けようとした当の、Chrome 側の何も分からない
    // エラーとして表に出る。
    throw new Error(`native-host bundle not built: ${BRIDGE_PATH}\nRun "npm run build:native-host-bridge" in app/ first.`);
  }
  fs.mkdirSync(configDir(), { recursive: true });
  const destBridge = path.join(configDir(), DEPLOYED_BRIDGE);
  fs.copyFileSync(BRIDGE_PATH, destBridge);
  return destBridge;
}

// Chrome の拡張機能の id は a–p のちょうど32文字。マニフェストの allowed_origins へ
// 流れ込むものは、すべてこのゲートを通る（IPC の引数、CLI の引数、設定の値）。正しくない
// id は null に落ち、それは writeManifest と updateAllowedOrigin が既に扱っている
// （オリジンを保つか消すかであって、壊れたオリジンを出すことは決してない）。
const VALID_EXT_ID = /^[a-p]{32}$/;
function sanitizeExtensionId(id: unknown): string | null {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  return VALID_EXT_ID.test(trimmed) ? trimmed : null;
}

// パッケージ化せず読み込んだ拡張機能の id（パスから導かれ、chrome://extensions に出る）。
// リポジトリに鍵を一切コミットしなくて済むよう、アプリが config.json に保存する。
export function readExtensionId(): string | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (cfg) return sanitizeExtensionId(cfg.extensionId);
  } catch {
    // まだ設定が無い。
  }
  return null;
}

export function launcherPath(): string {
  return path.join(configDir(), process.platform === 'win32' ? 'hologram-host.bat' : 'hologram-host.sh');
}

export function manifestPath(): string {
  return path.join(configDir(), `${HOST_NAME}.json`);
}

// リンクされた Git の worktree は .git がファイル（本体のリポジトリを指す）で、本体の
// 作業ツリーは .git がディレクトリだ。Electron はその目印より何階層も下に在るので、
// worktree の名前の付け方に頼らず、ランタイムの位置から上へ辿る。
export function isLinkedWorktreeRuntime(exe: string): boolean {
  let dir = path.dirname(path.resolve(exe));
  while (true) {
    try {
      if (fs.statSync(path.join(dir, '.git')).isFile()) return true;
    } catch {
      /* そのまま上へ辿り続ける */
    }
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

interface PreserveSharedRegistrationArgs {
  exe: string;
  runAsNode: boolean;
  configDirOverride?: string;
}

// 開発用の worktree は、意図して使い捨てにしてある。その Electron のパスをユーザーの
// 本物のランチャーに残すと、その worktree を消した途端にブラウザからの保存がすべて失敗
// する。設定の明示的な上書きは隔離されたテスト環境なので、そこでの登録は許したままにする。
export function shouldPreserveSharedRegistration({ exe, runAsNode, configDirOverride = process.env.HOLOGRAM_CONFIG_DIR }: PreserveSharedRegistrationArgs): boolean {
  return runAsNode && !configDirOverride && isLinkedWorktreeRuntime(exe);
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: \x00-\x7F is the deliberate full-ASCII range check
const isAscii = (s: string): boolean => /^[\x00-\x7F]*$/.test(s);

// cmd.exe は .bat をコンソールの OEM コードページで読む。だから非 ASCII のパスを参照する
// ランチャー（たとえば C:\…\ローカル\開発\ の下のリポジトリ）はパスを壊され、ホストは
// 「Error when communicating with the native messaging host」で起動に失敗する＝保存が
// 黙って一切働かなくなる。.bat には生の exe ではなく、ASCII だけのディレクトリの
// ジャンクション（管理者権限は要らない）を指させる。
function asciiExeRef(exe: string): string {
  if (isAscii(exe)) return exe;
  const exeDir = path.dirname(exe);
  const link = path.join(configDir(), 'runtime'); // configDir は ASCII
  try {
    let good = false;
    if (fs.existsSync(link)) {
      try {
        const st = fs.lstatSync(link);
        if (st.isSymbolicLink()) good = path.resolve(fs.readlinkSync(link)) === path.resolve(exeDir);
      } catch {
        good = false;
      }
      if (!good) fs.rmSync(link, { recursive: true, force: true });
    }
    if (!good) fs.symlinkSync(exeDir, link, 'junction');
    // %~dp0 は .bat 自身の（ASCII の）ディレクトリで、末尾にバックスラッシュが付く。
    return `%~dp0runtime\\${path.basename(exe)}`;
  } catch {
    return exe; // ジャンクションを作れない＝生のパスに退避する
  }
}

interface WriteLauncherArgs {
  exe: string;
  runAsNode: boolean;
  bridgePath: string;
}

function writeLauncher({ exe, runAsNode, bridgePath }: WriteLauncherArgs): string {
  fs.mkdirSync(configDir(), { recursive: true });
  const p = launcherPath();

  if (process.platform === 'win32') {
    const exeRef = asciiExeRef(exe);
    const lines = ['@echo off'];
    // Chrome はこのランチャーを、インストーラが走った環境ではなくブラウザの環境で
    // 起動する。だから隔離したインストールは、自分の設定ディレクトリを必ず焼き込まな
    // ければならない。さもないと開発用のホストが、本物の設定ディレクトリ
    // （%APPDATA%\Hologram）を解決して本物のライブラリに書き込むブリッジを起動して
    // しまう（#732）。
    if (process.env.HOLOGRAM_CONFIG_DIR) lines.push(`set "HOLOGRAM_CONFIG_DIR=${configDir()}"`);
    if (runAsNode) lines.push('set ELECTRON_RUN_AS_NODE=1');
    lines.push(`"${exeRef}" "${bridgePath}" %*`);
    fs.writeFileSync(p, lines.join('\r\n') + '\r\n', 'utf8');
  } else {
    const lines = ['#!/bin/sh'];
    if (process.env.HOLOGRAM_CONFIG_DIR) lines.push(`export HOLOGRAM_CONFIG_DIR="${configDir()}"`);
    if (runAsNode) lines.push('export ELECTRON_RUN_AS_NODE=1');
    lines.push(`exec "${exe}" "${bridgePath}" "$@"`);
    fs.writeFileSync(p, lines.join('\n') + '\n', { mode: 0o755 });
  }
  return p;
}

function writeManifest(launcher: string, extensionId: string | null): string {
  // extensionId が分からないとき（たとえばアプリは起動のたびに登録し直すが、設定には
  // まだ id が無い）は、allowed_origins を [] に消さず、既に在るものを必ず保つ。空の
  // allowed_origins は拡張機能を黙って禁じ、id を設定し直すまで保存をすべて壊す＝
  // まさにあの一件で起きた失敗だ。自分で治る形にしてある。id 無しの起動が、動いている
  // マニフェストを劣化させることは決してない。
  let allowedOrigins: string[] = extensionId ? [`chrome-extension://${extensionId}/`] : [];
  if (!extensionId) {
    try {
      const prev = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
      if (Array.isArray(prev.allowed_origins) && prev.allowed_origins.length) allowedOrigins = prev.allowed_origins;
    } catch {
      /* 以前のマニフェストが無い＝空のままにする */
    }
  }
  const manifest = {
    name: HOST_NAME,
    description: 'Hologram native messaging host',
    path: launcher,
    type: 'stdio',
    allowed_origins: allowedOrigins,
  };
  const p = manifestPath();
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
  return p;
}

// 明示的に渡された拡張機能の id を config.json に残す（アプリの他の設定は保つ）。こう
// すると、後のアプリの起動＝allowed_origins を登録するために設定から id を読む側は、
// 正しいオリジンを消さずに保てる。
function persistExtensionId(id: string | null): void {
  if (!id) return;
  try {
    const p = path.join(configDir(), 'config.json');
    let cfg: Record<string, unknown> = {};
    let raw: string | null = null;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch {
      /* 設定が新規＝下で最初から書く */
    }
    if (raw !== null) {
      try {
        cfg = JSON.parse(raw.replace(/^\uFEFF/, '')) || {};
      } catch {
        // 在るが解析できない（書き込みが途中で切れた、手で編集して壊した）。ファイルを
        // {extensionId} だけに書き直さず、ここで諦める。書き直せば saveFolder と
        // バックアップを一撃で消すからだ（アプリの readConfig と同じ、上書きせず保つ
        // 規則）。登録は続行する。id は次回の実行で残る。
        return;
      }
    }
    if (cfg.extensionId !== id) {
      cfg.extensionId = id;
      fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf8');
    }
  } catch {
    /* できる範囲で＝登録を止めることは決してしない */
  }
}

export function windowsRegistryKeys(): string[] {
  return [`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`];
}

export function unixManifestDirs(): string[] {
  const home = os.homedir();
  if (process.platform !== 'darwin') throw new Error(`Unsupported platform: ${process.platform}`);
  return [path.join(home, 'Library/Application Support/Google/Chrome/NativeMessagingHosts')];
}

interface InstallOptions {
  exe?: string;
  runAsNode?: boolean;
  extensionId?: unknown;
}

export function install({ exe = process.execPath, runAsNode = false, extensionId }: InstallOptions = {}) {
  if (shouldPreserveSharedRegistration({ exe, runAsNode })) {
    const launcher = launcherPath();
    const manifest = manifestPath();
    if (!fs.existsSync(launcher) || !fs.existsSync(manifest)) {
      throw new Error('Refusing to register the real native messaging host with a disposable Git worktree runtime. Run "node native-host/install.mts" from the main working tree first.');
    }
    return { launcher, manifest, configDir: configDir(), extensionId: readExtensionId(), preserved: true };
  }

  const extId = sanitizeExtensionId(extensionId);
  if (extId) persistExtensionId(extId); // 明示された id（CLI やアプリから）→ 消えない形にする
  const id = extId || readExtensionId();
  const bridgePath = deployBridge();
  const launcher = writeLauncher({ exe, runAsNode, bridgePath });
  const manifest = writeManifest(launcher, id);

  if (process.platform === 'win32') {
    for (const key of windowsRegistryKeys()) {
      execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f'], { stdio: 'ignore' });
    }
  } else if (process.platform === 'darwin') {
    for (const dir of unixManifestDirs()) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(manifest, path.join(dir, `${HOST_NAME}.json`));
      } catch {
        // そのブラウザは入っていない＝飛ばす。
      }
    }
  } else throw new Error(`Unsupported platform: ${process.platform}`);

  return { launcher, manifest, configDir: configDir(), extensionId: id };
}

// マニフェストの allowed_origins だけを書き直し、既に在るランチャーは保つ（動いている
// ランチャーを、非 ASCII の exe のパスを指すもので上書きすることが決してないように）。
// マニフェストがまだ無ければ、代わりにインストール一式を走らせる。
export function updateAllowedOrigin(extensionId: unknown) {
  const extId = sanitizeExtensionId(extensionId);
  const mp = manifestPath();
  let manifest: any;
  try {
    manifest = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch {
    return install({ extensionId: extId });
  }
  manifest.allowed_origins = extId ? [`chrome-extension://${extId}/`] : [];
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 2), 'utf8');
  return { manifest: mp, extensionId: extId };
}

export function uninstall(): void {
  if (process.platform === 'win32') {
    for (const key of windowsRegistryKeys()) {
      try {
        execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore' });
      } catch {
        // キーが無い＝それでよい。
      }
    }
  } else if (process.platform === 'darwin') {
    for (const dir of unixManifestDirs()) {
      try {
        fs.unlinkSync(path.join(dir, `${HOST_NAME}.json`));
      } catch {
        // 無い＝それでよい。
      }
    }
  } else throw new Error(`Unsupported platform: ${process.platform}`);

  // 配置したブリッジ、ランチャー、生成したホストのマニフェストを消す。config.json
  // （extensionId と saveFolder）は残し、アンインストールしてもユーザーの設定が生き残る
  // ようにする。古くなったマニフェストを消すことにも意味がある。app/src/main/index.ts が
  // existsSync(manifestPath()) で登録のゲートをかけているので、マニフェストが残っていると、
  // 後の起動が古い allowed_origins のまま登録し直しを飛ばしてしまう。
  const leftovers = [path.join(configDir(), DEPLOYED_BRIDGE), launcherPath(), manifestPath()];
  for (const f of leftovers) {
    try {
      fs.unlinkSync(f);
    } catch {
      // 無い＝それでよい。
    }
  }
}

// deployBridge() がバンドルを置く場所。診断（scripts/self-test）が、自前で書き下した
// パスではなく、ランチャーが実際に走らせるファイルを確かめられるように export している。
export function deployedBridgePath(): string {
  return path.join(configDir(), DEPLOYED_BRIDGE);
}

// このモジュール自身がプロセスの入口のときだけ CLI として振る舞う。`require.main ===
// module` は CommonJS の書き方で、このファイルが読み込まれる2通りのやり方（Node の
// 型剥がしの下での生のソースと、Electron のメインプロセスからの同期的な require(esm)）
// の両方を生き延びる ESM の同等物が無い。だから代わりに入口のパスを比べる。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'uninstall') {
    uninstall();
    console.log(`Native Messaging ホスト "${HOST_NAME}" を削除した。`);
  } else {
    // 省略可能: `node install.mts <extensionId>` で、許可する拡張機能を設定する。
    const argId = process.argv[2];
    const result = install(argId ? { extensionId: argId } : {});
    console.log(`Native Messaging ホスト "${HOST_NAME}" をインストールした。`);
    console.log(`  extensionId: ${result.extensionId || '(未設定＝アプリで設定してから登録し直す)'}`);
    console.log(`  launcher: ${result.launcher}`);
    console.log(`  manifest: ${result.manifest}`);
    console.log(`  config:   ${path.join(result.configDir, 'config.json')}`);
  }
}
