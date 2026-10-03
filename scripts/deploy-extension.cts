'use strict';

// 検証済みの一時出力を共有フォルダへ入れ替え、stamp と開発用 Chrome までを
// 一つの排他区間として配備する。通常の Chrome/profile はこのスクリプトから操作
// せず、Native Host が stamp を見て安全な時点で再読み込みする。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

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

type LockOwner = { pid: number; hostname: string; token: string; createdAt: string };

function liveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readLockOwner(lock: string): LockOwner | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
    if (typeof value?.pid !== 'number' || typeof value?.hostname !== 'string' || typeof value?.token !== 'string') return undefined;
    return value;
  } catch {
    return undefined;
  }
}

// owner を書き終えた候補ディレクトリを rename するため、観測可能な lock は必ず
// owner 付きになる。終了済みの同一ホスト PID だけを stale と判定し、所有者不明・
// 別ホスト・生存 PID の lock は決して削除しない。
function tryAcquireLock(lock: string, owner: LockOwner): boolean {
  const candidate = `${lock}.candidate-${owner.token}`;
  fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, 'owner.json'), `${JSON.stringify(owner)}\n`);
  try {
    fs.renameSync(candidate, lock);
    return true;
  } catch (error) {
    fs.rmSync(candidate, { recursive: true, force: true });
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) throw error;
    return false;
  }
}

function reclaimStaleLock(lock: string): boolean {
  const owner = readLockOwner(lock);
  if (!owner || owner.hostname !== os.hostname() || liveProcess(owner.pid)) return false;
  const stale = `${lock}.stale-${process.pid}-${crypto.randomUUID()}`;
  try {
    // rename に成功した実行だけが、この特定 owner の lock を回収する。直後に別の
    // deploy が新しい lock を作っても、その lock には触れない。
    fs.renameSync(lock, stale);
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) return false;
    throw error;
  }
  fs.rmSync(stale, { recursive: true, force: true });
  return true;
}

async function withDeployLock<T>(output: string, action: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  const lock = path.join(path.dirname(output), `.${path.basename(output)}-deploy.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const owner: LockOwner = { pid: process.pid, hostname: os.hostname(), token: crypto.randomUUID(), createdAt: new Date().toISOString() };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (tryAcquireLock(lock, owner)) break;
    if (reclaimStaleLock(lock)) continue;
    if (Date.now() >= deadline) {
      const current = readLockOwner(lock);
      const detail = current ? `owner pid=${current.pid} host=${current.hostname} since=${current.createdAt}` : 'owner.json を確認できません（手動確認が必要です）';
      throw new Error(`拡張機能の配備ロックを取得できません: ${lock} (${detail})`);
    }
    // biome-ignore lint/plugin: atomic directory lock has no event to await; polling is the lock protocol
    await sleep(25);
  }
  try {
    return await action();
  } finally {
    try {
      // 自分の token の lock だけを消す。別実行が置いた lock は消さない。
      if (readLockOwner(lock)?.token === owner.token) fs.rmSync(lock, { recursive: true });
    } catch (error) {
      // 成否にかかわらず、ロックの後片付けだけで本来の処理結果を上書きしない。
      console.warn(`[hologram] 配備ロックを削除できませんでした（処理結果は変更しません）: ${error instanceof Error ? error.message : error}`);
    }
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
          if (options.publish !== false) (options.writeStamp ?? replaceFile)(options.stamp, stampBody(built.buildId, options.output));
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
