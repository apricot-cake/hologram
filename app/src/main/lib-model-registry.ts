'use strict';

// The code-owned model registry (#832, parent #98) - the one place naming
// which model files exist, which Hugging Face revision they are pinned to, and
// the SHA-256 each file must hash to. Pure data plus pure helpers: nothing
// here touches the network or the filesystem. lib-model-fetch.ts and
// lib-model-manager.ts act on the entries this module hands out.
//
// rev is a Hugging Face COMMIT HASH, never a branch or tag (#832's rejected
// "track main" design - a tag can point at a different commit tomorrow, and
// pinning exists so the same app build always asks for the same bytes).
// sha256/bytes are measured once, at authoring time, from the pinned rev, and
// baked in here - not re-derived from Hugging Face's own metadata at runtime,
// which would make the value verification checks against the same value it
// is supposed to be catching drift in.

import path from 'node:path';

export interface ModelRegistryFile {
  /** Path relative to the model root, both on Hugging Face and on disk. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface ModelRegistryEntry {
  /** Hugging Face repo id, e.g. "Xenova/all-MiniLM-L6-v2". */
  id: string;
  /** Commit hash - never a branch or tag. */
  rev: string;
  files: ModelRegistryFile[];
  /** Shown in Settings -> AI Features and THIRD-PARTY-NOTICES.md. */
  licenseNote: string;
}

/**
 * The registry. One entry per model actually shipped; a feature Issue
 * (#48/#49/#50/#51) adds its own entry when it needs one.
 */
export const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    // The #831 smoke model - first real consumer is #165 (meaning-based tag
    // matching). scripts/test-ml-runtime.cts pins the same id/rev/files
    // independently (it cannot import this ESM module from its CJS/.cts
    // harness); scripts/model-registry.test.ts cross-checks the two stay in sync.
    id: 'Xenova/all-MiniLM-L6-v2',
    rev: '751bff37182d3f1213fa05d7196b954e230abad9',
    files: [
      { path: 'config.json', sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7', bytes: 650 },
      { path: 'tokenizer.json', sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0', bytes: 711661 },
      { path: 'tokenizer_config.json', sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3', bytes: 366 },
      { path: 'onnx/model_quantized.onnx', sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1', bytes: 22972370 },
    ],
    licenseNote: 'Apache License 2.0 - sentence-transformers/all-MiniLM-L6-v2 (ONNX port: Xenova/all-MiniLM-L6-v2)',
  },
];

/** Looks up one entry by Hugging Face repo id. */
export function findModelEntry(id: string, registry: ModelRegistryEntry[] = MODEL_REGISTRY): ModelRegistryEntry | undefined {
  return registry.find((e) => e.id === id);
}

/**
 * Where an entry's files live under modelsRoot(): "<org>/<name>@<rev>",
 * matching Hugging Face's own org/name split so the layout stays legible next
 * to the source it came from.
 */
export function modelDirFor(entry: Pick<ModelRegistryEntry, 'id' | 'rev'>, root: string): string {
  const segments = entry.id.split('/');
  const name = segments.pop();
  return path.join(root, ...segments, `${name}@${entry.rev}`);
}

/** The Hugging Face "resolve" URL for one file at the entry's pinned rev. */
export function modelFileUrl(entry: Pick<ModelRegistryEntry, 'id' | 'rev'>, file: Pick<ModelRegistryFile, 'path'>): string {
  return `https://huggingface.co/${entry.id}/resolve/${entry.rev}/${file.path}`;
}
