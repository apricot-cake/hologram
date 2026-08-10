'use strict';

// lib-model-registry.ts を lib-model-fetch.ts に対して指揮する（#832、親
// #98）: オプトインのゲート、モデルごとのディスク上の状態、ダウンロード、
// 削除。本番での呼び出し元は ipc-model.ts だけ。ここのすべてがオプションの
// レジストリ／root の上書きを受け取るので、テストが実際の config ディレクトリの
// models/ や、実際のレジストリエントリの23MBの onnx ファイルに触れることは
// 無い。
//
// このモジュールが意図してやらないこと:
//   - transformers.js や推論の子プロセス（lib-ml-runtime.ts、ml-worker.ts、
//     #831）と話すこと——ファイルを、その層が既に期待している場所
//     （modelsRoot() の `<org>/<name>@<rev>` というレイアウト）に置くだけ。
//   - ダウンロードの完了が何を意味するかを決めること: fetchModelFile の
//     ファイルごとの SHA-256 チェックが「正しい」を決める唯一の場所で、
//     新規ダウンロードでも、既に静止して壊れているファイルでも同じ
//     （宛先が既に存在するかどうかに関わらず、呼び出しのたびに同じ
//     チェックが走る——それ自身のコメント参照）。

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
   * このモデルの「別の」rev がディスク上にある（レジストリの固定 rev が
   * 進む前の、以前のダウンロード）。null でない時は情報提供のみ——#832 が
   * それを自動で取得することは決して無い。それが実務上の「自動更新では
   * なく再同意」という意味。
   */
  installedRev: string | null;
}

/** ダウンロードの実行中に push される。最後の（ループ後の）イベントでは `file` が null。 */
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

/** このモデルの、求められた rev 以外の `<name>@<rev>` という兄弟ディレクトリ。 */
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
      /* まだダウンロードされていない */
    }
  }
  const bytesTotal = entry.files.reduce((sum, f) => sum + f.bytes, 0);
  const state: ModelState = present === 0 ? 'absent' : present === entry.files.length ? 'complete' : 'partial';
  return { id: entry.id, rev: entry.rev, purpose: entry.purpose, state, bytesDone, bytesTotal, licenseNote: entry.licenseNote, installedRev: installedOtherRev(entry, root) };
}

/** コードに同梱された状態のレジストリ——設定の AI Features のモデル一覧が描くもの。 */
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

// モデル id ごとに進行中のダウンロードは1つ: 実行中に2回目の呼び出しが来ても、
// それと競合するのではなく同じ Promise に合流する（設定のボタンのダブル
// クリックや、起動途中でもう一度ダウンロードを呼ぶレンダラーの再マウント）。
const activeDownloads = new Map<string, Promise<ModelStatus>>();

export interface DownloadModelOptions extends ModelManagerDeps {
  onProgress?: (p: ModelDownloadProgress) => void;
  /** テスト／検証専用: #830 のオプトインチェック無しで実行する。 */
  skipGate?: boolean;
}

/**
 * 1つのレジストリエントリのすべてのファイルを順に取得する。ディスク上で
 * 既に正しいファイルはスキップし、残りは再開／修復する
 * （lib-model-fetch.ts 参照）。AI 機能が無効な時は、ネットワーク呼び出しの
 * 前に即座に reject する。
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

/** #832 がこのモデルのために置いたバイトをすべて削除する。何度実行しても同じ——無いモデルを削除してもエラーにはならない。 */
export async function deleteModel(id: string, deps: ModelManagerDeps = {}): Promise<void> {
  const registry = deps.registry ?? MODEL_REGISTRY;
  const root = deps.root ?? modelsRoot();
  const entry = entryOrThrow(id, registry);
  await fs.promises.rm(modelDirFor(entry, root), { recursive: true, force: true });
  const { parentDir } = orgDirOf(entry, root);
  try {
    if ((await fs.promises.readdir(parentDir)).length === 0) await fs.promises.rmdir(parentDir);
  } catch {
    /* 空ではない（別の rev か、兄弟モデル）、または既に無い */
  }
}
