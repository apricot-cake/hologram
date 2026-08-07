'use strict';

// Orchestrates lib-model-registry.ts against lib-model-fetch.ts (#832, parent
// #98): the opt-in gate, per-model on-disk status, download, and deletion.
// ipc-model.ts is the only caller in production; everything here takes an
// optional registry/root override so tests never touch the real config dir's
// models/ or the real registry entry's 23MB onnx file.
//
// What this module deliberately does NOT do:
//   - talk to transformers.js or the inference child (lib-ml-runtime.ts,
//     ml-worker.ts, #831) — it only places files where that layer already
//     expects them (modelsRoot()'s `<org>/<name>@<rev>` layout).
//   - decide what a completed download IS: fetchModelFile's per-file SHA-256
//     check is the one place "correct" is decided, both for a fresh download
//     and for a corrupted file already sitting at rest (the same check runs
//     on a call whether or not the destination already exists — see its own
//     comment).

import fs from 'node:fs';
import path from 'node:path';

import { aiFeaturesEnabled, modelsRoot } from './lib-ml-runtime.ts';
import { fetchModelFile } from './lib-model-fetch.ts';
import { findModelEntry, modelDirFor, modelFileUrl, MODEL_REGISTRY, type ModelPurpose, type ModelRegistryEntry } from './lib-model-registry.ts';

export type ModelState = 'absent' | 'partial' | 'complete';

export interface ModelStatus {
  id: string;
  rev: string;
  purpose: ModelPurpose;
  state: ModelState;
  bytesDone: number;
  bytesTotal: number;
  licenseNote: string;
  /**
   * A DIFFERENT rev of this model sits on disk (an earlier download from
   * before the registry's pinned rev moved on). Non-null only informs — #832
   * never fetches it automatically; that is what "re-consent, not
   * auto-update" means in practice.
   */
  installedRev: string | null;
}

/** Pushed while a download runs; `file` is null on the final (post-loop) event. */
export interface ModelDownloadProgress extends ModelStatus {
  file: string | null;
}

export interface ModelManagerDeps {
  registry?: ModelRegistryEntry[];
  root?: string;
}

function entryOrThrow(id: string, registry: ModelRegistryEntry[]): ModelRegistryEntry {
  const entry = findModelEntry(id, registry);
  if (!entry) throw new Error(`unknown model: ${id}`);
  return entry;
}

function orgDirOf(entry: Pick<ModelRegistryEntry, 'id'>, root: string): { parentDir: string; name: string } {
  const segments = entry.id.split('/');
  const name = segments.pop() as string;
  return { parentDir: path.join(root, ...segments), name };
}

/** Another `<name>@<rev>` sibling directory for this model, at a rev other than the one asked for. */
function installedOtherRev(entry: Pick<ModelRegistryEntry, 'id' | 'rev'>, root: string): string | null {
  const { parentDir, name } = orgDirOf(entry, root);
  let names: string[];
  try {
    names = fs.readdirSync(parentDir);
  } catch {
    return null;
  }
  const prefix = `${name}@`;
  const other = names.find((n) => n.startsWith(prefix) && n !== `${prefix}${entry.rev}`);
  return other ? other.slice(prefix.length) : null;
}

function statusFor(entry: ModelRegistryEntry, root: string): ModelStatus {
  const dir = modelDirFor(entry, root);
  let bytesDone = 0;
  let present = 0;
  for (const f of entry.files) {
    try {
      bytesDone += fs.statSync(path.join(dir, f.path)).size;
      present++;
    } catch {
      /* not downloaded (yet) */
    }
  }
  const bytesTotal = entry.files.reduce((sum, f) => sum + f.bytes, 0);
  const state: ModelState = present === 0 ? 'absent' : present === entry.files.length ? 'complete' : 'partial';
  return { id: entry.id, rev: entry.rev, purpose: entry.purpose, state, bytesDone, bytesTotal, licenseNote: entry.licenseNote, installedRev: installedOtherRev(entry, root) };
}

/** The registry as shipped in code — what Settings' AI Features model list renders. */
export function listModelRegistry(registry: ModelRegistryEntry[] = MODEL_REGISTRY): ModelRegistryEntry[] {
  return registry;
}

export function getModelStatus(id: string, deps: ModelManagerDeps = {}): ModelStatus {
  const registry = deps.registry ?? MODEL_REGISTRY;
  const root = deps.root ?? modelsRoot();
  return statusFor(entryOrThrow(id, registry), root);
}

export function listModelStatuses(deps: ModelManagerDeps = {}): ModelStatus[] {
  const registry = deps.registry ?? MODEL_REGISTRY;
  const root = deps.root ?? modelsRoot();
  return registry.map((e) => statusFor(e, root));
}

// One in-flight download per model id: a second call while one is running
// joins the same promise rather than racing it (double-click on the Settings
// button, or a renderer re-mount that calls download again on the way up).
const activeDownloads = new Map<string, Promise<ModelStatus>>();

export interface DownloadModelOptions extends ModelManagerDeps {
  onProgress?: (p: ModelDownloadProgress) => void;
  /** Test/verification only: run without the #830 opt-in check. */
  skipGate?: boolean;
}

/**
 * Fetches every file of one registry entry, in order, skipping files already
 * correct on disk and resuming/repairing the rest (see lib-model-fetch.ts).
 * Rejects immediately, before any network call, when AI features are off.
 */
export function downloadModel(id: string, opts: DownloadModelOptions = {}): Promise<ModelStatus> {
  if (!opts.skipGate && !aiFeaturesEnabled()) return Promise.reject(new Error('AI features are not enabled'));

  const already = activeDownloads.get(id);
  if (already) return already;

  const registry = opts.registry ?? MODEL_REGISTRY;
  const root = opts.root ?? modelsRoot();
  const entry = entryOrThrow(id, registry);
  const dir = modelDirFor(entry, root);
  const bytesTotal = entry.files.reduce((sum, f) => sum + f.bytes, 0);

  const run = (async () => {
    let bytesFromEarlierFiles = 0;
    for (const file of entry.files) {
      await fetchModelFile(modelFileUrl(entry, file), path.join(dir, file.path), file.sha256, (p) => {
        opts.onProgress?.({
          id: entry.id,
          rev: entry.rev,
          purpose: entry.purpose,
          state: 'partial',
          bytesDone: bytesFromEarlierFiles + p.bytesDone,
          bytesTotal,
          licenseNote: entry.licenseNote,
          installedRev: null,
          file: file.path,
        });
      });
      bytesFromEarlierFiles += file.bytes;
    }
    const status = statusFor(entry, root);
    opts.onProgress?.({ ...status, file: null });
    return status;
  })();

  const tracked = run.finally(() => activeDownloads.delete(id));
  activeDownloads.set(id, tracked);
  return tracked;
}

/** Removes every byte #832 placed for this model. Idempotent — deleting an absent model is not an error. */
export async function deleteModel(id: string, deps: ModelManagerDeps = {}): Promise<void> {
  const registry = deps.registry ?? MODEL_REGISTRY;
  const root = deps.root ?? modelsRoot();
  const entry = entryOrThrow(id, registry);
  await fs.promises.rm(modelDirFor(entry, root), { recursive: true, force: true });
  const { parentDir } = orgDirOf(entry, root);
  try {
    if ((await fs.promises.readdir(parentDir)).length === 0) await fs.promises.rmdir(parentDir);
  } catch {
    /* not empty (another rev, or a sibling model), or already gone */
  }
}
