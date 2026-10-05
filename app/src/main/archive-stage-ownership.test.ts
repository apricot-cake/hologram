import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createArchiveStage, acquireArchiveActor, registerArchiveActor, recoverArchiveStages, readArchiveStageManifest, archiveStageRoot } from './archive-stage-ownership.ts';

let root: string, profile: string, library: string;
const held: Array<{ close(): Promise<void> }> = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hologram-stage-ownership-test-'));
  profile = path.join(root, 'profile');
  library = path.join(root, 'library');
  await fs.mkdir(profile);
  await fs.mkdir(library);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const lease of held.splice(0)) await lease.close();
  await fs.rm(root, { recursive: true, force: true });
});
const create = () => createArchiveStage(profile, library, 'library-one', root);
const recover = (cleanup: (stage: string) => Promise<void> = async () => {}) => recoverArchiveStages(profile, async (m) => m.libraryId === 'library-one', cleanup, root);
test('active coordinator と worker actor の寿命中は回収しない', async () => {
  const stage = await create();
  const actor = await registerArchiveActor(stage.stage);
  const worker = await acquireArchiveActor(stage.stage, actor);
  held.push(worker);
  const cleanup = vi.fn();
  expect(await recover(cleanup)).toBe(0);
  expect(cleanup).not.toHaveBeenCalled();
  await stage.close();
  expect(await recover(cleanup)).toBe(0);
  expect(cleanup).not.toHaveBeenCalled();
  await worker.close();
  held.pop();
  expect(await recover(cleanup)).toBe(1);
  expect(cleanup).toHaveBeenCalledOnce();
});
test('actor登録とstageを回収した後のlate-startは再作成しない', async () => {
  const stage = await create();
  const actor = await registerArchiveActor(stage.stage);
  await stage.close();
  expect(await recover()).toBe(1);
  await expect(acquireArchiveActor(stage.stage, actor)).rejects.toThrow();
  await expect(fs.stat(stage.stage)).rejects.toMatchObject({ code: 'ENOENT' });
});
test('main/workerを実プロセス強制終了した後にOS leaseを取り直す', async () => {
  const url = pathToFileURL(path.resolve('app/src/main/archive-stage-ownership.ts')).href;
  const code = `import {createArchiveStage,registerArchiveActor,acquireArchiveActor} from ${JSON.stringify(url)}; const stage=await createArchiveStage(${JSON.stringify(profile)},${JSON.stringify(library)},'library-one',${JSON.stringify(root)}); const actor=await registerArchiveActor(stage.stage); await acquireArchiveActor(stage.stage,actor); process.send({stage:stage.stage,actor});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  const exit = once(child, 'close');
  try {
    const [message] = await once(child, 'message');
    expect(await recover()).toBe(0);
    child.kill('SIGKILL');
    await exit;
    expect(await recover()).toBe(1);
    await expect(fs.stat(message.stage)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exit;
  }
}, 10000);
test('別profile、別library、markerなしの旧stageは保持する', async () => {
  const stage = await create();
  await stage.close();
  const foreign = path.join(root, 'foreign-profile');
  await fs.mkdir(foreign);
  expect(
    await recoverArchiveStages(
      foreign,
      async () => true,
      async () => {},
      root,
    ),
  ).toBe(0);
  expect(
    await recoverArchiveStages(
      profile,
      async () => false,
      async () => {},
      root,
    ),
  ).toBe(0);
  const unmarked = path.join(root, 'hologram-archive-import-old');
  await fs.mkdir(unmarked);
  await fs.writeFile(path.join(unmarked, 'keep'), 'original');
  expect(await recover()).toBe(1);
  expect(await fs.readFile(path.join(unmarked, 'keep'), 'utf8')).toBe('original');
});
test('manifest-before-mkdirのcreation crashを容量stageなしで回収する', async () => {
  const stage = await create();
  await fs.rmdir(stage.stage);
  await stage.close();
  const cleanup = vi.fn();
  expect(await recover(cleanup)).toBe(1);
  expect(cleanup).not.toHaveBeenCalled();
});
test('清掃に失敗したstageと所有manifestは次の試行まで保持する', async () => {
  const stage = await create();
  await stage.close();
  await fs.writeFile(path.join(stage.stage, 'payload'), 'prepared');
  expect(
    await recover(async () => {
      throw new Error('disk denied');
    }),
  ).toBe(0);
  expect(await readArchiveStageManifest(stage.stage)).toMatchObject({ libraryId: 'library-one' });
  expect(await fs.readFile(path.join(stage.stage, 'payload'), 'utf8')).toBe('prepared');
  expect(await recover()).toBe(1);
});
test('stage junctionを辿らず他ディレクトリを保持する', async () => {
  const stage = await create();
  await fs.rmdir(stage.stage);
  const target = path.join(root, 'other-data');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'keep'), 'original');
  await fs.symlink(target, stage.stage, process.platform === 'win32' ? 'junction' : 'dir');
  await stage.close();
  expect(await recover()).toBe(0);
  expect(await fs.readFile(path.join(target, 'keep'), 'utf8')).toBe('original');
});
test('manifestは有限形で検証し、超過actorと巨大JSONを保持する', async () => {
  const stage = await create();
  const filename = path.join(path.dirname(stage.stage), stage.manifest.id + '.json');
  await stage.close();
  await fs.writeFile(filename, ' '.repeat(32769));
  expect(await recover()).toBe(0);
  await fs.writeFile(filename, JSON.stringify({ ...stage.manifest, actors: Array(129).fill(stage.manifest.id) }));
  expect(await recover()).toBe(0);
});
test('回収中の新cleanup actorは旧actor locksと衝突しない', async () => {
  const stage = await create();
  await registerArchiveActor(stage.stage);
  await stage.close();
  expect(
    await recover(async (current) => {
      const actor = await registerArchiveActor(current);
      const lease = await acquireArchiveActor(current, actor);
      await lease.close();
    }),
  ).toBe(1);
});
test('専用rootのprofile所有markerが異なると処理しない', async () => {
  const owner = await archiveStageRoot(profile, root);
  await fs.writeFile(path.join(owner.root, 'owner.json'), JSON.stringify({ version: 1, profile: 'foreign' }));
  await expect(recover()).rejects.toThrow('foreign');
});

test('128回を超えるstale失敗再試行でも旧actorを退役して後で清掃できる', async () => {
  const stage = await create();
  const oldActor = await registerArchiveActor(stage.stage);
  await stage.close();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (let retry = 0; retry < 130; retry++) {
    expect(
      await recover(async (current) => {
        const actor = await registerArchiveActor(current);
        const lease = await acquireArchiveActor(current, actor);
        await lease.close();
        throw new Error('library identity unavailable');
      }),
    ).toBe(0);
    expect((await readArchiveStageManifest(stage.stage)).actors).toHaveLength(1);
  }
  await expect(acquireArchiveActor(stage.stage, oldActor)).rejects.toThrow('unregistered');
  expect(await recover()).toBe(1);
}, 20000);
