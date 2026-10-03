'use strict';

// 検証済みの一時出力を共有フォルダへ入れ替え、stamp と開発用 Chrome までを
// 一つの排他区間として配備する。通常の Chrome/profile はこのスクリプトから操作
// せず、Native Host が stamp を見て安全な時点で再読み込みする。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { extensionBuildStampPath } = require('../native-host/paths.mts');
const { assertWindowsUserContext } = require('../native-host/windows-user-context.mts');
const { buildExtension } = require('./build-extension.cts');
const { DEFAULT_CDP_URL, cdpReady, configureDevelopmentExtension, reloadDevelopmentPages } = require('./lib-extension-profile.cts');

const ROOT = path.join(__dirname, '..');
const SHARED_OUTPUT = path.join(ROOT, 'extension', '.output', 'chrome-mv3');

function uniquePath(output: string, kind: string): string {
  return path.join(path.dirname(output), `.${path.basename(output)}-${kind}-${process.pid}-${crypto.randomUUID()}`);
}

function shouldPublish(): boolean {
  if (process.env.HOLOGRAM_CONFIG_DIR) return true;
  try {
    return fs.statSync(path.join(ROOT, '.git')).isDirectory();
  } catch {
    return true;
  }
}

function stampBody(buildId: string, output: string): string {
  return `${JSON.stringify({ build: buildId, outDir: output, builtAt: new Date().toISOString() }, null, 2)}\n`;
}

function replaceFile(file: string, body: Buffer | string | undefined): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (body === undefined) {
    fs.rmSync(file, { force: true });
    return;
  }
  const temp = `${file}.${process.pid}-${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, body);
  try {
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withDeployLock<T>(output: string, action: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const lock = path.join(path.dirname(output), `.${path.basename(output)}-deploy.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST' || Date.now() >= deadline) throw new Error(`拡張機能の配備ロックを取得できません: ${lock}`, { cause: error });
      // biome-ignore lint/plugin: atomic mkdir lock has no event to await; polling is the lock protocol
      await sleep(25);
    }
  }
  try {
    return await action();
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch (error) {
      // 公開済みビルドを、ロックディレクトリの後片付けだけで失敗扱いにしない。
      console.warn(`[hologram] 配備ロックを削除できませんでした（公開は完了済みです）: ${error instanceof Error ? error.message : error}`);
    }
  }
}

type DeployOptions = {
  output: string;
  stamp: string;
  build: (stage: string) => { buildId: string; output: string };
  configure?: (output: string) => Promise<void>;
  reloadPages?: (output: string) => Promise<void>;
  publish?: boolean;
  timeoutMs?: number;
  onStep?: (step: string) => void;
};

async function deployExtension(options: DeployOptions): Promise<{ buildId: string; backup?: string }> {
  const stage = uniquePath(options.output, 'stage');
  const backup = uniquePath(options.output, 'backup');
  let keepStage = false;
  try {
    const built = options.build(stage); // buildExtension はこの stage を完全に検証してから返す。
    if (path.resolve(built.output) !== path.resolve(stage)) throw new Error('ビルドが指定した staging 出力を返しませんでした');

    return await withDeployLock(
      options.output,
      async () => {
        const hadOutput = fs.existsSync(options.output);
        const oldStamp = fs.existsSync(options.stamp) ? fs.readFileSync(options.stamp) : undefined;
        let swapped = false;
        try {
          options.onStep?.('locked');
          if (hadOutput) fs.renameSync(options.output, backup);
          try {
            fs.renameSync(stage, options.output);
            swapped = true;
          } catch (error) {
            if (hadOutput) fs.renameSync(backup, options.output);
            throw error;
          }
          options.onStep?.('swapped');
          if (options.configure) await options.configure(options.output);
          options.onStep?.('configured');
          if (options.publish !== false) replaceFile(options.stamp, stampBody(built.buildId, options.output));
          options.onStep?.('published');
          if (options.reloadPages) await options.reloadPages(options.output);
          options.onStep?.('reloaded');

          if (hadOutput) {
            try {
              fs.rmSync(backup, { recursive: true, force: true });
            } catch (error) {
              console.warn(`[hologram] 旧ビルドの後片付けに失敗しました（公開は完了済み、退避を保持します）: ${backup}: ${error instanceof Error ? error.message : error}`);
              return { buildId: built.buildId, backup };
            }
          }
          return { buildId: built.buildId };
        } catch (error) {
          if (!swapped) throw error;
          const failed = uniquePath(options.output, 'failed');
          let movedFailed = false;
          try {
            fs.renameSync(options.output, failed);
            movedFailed = true;
            if (hadOutput) fs.renameSync(backup, options.output);
            replaceFile(options.stamp, oldStamp);
            if (options.configure && hadOutput) await options.configure(options.output);
            try {
              fs.rmSync(failed, { recursive: true, force: true });
            } catch {
              // failed は復旧には不要。一方 backup は復旧失敗時に絶対に消さない。
            }
          } catch (restoreError) {
            if (movedFailed && !fs.existsSync(options.output)) {
              try {
                fs.renameSync(failed, options.output);
                // 旧版へ戻せなくても、新版を公開位置へ戻せたなら stamp は必ず
                // 実内容へ揃える。次回配備はこの整合した状態から再試行できる。
                if (options.publish !== false) replaceFile(options.stamp, stampBody(built.buildId, options.output));
              } catch {
                keepStage = true;
              }
            }
            throw new AggregateError([error, restoreError], `配備に失敗し、旧ビルドの復旧にも失敗しました。退避を保持します: ${backup}`);
          }
          throw error;
        }
      },
      options.timeoutMs,
    );
  } finally {
    if (!keepStage && fs.existsSync(stage)) {
      try {
        fs.rmSync(stage, { recursive: true, force: true });
      } catch (error) {
        console.warn(`[hologram] staging の後片付けに失敗しました: ${stage}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }
}

async function main(): Promise<void> {
  assertWindowsUserContext('npm run ext:deploy');
  const publish = shouldPublish();
  const developmentOpen = publish && (await cdpReady(DEFAULT_CDP_URL));
  const result = await deployExtension({
    output: SHARED_OUTPUT,
    stamp: extensionBuildStampPath(),
    build: (stage) => buildExtension('chrome', stage),
    publish,
    configure: developmentOpen ? async (output) => void (await configureDevelopmentExtension(output, DEFAULT_CDP_URL)) : undefined,
    reloadPages: developmentOpen ? async (output) => void (await reloadDevelopmentPages(output, DEFAULT_CDP_URL)) : undefined,
  });
  console.log(`[hologram] 検証済み共有リリースビルド ${result.buildId} を配備しました: ${SHARED_OUTPUT}`);
  if (!publish) console.log('[hologram] 連結されたworktreeのため、ブラウザへの告知を省略しました');
  else if (!developmentOpen) console.log('[hologram] 開発用Chromeは起動していないため、CDPでの読み込み直しを省略しました');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

module.exports = { deployExtension, withDeployLock, SHARED_OUTPUT };
