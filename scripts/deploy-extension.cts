'use strict';

// 検証済みの一時出力を共有フォルダへ入れ替え、stamp と開発用 Chrome までを
// 一つの排他区間として配備する。通常の Chrome/profile はこのスクリプトから操作
// せず、Native Host が stamp を見て安全な時点で再読み込みする。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { acquireExactRequestLock } = require('../native-host/request-lock.mts');

const { extensionBuildStampPath } = require('../native-host/paths.mts');
const { assertWindowsUserContext } = require('../native-host/windows-user-context.mts');
const { buildExtension } = require('./build-extension.cts');
const { developmentOptions, startDevelopmentBrowser } = require('./lib-dev-browser.cts');

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
  const parent = path.dirname(path.resolve(output));
  fs.mkdirSync(parent, { recursive: true });
  const deadline = performance.now() + timeoutMs;
  let lock: Awaited<ReturnType<typeof acquireExactRequestLock>>;
  for (;;) {
    try {
      lock = await acquireExactRequestLock(parent, `extension-deploy:${path.basename(output)}`);
      if (!lock) throw new Error('拡張機能の配備ロックはWindowsとLinuxに対応しています');
      break;
    } catch (error) {
      if (error?.code !== 'request-in-progress') throw error;
      if (performance.now() >= deadline) throw new Error(`拡張機能の配備ロックを取得できません: ${output}`, { cause: error });
    }
    // biome-ignore lint/plugin: OS lock contention has no release event in the contender process
    await sleep(25);
  }
  try {
    return await action();
  } finally {
    await lock.close();
  }
}

type DeployOptions = {
  output: string;
  stamp: string;
  build: (stage: string) => { buildId: string; output: string };
  configure?: (output: string) => Promise<void>;
  reloadPages?: (output: string) => Promise<void>;
  writeStamp?: (stamp: string, body: string) => void;
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
        let published = false;
        try {
          options.onStep?.('locked');
          if (hadOutput) fs.renameSync(options.output, backup);
          try {
            fs.renameSync(stage, options.output);
            swapped = true;
          } catch (error) {
            if (hadOutput) {
              try {
                fs.renameSync(backup, options.output);
              } catch (restoreError) {
                keepStage = true;
                throw new AggregateError([error, restoreError], `出力の交換と旧版の復元に失敗しました。復旧用の旧版・新版を保持します: backup=${backup}, stage=${stage}, output=${options.output}, stamp=${options.stamp}`);
              }
            }
            throw error;
          }
          options.onStep?.('swapped');
          if (options.configure) await options.configure(options.output);
          options.onStep?.('configured');
          if (options.publish !== false) (options.writeStamp ?? replaceFile)(options.stamp, stampBody(built.buildId, options.output));
          published = true;
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
          // 公開後は別のブラウザやページが新版を読み始めている。ページ更新の部分失敗で
          // 出力を逆戻りさせず、新版を保持して再試行に必要な情報を報告する。
          if (published) throw new Error(`配備は完了しましたがページ更新に失敗しました。新版を保持します: output=${options.output}, backup=${hadOutput ? backup : 'なし'}`, { cause: error });
          if (!swapped) throw error;
          const syncNew = async (location: string, reasons: unknown[]): Promise<never> => {
            const recoveryErrors: unknown[] = [];
            try {
              if (options.publish !== false) (options.writeStamp ?? replaceFile)(options.stamp, stampBody(built.buildId, options.output));
            } catch (syncError) {
              recoveryErrors.push(syncError);
            }
            try {
              if (options.configure) await options.configure(options.output);
            } catch (syncError) {
              recoveryErrors.push(syncError);
            }
            const retry = `npm run ext:deploy（保持中: current=${location}, backup=${hadOutput ? backup : 'なし'}, stamp=${options.stamp}）`;
            throw new AggregateError([...reasons, ...recoveryErrors], `旧状態へ戻せないため検証済み新版を保持しました。再試行: ${retry}`);
          };

          // 初回配備には戻す旧出力がない。CDP が既に loadUnpacked した可能性も
          // あるため、登録済み path を消さず、新版・stamp・CDP を揃えて保持する。
          if (!hadOutput) return await syncNew(options.output, [error]);

          const failed = uniquePath(options.output, 'failed');
          try {
            fs.renameSync(options.output, failed);
          } catch (moveError) {
            // Windows の EPERM/EBUSY で最初の rename 自体が失敗した場合、新版は
            // まだ output にある。旧 stamp のままにせず、新版へ同期して退避を残す。
            if (fs.existsSync(options.output)) return await syncNew(options.output, [error, moveError]);
            throw new AggregateError([error, moveError], `新版の退避にも失敗しました。再試行: npm run ext:deploy（backup=${backup}, output=${options.output}, stamp=${options.stamp}）`);
          }

          try {
            fs.renameSync(backup, options.output);
          } catch (restoreError) {
            try {
              fs.renameSync(failed, options.output);
            } catch (replaceError) {
              keepStage = true;
              throw new AggregateError([error, restoreError, replaceError], `配備と整合復旧に失敗しました。再試行: npm run ext:deploy（backup=${backup}, failed=${failed}, output=${options.output}, stamp=${options.stamp}）`);
            }
            // 旧版へ戻せなくても、新版を公開位置へ戻せたなら stamp と CDP を
            // 実内容へ揃える。backup は次の手動・自動再試行のため保持する。
            return await syncNew(options.output, [error, restoreError]);
          }

          const restoreErrors: unknown[] = [];
          try {
            replaceFile(options.stamp, oldStamp);
          } catch (restoreError) {
            restoreErrors.push(restoreError);
          }
          try {
            if (options.configure) await options.configure(options.output);
          } catch (restoreError) {
            restoreErrors.push(restoreError);
          }
          if (restoreErrors.length) {
            throw new AggregateError([error, ...restoreErrors], `旧ビルドは ${options.output} へ復元しましたが stamp/CDP の復旧が完了しません。再試行: npm run ext:deploy（failed=${failed}, stamp=${options.stamp}）`);
          }
          try {
            fs.rmSync(failed, { recursive: true, force: true });
          } catch {
            // failed は復旧には不要。一方 backup は復旧失敗時に絶対に消さない。
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
  let developmentOpen = false;
  let developmentChecked = false;
  let session: any;
  let result: Awaited<ReturnType<typeof deployExtension>>;
  try {
    result = await deployExtension({
      output: SHARED_OUTPUT,
      stamp: extensionBuildStampPath(),
      build: (stage) => buildExtension('chrome', stage),
      publish,
      configure: publish
        ? async (output) => {
            if (!developmentChecked) {
              const options = developmentOptions();
              developmentOpen = true;
              session = await startDevelopmentBrowser(options);
              developmentChecked = true;
            }
            if (developmentOpen) await session.configure(output);
          }
        : undefined,
      reloadPages: publish
        ? async (output) => {
            if (developmentOpen) await session.reload(output);
          }
        : undefined,
    });
  } finally {
    await session?.release();
  }
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
