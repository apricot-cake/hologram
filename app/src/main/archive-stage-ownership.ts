import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { acquireExactRequestLock, type RequestLock } from '../../../native-host/request-lock.mts';

const uuid = z.string().uuid();
const manifestSchema = z.object({
  version: z.literal(1),
  id: uuid,
  profile: z.string().max(32768),
  destination: z.string().max(32768),
  libraryId: z.string().min(1).max(256),
  actors: z
    .array(uuid)
    .max(128)
    .refine((actors) => new Set(actors).size === actors.length),
});
export type ArchiveStageManifest = z.infer<typeof manifestSchema>;
const MAX_MANIFEST_BYTES = 32768;
const canonical = (file: string) => (process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file));
async function regular(file: string, directory: boolean) {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('invalid-archive-stage-owner');
  return stat;
}
async function readJson(file: string) {
  await regular(file, false);
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('archive-stage-manifest-limit');
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const chunk = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!chunk.bytesRead) break;
      offset += chunk.bytesRead;
    }
    return JSON.parse(buffer.subarray(0, offset).toString('utf8'));
  } finally {
    await handle.close();
  }
}
async function writeJson(file: string, value: unknown, exclusive = false) {
  const tmp = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx');
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!exclusive) await fs.rename(tmp, file);
}
async function lock(root: string, key: string): Promise<RequestLock> {
  const result = await acquireExactRequestLock(root, key);
  if (!result) throw new Error('archive-stage-lock-unavailable');
  return result;
}
export async function archiveStageRoot(profile: string, temporary = os.tmpdir(), create = true) {
  const realProfile = canonical(await fs.realpath(profile));
  const root = path.join(temporary, `hologram-archive-stages-${createHash('sha256').update(realProfile).digest('hex')}`);
  if (create) await fs.mkdir(root, { recursive: true });
  await regular(root, true);
  const marker = path.join(root, 'owner.json');
  try {
    if (create) await writeJson(marker, { version: 1, profile: realProfile }, true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const owner = await readJson(marker);
  if (owner?.version !== 1 || owner?.profile !== realProfile) throw new Error('foreign-archive-stage-root');
  return { root, profile: realProfile };
}
async function readManifest(root: string, id: string) {
  uuid.parse(id);
  await regular(root, true);
  const owner = await readJson(path.join(root, 'owner.json'));
  const manifest = manifestSchema.parse(await readJson(path.join(root, `${id}.json`)));
  if (manifest.id !== id || manifest.profile !== owner.profile || owner.version !== 1 || !path.isAbsolute(manifest.destination)) throw new Error('foreign-archive-stage');
  return manifest;
}
export async function readArchiveStageManifest(stage: string): Promise<ArchiveStageManifest> {
  return readManifest(path.dirname(stage), path.basename(stage));
}
export interface OwnedArchiveStage {
  stage: string;
  manifest: ArchiveStageManifest;
  close(): Promise<void>;
}
export async function createArchiveStage(profile: string, destination: string, libraryId: string, temporary = os.tmpdir()): Promise<OwnedArchiveStage> {
  const owner = await archiveStageRoot(profile, temporary);
  const creation = await lock(owner.root, 'archive-stage-creation');
  let lease: RequestLock | undefined;
  try {
    const id = randomUUID();
    lease = await lock(owner.root, `archive-stage-${id}`);
    const manifest = manifestSchema.parse({ version: 1, id, profile: owner.profile, destination: canonical(await fs.realpath(destination)), libraryId, actors: [] });
    // 所有記録を durable にしてから容量を使う。mkdir 直後の強制終了も回収可能。
    await writeJson(path.join(owner.root, `${id}.json`), manifest, true);
    const stage = path.join(owner.root, id);
    await fs.mkdir(stage);
    const held = lease;
    return { stage, manifest, close: () => held.close() };
  } catch (error) {
    await lease?.close();
    throw error;
  } finally {
    await creation.close();
  }
}
export async function registerArchiveActor(stage: string) {
  const root = path.dirname(stage),
    id = path.basename(stage);
  const manifest = await readManifest(root, id);
  await regular(stage, true);
  const actor = randomUUID();
  manifest.actors.push(actor);
  manifestSchema.parse(manifest);
  await writeJson(path.join(root, `${id}.json`), manifest);
  return actor;
}
export async function acquireArchiveActor(stage: string, actor: string) {
  uuid.parse(actor);
  const root = path.dirname(stage),
    id = path.basename(stage);
  uuid.parse(id);
  const lease = await lock(root, `archive-actor-${id}-${actor}`);
  try {
    // ロック取得より先に親が消えても、回収済み stage を後発 worker が再作成しない。
    const manifest = await readManifest(root, id);
    await regular(stage, true);
    if (!manifest.actors.includes(actor)) throw new Error('unregistered-archive-actor');
    return lease;
  } catch (error) {
    await lease.close();
    throw error;
  }
}
export async function removeOwnedArchiveStage(stage: string) {
  const root = path.dirname(stage),
    id = path.basename(stage);
  await readManifest(root, id);
  try {
    await regular(stage, true);
    await fs.rm(stage, { recursive: true, force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.unlink(path.join(root, `${id}.json`));
}
export async function recoverArchiveStages(profile: string, verify: (manifest: ArchiveStageManifest) => Promise<boolean>, cleanup: (stage: string, manifest: ArchiveStageManifest) => Promise<void>, temporary = os.tmpdir()) {
  let owner: Awaited<ReturnType<typeof archiveStageRoot>>;
  try {
    owner = await archiveStageRoot(profile, temporary, false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
  const creation = await lock(owner.root, 'archive-stage-creation');
  let recovered = 0;
  try {
    const entries = await fs.opendir(owner.root);
    for await (const entry of entries) {
      const id = entry.name.replace(/\.json$/, '');
      if (!entry.name.endsWith('.json') || !uuid.safeParse(id).success) continue;
      const leases: RequestLock[] = [];
      try {
        leases.push(await lock(owner.root, `archive-stage-${id}`));
        const manifest = await readManifest(owner.root, id);
        for (const actor of manifest.actors) leases.push(await lock(owner.root, `archive-actor-${id}-${actor}`));
        const stage = path.join(owner.root, id);
        try {
          await regular(stage, true);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          await fs.unlink(path.join(owner.root, `${id}.json`));
          recovered++;
          continue;
        }
        if (!(await verify(manifest))) continue;
        // 全 actor の終了を確認したので登録を退役する。再回収の度に上限へ蓄積しない。
        manifest.actors = [];
        await writeJson(path.join(owner.root, `${id}.json`), manifest);
        await cleanup(stage, manifest);
        await removeOwnedArchiveStage(stage);
        recovered++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'request-in-progress') console.warn('Archive stage recovery retained', { stageId: id });
      } finally {
        for (const lease of leases.reverse()) await lease.close();
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally {
    await creation.close();
  }
  return recovered;
}
