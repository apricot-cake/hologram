'use strict';

// キャプチャ配管のヘルスチェック。保存が壊れた後、拡張機能／ホスト／レジストリの間で
// 推測するのではなく、素早く原因箇所を絞り込むために走らせる:
//
//   node scripts/self-test.cts
//
// チェックの順序:
//   1. サンドボックス内でのブリッジ往復――リポジトリのブリッジコードとネイティブ
//      メッセージングのフレーミングが動くことを証明する（ping＋save＋sidecar書き込み）。
//   2. config.jsonが解析できる（解決された保存フォルダを報告する）。
//   3. 保存フォルダ（またはその最も近い実在する祖先）が書き込み可能。
//   4. （win32）設定ディレクトリ（%APPDATA%\Hologram）下のネイティブホストのMANIFESTが
//      解決できる（ランチャーが存在し、拡張機能のオリジンを許可している）。HKCUポインタは
//      INFOとしてのみ報告する――コンテナ内の`reg query`は仮想ハイブを読むので信用できない。
//   5. デプロイされたブリッジ（configDir/bridge.js）がビルド済みバンドルと一致する――
//      installはバンドルをASCIIの設定ディレクトリへCOPYするので、ホストを編集しても
//      再ビルドしてinstallを再実行するまで何も反映されない。古いコピーは
//      「直したはずなのに直っていない」の最大の罠だ。
//
// PASS/FAILは厳格。INFO/WARNはテスト一式を決して失敗させない。

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { configDir, defaultLibraryDir } = require('../native-host/paths.mts');
const install = require('../native-host/install.mts');

// installがデプロイするのはビルド済みバンドルの方だ――bridge.mtsと比較すると、
// ビルドのたびに偽のSTALEを報告してしまう（デプロイされるファイルはバンドル出力）。
const REPO_BRIDGE = install.BRIDGE_PATH;

// 最小の有効な1x1 JPEG（test-bridge.mtsと共有）。
const JPEG_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' + 'AAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwH/2Q==';

function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

function parseFrames(buf) {
  const out: any[] = [];
  let off = 0;
  while (off + 4 <= buf.length) {
    const len = buf.readUInt32LE(off);
    if (off + 4 + len > buf.length) break;
    try {
      out.push(JSON.parse(buf.subarray(off + 4, off + 4 + len).toString('utf8')));
    } catch {
      /* 読み飛ばす */
    }
    off += 4 + len;
  }
  return out;
}

function resolveSaveFolder() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(configDir(), 'config.json'), 'utf8'));
    if (cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim()) return cfg.saveFolder;
  } catch {
    /* 既定値へフォールスルー */
  }
  return defaultLibraryDir();
}

// --- チェック1: サンドボックス往復（ping + save） ---
function sandboxRoundTrip() {
  return new Promise<any>((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-selftest-'));
    const saveFolder = path.join(tmp, 'saves');
    fs.mkdirSync(path.join(tmp, 'Hologram'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'Hologram', 'config.json'), JSON.stringify({ saveFolder }));
    const captureId = '1717500000000-beef';
    // HOLOGRAM_CONFIG_DIR経由でconfigDirをサンドボックスに隔離する。
    const env = Object.assign({}, process.env, { APPDATA: tmp, HOLOGRAM_CONFIG_DIR: path.join(tmp, 'Hologram') });
    const child = spawn(process.execPath, [REPO_BRIDGE], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let out = Buffer.alloc(0);
    child.stdout.on('data', (d) => {
      out = Buffer.concat([out, d]);
    });
    child.on('error', (e) => {
      fs.rmSync(tmp, { recursive: true, force: true });
      resolve({ name: 'サンドボックスでのブリッジ往復', ok: false, detail: `spawn失敗: ${e.message}` });
    });
    child.on('close', () => {
      const frames = parseFrames(out);
      const pong = frames.some((f) => f && f.pong);
      const saved = frames.some((f) => f && f.ok && f.file);
      const jpgOk = fs.existsSync(path.join(saveFolder, `${captureId}.jpg`));
      // 保存のうちレコード側は取込エンベロープ（#5 St6 / #299）であり、画像の隣にある
      // ファイルではない――アプリがデータベースを所有し、キューをdrainする。
      const envelopeOk = fs.existsSync(path.join(saveFolder, '.hologram-inbox', 'new', `${captureId}.json`));
      fs.rmSync(tmp, { recursive: true, force: true });
      const ok = pong && saved && jpgOk && envelopeOk;
      resolve({
        name: 'サンドボックスでのブリッジ往復',
        ok,
        detail: ok ? 'ping+save+envelope OK' : `pong=${pong} save=${saved} jpg=${jpgOk} envelope=${envelopeOk}`,
      });
    });
    child.stdin.write(frame({ type: 'ping' }));
    child.stdin.write(frame({ type: 'save', captureId, image: JPEG_B64, metadata: { url: 'https://x.com/u/status/1', platform: 'x' }, metaOk: true }));
    child.stdin.end();
  });
}

// --- check 2: config.json ---
function checkConfig() {
  const p = path.join(configDir(), 'config.json');
  if (!fs.existsSync(p)) return { name: 'config.json', ok: true, soft: true, detail: `無し（${p}）――既定の保存フォルダが使われる` };
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const sf = cfg && typeof cfg.saveFolder === 'string' && cfg.saveFolder.trim() ? cfg.saveFolder : `${defaultLibraryDir()} (既定)`;
    return { name: 'config.json', ok: true, detail: `解析できる; saveFolder=${sf}` };
  } catch (e) {
    return { name: 'config.json', ok: false, detail: `解析エラー: ${e.message} (${p})` };
  }
}

// --- チェック3: 保存フォルダの書き込み可否 ---
function checkWritable() {
  const folder = resolveSaveFolder();
  let target = folder;
  while (target && !fs.existsSync(target)) target = path.dirname(target); // ブリッジは保存時にmkdirするので、最も近い実在する祖先を確かめる
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return { name: '保存フォルダの書き込み可否', ok: true, detail: `${folder}${target === folder ? '' : `（祖先 ${target}）`}` };
  } catch (e) {
    return { name: '保存フォルダの書き込み可否', ok: false, detail: `${folder}は書き込み不可: ${e.code || e.message}` };
  }
}

// --- チェック4: ネイティブホストの登録（win32） ---
// configDir()（Windows: %APPDATA%\Hologram）下のMANIFESTファイルをハードチェックする。
// HKCUポインタは別枠で、ハード失敗にはせずソフトなINFO行として報告する
// （checkRegistryPointer）。元々の理由は2026-08-06（#1003）に無くなった＝MSIXの
// コンテナ下のシェルはかつて仮想ハイブを読んでいて、`reg query`の結果は何であれ意味を
// 成さなかった。今はそのコンテナに包まれておらず、ハイブは本物だ――だからこれは
// ハードチェックに昇格させられる。ホストを一度も登録したことのないマシン（新しい
// worktreeなど）で誤発火しないと誰かが確認するまでは、ソフトのままにしておく。
// 「キャプチャは動いているか」の権威ある兆候は、実際のChromeでのキャプチャと、
// 設定ディレクトリのbridge.log / capture.log（Windows: %APPDATA%\Hologram）のままだ。
function checkRegistration() {
  if (process.platform !== 'win32') return { name: 'ホスト登録', ok: true, soft: true, detail: 'スキップ（非win32）' };
  const manifestPath = path.join(configDir(), `${install.HOST_NAME}.json`);
  if (!fs.existsSync(manifestPath)) {
    return { name: 'ホスト登録', ok: false, detail: `manifestが無い（${manifestPath}）――実行: node native-host/install.mts` };
  }
  try {
    const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const launcherOk = !!man.path && fs.existsSync(man.path);
    const originsOk = Array.isArray(man.allowed_origins) && man.allowed_origins.length > 0;
    const ok = man.name === install.HOST_NAME && launcherOk && originsOk;
    let detail = `manifest=${manifestPath}; launcher ${launcherOk ? 'OK' : `見つからない（${man.path}）`}`;
    if (!originsOk) detail += '; allowed_originsが空――アプリで拡張機能IDを設定してから再登録すること';
    return { name: 'ホスト登録', ok, detail };
  } catch (e) {
    return { name: 'ホスト登録', ok: false, detail: `manifest解析エラー: ${e.message}` };
  }
}

// --- 情報: HKCUポインタ（win32）――ソフト。ハードチェックにしない理由は上のcheckRegistrationを参照 ---
function checkRegistryPointer() {
  if (process.platform !== 'win32') return { name: 'HKCUポインタ（情報）', ok: true, soft: true, detail: 'スキップ（非win32）' };
  const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${install.HOST_NAME}`;
  // 2026-08-06（#1003）までは「これは仮想ハイブを読んでいる」だった――MSIXコンテナは
  // もうこのプロセスを包んでいないので、以下の値は実際のChromeが参照するものそのものだ。
  const caveat = '2026-08-06以降は本物のハイブを報告する。キャプチャ＋設定ディレクトリのbridge.logが依然としてエンドツーエンドの証拠';
  try {
    const out = execFileSync('reg', ['query', key, '/ve'], { encoding: 'utf8' });
    const m = out.match(/REG_SZ\s+(.+?)\s*$/m);
    const regPath = m ? m[1].trim() : '（既定値なし）';
    return { name: 'HKCUポインタ（情報）', ok: true, soft: true, detail: `${regPath} — ${caveat}` };
  } catch {
    return { name: 'HKCUポインタ（情報）', ok: true, soft: true, detail: `このプロセスから見える値が無い — ${caveat}` };
  }
}

// --- チェック5: デプロイ済みブリッジの鮮度 ---
function checkDeployedBridge() {
  const deployed = install.deployedBridgePath();
  if (!fs.existsSync(deployed)) {
    return { name: 'デプロイ済みブリッジ', ok: false, detail: `無い（${deployed}）――実行: node native-host/install.mts` };
  }
  if (!fs.existsSync(REPO_BRIDGE)) {
    return { name: 'デプロイ済みブリッジ', ok: false, detail: `比較対象のバンドルが無い（${REPO_BRIDGE}）――app/で"npm run build:native-host-bridge"を実行すること` };
  }
  const same = fs.readFileSync(deployed, 'utf8') === fs.readFileSync(REPO_BRIDGE, 'utf8');
  return same ? { name: 'デプロイ済みブリッジ', ok: true, detail: 'ビルド済みバンドルと一致' } : { name: 'デプロイ済みブリッジ', ok: false, detail: 'STALE――native-host/dist/bridge.jsと異なる。再ビルド後、再実行: node native-host/install.mts' };
}

// --- チェック: デプロイ済みブリッジが実際に動くか（中身が一致するだけでなく） ---
// Chromeのランチャーとまったく同じようにデプロイ済みバンドルをspawnし、pingを送る。
// 起動時にクラッシュするデプロイ済みコピーを捕まえる――中身の一致では捕まえられず、
// 実際に走らせることでしか捕まえられない。（バンドル化以前の典型的な原因は、
// ブリッジと一緒にコピーされなかったファイルへのローカルrequire()だった。バンドルには
// もうそのようなrequireは残っていない。）
function deployedBridgePing() {
  return new Promise<any>((resolve) => {
    const deployed = install.deployedBridgePath();
    if (!fs.existsSync(deployed)) {
      resolve({ name: 'デプロイ済みブリッジの起動確認', ok: false, detail: `無い（${deployed}）――実行: node native-host/install.mts` });
      return;
    }
    const child = spawn(process.execPath, [deployed], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = Buffer.alloc(0);
    let err = '';
    child.stdout.on('data', (d) => {
      out = Buffer.concat([out, d]);
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('error', (e) => resolve({ name: 'デプロイ済みブリッジの起動確認', ok: false, detail: `spawn失敗: ${e.message}` }));
    child.on('close', () => {
      const pong = parseFrames(out).some((f) => f && f.pong);
      resolve(pong ? { name: 'デプロイ済みブリッジの起動確認', ok: true, detail: 'デプロイ済みコピーからping→pong' } : { name: 'デプロイ済みブリッジの起動確認', ok: false, detail: `pongが無い――デプロイ済みホストがクラッシュ: ${err.trim().split('\n')[0] || 'stderrなし'}` });
    });
    child.stdin.write(frame({ type: 'ping' }));
    child.stdin.end();
  });
}

// --- 情報: capture.log ---
function captureLogInfo() {
  const p = path.join(configDir(), 'capture.log');
  if (!fs.existsSync(p)) return { name: 'capture.log', ok: true, soft: true, detail: `まだ無い（${p}）` };
  return { name: 'capture.log', ok: true, soft: true, detail: `${p}（${fs.statSync(p).size}バイト）` };
}

(async () => {
  const results = [await sandboxRoundTrip(), checkConfig(), checkWritable(), checkRegistration(), checkRegistryPointer(), checkDeployedBridge(), await deployedBridgePing(), captureLogInfo()];

  let hardFail = false;
  for (const r of results) {
    const tag = r.ok ? (r.soft ? 'INFO' : 'PASS') : r.soft ? 'WARN' : 'FAIL';
    if (!r.ok && !r.soft) hardFail = true;
    console.log(`[${tag}] ${r.name}: ${r.detail}`);
  }
  console.log(hardFail ? 'SELFTEST_FAIL' : 'SELFTEST_PASS');
  process.exit(hardFail ? 1 : 0);
})();
