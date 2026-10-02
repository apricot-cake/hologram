'use strict';

// 開発用のnative messagingホストを登録する（#732）。
//
// これが何を買うか。開発用のChromeプロファイルは日常使いのものと同じ拡張機能
// idで動く＝署名鍵は意図的に固定されている。だから隔離はidからは来ない。
// ホスト名から来る。共有リリースビルドは、開発用プロファイルの設定に従って
// `com.hologram.host.dev`（extension/utils/native-host.ts）を求め、それがこの登録に解決される。その
// ランチャーはHOLOGRAM_CONFIG_DIRを%APPDATA%/Hologram-Devに固定する。それより下流の
// 設定とログを分ける。保存先は既存設定を維持し、初回だけ普段のライブラリに揃える。
// テスト保存の隔離は verify-extension-tab.cts のタブ専用ホストが担当する。
//
//   npm run ext:dev:register                             登録する
//   npm run ext:dev:register -- uninstall                再び取り除く
//   node scripts/register-dev-native-host.cts [uninstall]  npmを使わず同じこと
//
// 登録はHKCUへの書き込みで、これは以前、パッケージ化されたデスクトップアプリが
// その子プロセスを置いたMSIXコンテナから逃れるため、使い捨てのスケジュール
// タスク経由で行っていた: 内側からの書き込みはパッケージごとのハイブへ行き、
// 実際のChromeはそれを決して読まないので、登録は成功したように見えて何もして
// いなかった。OS側の仮想化は2026-08-06に失効した（#1003）が、開発コマンドを
// 実行するエージェントのサンドボックスは別のWindowsユーザー領域を使いうる。
// 下の実行ユーザー検査でその状態を登録前に拒み、その後のレジストリレポートで
// Chromeと同じHKCUに書いた値を読み戻す。
//
// 緑のレポートが証明するのは、依然としてChromeがそのホストを「見つける」こと
// だけ。エンドツーエンドの証明は、開発プロファイルからのcaptureと
// %APPDATA%/Hologram-Dev/bridge.log。

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 開発用と日常用のプロファイルが共有する唯一の拡張機能id（署名鍵は
// extension/wxt.config.tsにある）。導出するのではなく直書きする＝鍵が足元で
// 変わったとき、登録が声高に失敗するように。
const EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';
const DEV_HOST_NAME = 'com.hologram.host.dev';
const DEV_CONFIG_DIR = process.env.HOLOGRAM_DEV_CONFIG_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Hologram-Dev');
const { assertWindowsUserContext } = require('../native-host/windows-user-context.mts');

// installerをrequireする「前」に設定する: ホスト名とconfigディレクトリはどちらも
// モジュール読み込み時に読まれる。paths.mtsがHOLOGRAM_CONFIG_DIRを読むのと
// ちょうど同じように。
process.env.HOLOGRAM_CONFIG_DIR = DEV_CONFIG_DIR;
process.env.HOLOGRAM_NATIVE_HOST_NAME = DEV_HOST_NAME;

const installer = require('../native-host/install.mts');

function seedConfig(): void {
  fs.mkdirSync(DEV_CONFIG_DIR, { recursive: true });
  const { defaultLibraryDir } = require('../native-host/paths.mts');
  const usualConfigFile = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Hologram', 'config.json');
  const usualConfig = fs.existsSync(usualConfigFile) ? JSON.parse(fs.readFileSync(usualConfigFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  const library = usualConfig.saveFolder || defaultLibraryDir();
  fs.mkdirSync(library, { recursive: true });
  const file = path.join(DEV_CONFIG_DIR, 'config.json');
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) || {};
  } catch {
    /* まっさらなサンドボックス */
  }
  // 再登録では利用者が設定した保存先を変えない。
  if (!config.saveFolder) {
    config.saveFolder = library;
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
}

// NativeMessagingHostsのキー1つの既定値。キーが無ければnull。native messagingは
// まさにこれらのキーを通してホスト名を解決し、無いか古いキーはブラウザ側で
// 「Specified native messaging host not found」として表面化する＝こちら側には
// 理由を言うものが何も無い。
function registeredManifest(key: string): string | null {
  try {
    // PowerShellではなく`reg`: これは登録のたびに走り、シェルの起動コストは
    // インストール全体より高くつく。値はパス（構造上ASCII＝configDirがそうだから）
    // なので、周りのコンソール出力をutf8としてデコードしても読んでいる部分が
    // 壊れることはない。
    const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /REG_SZ\s+(.+)/.exec(out)?.[1].trim() ?? null;
  } catch {
    return null; // キーが無い＝`reg query`が非ゼロで終了する
  }
}

// たった今書いたものを読み戻して印字する。`expected`は各キーが運んでいるべき
// manifestのパス。キーが消えているべきときはnull。
function reportRegistry(expected: string | null): void {
  if (process.platform !== 'win32') return;
  const rows = installer.windowsRegistryKeys().map((key: string) => {
    const value = registeredManifest(key);
    if (expected === null) return { key, ok: value === null, state: value === null ? 'removed' : `STILL PRESENT → ${value}` };
    if (value === null) return { key, ok: false, state: 'MISSING' };
    return { key, ok: value === expected, state: value === expected ? 'ok' : `points elsewhere → ${value}` };
  });
  console.log('  レジストリ（HKCU、読み戻し）:');
  for (const row of rows) console.log(`    ${row.state.padEnd(9)} ${row.key}`);
  if (rows.some((row: { ok: boolean }) => !row.ok)) {
    console.error('レジストリが書き込んだ内容と一致しません。Chromeはこれらのキーを通してホスト名を解決するので、開発プロファイルからの保存は失敗します。');
    process.exitCode = 1;
  }
}

assertWindowsUserContext(process.argv[2] === 'uninstall' ? 'npm run ext:dev:register -- uninstall' : 'npm run ext:dev:register');

if (process.argv[2] === 'uninstall') {
  installer.uninstall();
  console.log(`開発用native messagingホスト "${DEV_HOST_NAME}" を削除しました。`);
  reportRegistry(null);
} else {
  seedConfig();
  const result = installer.install({ extensionId: EXTENSION_ID });
  console.log(`開発用native messagingホスト "${DEV_HOST_NAME}" をインストールしました。`);
  console.log(`  extensionId: ${result.extensionId}`);
  console.log(`  launcher:    ${result.launcher}`);
  console.log(`  manifest:    ${result.manifest}`);
  console.log(`  config:      ${path.join(DEV_CONFIG_DIR, 'config.json')}`);
  console.log(`  library:     ${JSON.parse(fs.readFileSync(path.join(DEV_CONFIG_DIR, 'config.json'), 'utf8').replace(/^\uFEFF/, '')).saveFolder}`);
  reportRegistry(result.manifest);
  console.log(`  エンドツーエンド: 開発プロファイルからcaptureし、${path.join(DEV_CONFIG_DIR, 'bridge.log')} を読んでください。`);
}
