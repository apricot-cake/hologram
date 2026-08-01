'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CONFIG = process.env.HOLOGRAM_CONFIG_DIR || path.join(os.homedir(), '.hologram');
const PREVIEW = path.join(CONFIG, 'extension-dev-preview.json');
const PREVIEW_LOCK = path.join(CONFIG, 'extension-dev-preview.lock');
const STATUS = path.join(CONFIG, 'extension-dev-server.json');
const CONTROL = path.join(CONFIG, 'extension-dev-control.json');
const TASK_NAME = 'HologramExtensionDev';
const LOCK_STALE_MS = 10_000;

class PreviewBusyError extends Error {
  state: Record<string, any>;

  constructor(state: Record<string, any>) {
    super(`extension preview is owned by ${state.ownerId} at ${state.sourceRoot}`);
    this.name = 'PreviewBusyError';
    this.state = state;
  }
}

function normalize(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EPERM' || process.platform !== 'win32') return false;
    try {
      const tasks = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return tasks.includes(`"${pid}"`);
    } catch {
      return false;
    }
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function requestOrphanCleanup(serverPid) {
  if (!Number.isInteger(serverPid) || serverPid < 1) return;
  atomicWrite(CONTROL, {
    token: `s4u-migration-${Date.now()}-${process.pid}`,
    requestedAt: new Date().toISOString(),
    requestedByPid: process.pid,
    orphanAncestorPid: serverPid,
  });
}

function registeredWorktrees(root) {
  const output = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length).trim()))
    .filter(Boolean);
}

function worktreeContext(root = ROOT) {
  const worktrees = registeredWorktrees(root);
  const mainRoot = worktrees[0];
  const sourceRoot = worktrees.find((candidate) => normalize(candidate) === normalize(root));
  if (!mainRoot || !sourceRoot) throw new Error(`${root} is not a registered Hologram worktree`);
  return { mainRoot, sourceRoot, worktrees };
}

function isUsableSource(sourceRoot, worktrees) {
  if (!worktrees.some((candidate) => normalize(candidate) === normalize(sourceRoot))) return false;
  return fs.existsSync(path.join(sourceRoot, 'extension', 'vite.config.ts')) && fs.existsSync(path.join(sourceRoot, 'package.json'));
}

function waitBriefly(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(action) {
  fs.mkdirSync(CONFIG, { recursive: true });
  const deadline = Date.now() + 3000;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = fs.openSync(PREVIEW_LOCK, 'wx');
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
      const lock = readJson(PREVIEW_LOCK);
      const age = Date.now() - Date.parse(lock?.createdAt || '');
      if (!alive(Number(lock?.pid)) || !Number.isFinite(age) || age > LOCK_STALE_MS) {
        try {
          fs.rmSync(PREVIEW_LOCK, { force: true });
        } catch {}
        continue;
      }
      if (Date.now() >= deadline) throw new Error('timed out waiting for the extension preview state lock');
      waitBriefly(25);
    }
  }
  try {
    return action();
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      fs.rmSync(PREVIEW_LOCK, { force: true });
    } catch {}
  }
}

function claimTransition(existing, request) {
  if (existing?.ownerId && existing.ownerId !== request.ownerId) throw new PreviewBusyError(existing);
  if (existing?.ownerId === request.ownerId && normalize(existing.sourceRoot) !== normalize(request.sourceRoot)) {
    throw new PreviewBusyError(existing);
  }
  return {
    mainRoot: request.mainRoot,
    sourceRoot: request.sourceRoot,
    ownerId: request.ownerId,
    acquiredAt: existing?.acquiredAt || request.now,
    updatedAt: request.now,
  };
}

function releaseTransition(existing, request) {
  if (existing?.ownerId && existing.ownerId !== request.ownerId && !request.force) throw new PreviewBusyError(existing);
  return {
    mainRoot: request.mainRoot,
    sourceRoot: request.mainRoot,
    ownerId: null,
    acquiredAt: null,
    updatedAt: request.now,
  };
}

function claimPreview(ownerId, root = ROOT) {
  if (!ownerId) throw new Error('extension preview owner ID is required');
  const context = worktreeContext(root);
  if (normalize(context.sourceRoot) === normalize(context.mainRoot)) {
    throw new Error('the main worktree is the default source and does not acquire preview ownership');
  }
  if (!isUsableSource(context.sourceRoot, context.worktrees)) throw new Error(`extension preview source is incomplete: ${context.sourceRoot}`);
  return withLock(() => {
    const next = claimTransition(readJson(PREVIEW), {
      ownerId,
      mainRoot: context.mainRoot,
      sourceRoot: context.sourceRoot,
      now: new Date().toISOString(),
    });
    atomicWrite(PREVIEW, next);
    return next;
  });
}

function releasePreview(ownerId, root = ROOT, force = false) {
  const context = worktreeContext(root);
  return withLock(() => {
    const next = releaseTransition(readJson(PREVIEW), {
      ownerId,
      mainRoot: context.mainRoot,
      force,
      now: new Date().toISOString(),
    });
    atomicWrite(PREVIEW, next);
    return next;
  });
}

function readSelection(mainRoot) {
  const worktrees = registeredWorktrees(mainRoot);
  const state = readJson(PREVIEW);
  if (!state || normalize(state.mainRoot || mainRoot) !== normalize(mainRoot) || !state.ownerId || !isUsableSource(state.sourceRoot, worktrees)) {
    return { mainRoot, sourceRoot: mainRoot, ownerId: null };
  }
  return { mainRoot, sourceRoot: path.resolve(state.sourceRoot), ownerId: state.ownerId, acquiredAt: state.acquiredAt };
}

function readDevStatus() {
  return readJson(STATUS);
}

function ownerFromEnvironment() {
  return process.env.CODEX_THREAD_ID || process.env.CLAUDE_SESSION_ID || '';
}

function startSupervisorIfNeeded(mainRoot) {
  const status = readDevStatus();
  if (alive(Number(status?.supervisorPid)) && status?.previewProtocol === 1) return;
  const supervisor = path.join(mainRoot, 'scripts', 'extension-dev-supervisor.cts');
  if (alive(Number(status?.supervisorPid)) && !fs.readFileSync(supervisor, 'utf8').includes('previewProtocol: 1')) {
    throw new Error('the main worktree does not contain the preview-aware supervisor yet');
  }
  if (alive(Number(status?.supervisorPid))) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(status.supervisorPid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch (error) {
      if (process.platform !== 'win32') throw error;
      requestOrphanCleanup(Number(status?.serverPid));
      execFileSync('schtasks.exe', ['/End', '/TN', TASK_NAME], { windowsHide: true, stdio: 'ignore' });
      execFileSync('schtasks.exe', ['/Run', '/TN', TASK_NAME], { windowsHide: true, stdio: 'ignore' });
      return;
    }
  }
  const child = spawn(process.execPath, [supervisor, 'run'], {
    cwd: mainRoot,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function waitForSource(sourceRoot, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = readDevStatus();
    if (status?.state === 'ready' && normalize(status.sourceRoot || '') === normalize(sourceRoot)) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const status = readDevStatus();
  throw new Error(`extension dev server did not become ready for ${sourceRoot}; current status: ${JSON.stringify(status)}`);
}

function readHookInput(): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.on('data', (chunk) => (raw += chunk));
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
  });
}

function isWriteTool(input) {
  const tool = String(input.tool_name || '');
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return true;
  if (tool !== 'Bash') return false;
  return String(input.tool_input?.command || '').includes('apply_patch');
}

function hookDeny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

async function hookAcquire() {
  const input = await readHookInput();
  const ownerId = input.session_id;
  const root = input.cwd || ROOT;
  try {
    const context = worktreeContext(root);
    if (normalize(context.sourceRoot) === normalize(context.mainRoot)) return;
    const state = claimPreview(ownerId, root);
    startSupervisorIfNeeded(state.mainRoot);
    await waitForSource(state.sourceRoot);
    process.stdout.write(
      JSON.stringify({
        systemMessage: `[extension-preview] ${state.sourceRoot} をこのセッションのHMR配信元として取得しました。`,
      }),
    );
  } catch (error) {
    const busy = error instanceof PreviewBusyError ? `所有者=${error.state.ownerId} 配信元=${error.state.sourceRoot}` : String(error);
    process.stdout.write(JSON.stringify({ systemMessage: `[extension-preview] 取得できませんでした: ${busy}` }));
  }
}

async function hookCheck() {
  const input = await readHookInput();
  if (!isWriteTool(input)) return;
  const ownerId = input.session_id;
  const root = input.cwd || ROOT;
  try {
    const context = worktreeContext(root);
    if (normalize(context.sourceRoot) === normalize(context.mainRoot)) {
      hookDeny('本体ツリーは読み取り専用です。専用worktreeへ移ってから編集してください。');
      return;
    }
    const state = claimPreview(ownerId, root);
    startSupervisorIfNeeded(state.mainRoot);
    await waitForSource(state.sourceRoot);
  } catch (error) {
    const busy = error instanceof PreviewBusyError ? `別セッション ${error.state.ownerId} が ${error.state.sourceRoot} を配信中です。` : String(error);
    hookDeny(`Hologramの実機HMR配信元を取得できないため書き込みを止めました。${busy}`);
  }
}

async function hookRelease() {
  const input = await readHookInput();
  const ownerId = input.session_id;
  const root = input.cwd || ROOT;
  try {
    const state = releasePreview(ownerId, root);
    startSupervisorIfNeeded(state.mainRoot);
    await waitForSource(state.mainRoot);
  } catch (error) {
    if (!(error instanceof PreviewBusyError)) {
      process.stdout.write(JSON.stringify({ systemMessage: `[extension-preview] main復帰に失敗しました: ${String(error)}` }));
    }
  }
}

async function main() {
  const command = process.argv[2] || 'check';
  if (command === 'hook-acquire') return hookAcquire();
  if (command === 'hook-check') return hookCheck();
  if (command === 'hook-release') return hookRelease();

  const ownerId = process.argv[3] || ownerFromEnvironment();
  if (command === 'acquire') {
    const state = claimPreview(ownerId);
    startSupervisorIfNeeded(state.mainRoot);
    await waitForSource(state.sourceRoot);
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (command === 'release') {
    const state = releasePreview(ownerId);
    startSupervisorIfNeeded(state.mainRoot);
    await waitForSource(state.mainRoot);
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (command === 'main') {
    const state = releasePreview(ownerId || 'force-main', ROOT, true);
    startSupervisorIfNeeded(state.mainRoot);
    await waitForSource(state.mainRoot);
    console.log(JSON.stringify(state, null, 2));
    return;
  }
  if (command === 'check') {
    const context = worktreeContext();
    const selection = readSelection(context.mainRoot);
    const status = readDevStatus();
    console.log(JSON.stringify({ ...selection, status }, null, 2));
    if (!ownerId || selection.ownerId !== ownerId || normalize(selection.sourceRoot) !== normalize(context.sourceRoot)) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

module.exports = {
  PreviewBusyError,
  alive,
  claimPreview,
  claimTransition,
  normalize,
  readDevStatus,
  readSelection,
  registeredWorktrees,
  releasePreview,
  releaseTransition,
  waitForSource,
  worktreeContext,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}
