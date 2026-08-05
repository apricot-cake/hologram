'use strict';

// The half of a cloud backup destination that is the same for every provider
// (#909, parent #233).
//
// A BackupDestination speaks relative paths ('avatars/x.jpg', '.trash/y.json').
// A consumer drive API speaks item ids and one folder at a time. Everything in
// this file exists to bridge those two, ONCE, so that Google Drive and OneDrive
// differ only in the primitives they hand over (CloudOps) — and so that the
// engine keeps its promise of having no provider branch in it (#909: "実装する
// のは既存インターフェースの5対だけ").
//
// The bridge is an index built by walking the destination tree once per run:
// relative path -> item id, plus the folder ids along the way. It is built
// lazily on first use and then reused, because the engine's own sequence
// (readIdentity -> list -> put/move/remove -> writeIdentity) would otherwise
// walk the whole tree twice, and a destination object lives exactly one run.
// Nothing else writes to the destination, so a cached index cannot go stale
// underneath us in the way a shared cache would.
//
// What is deliberately NOT here:
//   * retries beyond the transport's own (#233: the media lane is built so a
//     failed file is picked up by the next pass — "ここで凝らない").
//   * anything that logs a token, a URL carrying one, or a response body. Error
//     messages carry the provider's status and error CODE only (#237 audits it).

import fs from 'node:fs';

import { IDENTITY_FILE, TMP_RE } from './lib-backup-destination.ts';
import type { BackupDestination, DestinationEntry, DestinationIdentity } from './lib-backup-destination.ts';

/** One entry as the provider reports it. */
export interface CloudNode {
  readonly id: string;
  readonly name: string;
  readonly isFolder: boolean;
  /** 0 for folders. */
  readonly size: number;
  /** The client-side modification time we wrote, in epoch ms. */
  readonly mtimeMs: number;
}

/** What an upload carries: a library file, or a few bytes we hold in hand. */
export type CloudSource = { readonly kind: 'file'; readonly path: string; readonly size: number } | { readonly kind: 'bytes'; readonly data: Buffer };

/**
 * The per-provider primitives. Small on purpose: every rule that could be got
 * wrong in two different ways (which entries are hidden from list(), how a
 * relative path becomes a folder chain, what a move does to the index) lives
 * above this line, not below it.
 */
export interface CloudOps {
  readonly kind: string;
  readonly location: string;
  /** The destination root's id, creating the folder when this is a first run. */
  ensureRoot(): Promise<string>;
  children(folderId: string): Promise<CloudNode[]>;
  createFolder(parentId: string, name: string): Promise<string>;
  /** Returns the id of the uploaded item (new or replaced). */
  upload(target: { parentId: string; name: string; existingId: string | null }, source: CloudSource, mtimeMs: number | null): Promise<string>;
  download(id: string): Promise<Buffer>;
  move(id: string, from: { parentId: string }, to: { parentId: string; name: string }): Promise<void>;
  remove(id: string): Promise<void>;
}

interface CloudIndex {
  rootId: string;
  /** Relative path -> the file's id and what the provider reports about it. */
  files: Map<string, { id: string; size: number; mtimeMs: number }>;
  /** Relative path -> folder id; '' is the destination root. */
  folders: Map<string, string>;
  /** The identity file's id, kept apart so it never reaches list(). */
  identityId: string | null;
}

function splitRel(rel: string): { parentRel: string; name: string } {
  const cut = rel.lastIndexOf('/');
  return cut === -1 ? { parentRel: '', name: rel } : { parentRel: rel.slice(0, cut), name: rel.slice(cut + 1) };
}

/**
 * Wraps a provider's primitives as the destination the engine drives.
 *
 * One instance is one run: the index it caches is only valid for as long as
 * this object is the only writer, which is exactly a run's lifetime.
 */
function createCloudDestination(ops: CloudOps): BackupDestination {
  let building: Promise<CloudIndex> | null = null;

  async function walk(): Promise<CloudIndex> {
    const rootId = await ops.ensureRoot();
    const index: CloudIndex = { rootId, files: new Map(), folders: new Map([['', rootId]]), identityId: null };
    const queue: Array<{ rel: string; id: string }> = [{ rel: '', id: rootId }];
    while (queue.length) {
      const dir = queue.shift() as { rel: string; id: string };
      for (const node of await ops.children(dir.id)) {
        // Half-written uploads from an interrupted run, same as the local
        // adapter skips its own .tmp artifacts.
        if (TMP_RE.test(node.name)) continue;
        const rel = dir.rel ? `${dir.rel}/${node.name}` : node.name;
        if (node.isFolder) {
          index.folders.set(rel, node.id);
          queue.push({ rel, id: node.id });
          continue;
        }
        // The destination's own bookkeeping. Reachable through readIdentity()
        // and never through list(), because the engine deletes destination
        // entries the library has no counterpart for — and this one is not
        // supposed to have one (#176).
        if (!dir.rel && node.name === IDENTITY_FILE) {
          index.identityId = node.id;
          continue;
        }
        index.files.set(rel, { id: node.id, size: node.size, mtimeMs: node.mtimeMs });
      }
    }
    return index;
  }

  function ensureIndex(): Promise<CloudIndex> {
    if (!building) building = walk();
    return building;
  }

  /** The folder id for a relative path, creating the chain when it is new. */
  async function ensureFolder(index: CloudIndex, rel: string): Promise<string> {
    const known = index.folders.get(rel);
    if (known) return known;
    const { parentRel, name } = splitRel(rel);
    const parentId = await ensureFolder(index, parentRel);
    const id = await ops.createFolder(parentId, name);
    index.folders.set(rel, id);
    return id;
  }

  return {
    kind: ops.kind,
    location: ops.location,
    async list() {
      const index = await ensureIndex();
      const out = new Map<string, DestinationEntry>();
      for (const [rel, f] of index.files) out.set(rel, { size: f.size, mtimeMs: f.mtimeMs });
      return out;
    },
    async put(rel, srcFile, mtimeMs) {
      const index = await ensureIndex();
      const { parentRel, name } = splitRel(rel);
      const parentId = await ensureFolder(index, parentRel);
      const stat = await fs.promises.stat(srcFile);
      const stamp = Math.floor(typeof mtimeMs === 'number' ? mtimeMs : stat.mtimeMs);
      const existingId = index.files.get(rel)?.id ?? null;
      const id = await ops.upload({ parentId, name, existingId }, { kind: 'file', path: srcFile, size: stat.size }, stamp);
      index.files.set(rel, { id, size: stat.size, mtimeMs: stamp });
    },
    async move(fromRel, toRel) {
      const index = await ensureIndex();
      const entry = index.files.get(fromRel);
      // Not "already done": the engine only ever plans a move for an entry it
      // just saw in list(), so a miss means our picture and the destination
      // have diverged, and moving the wrong item is worse than failing (the
      // next pass copies the file and prunes the stale name).
      if (!entry) throw new Error(`nothing at ${fromRel} to move`);
      const fromParentId = await ensureFolder(index, splitRel(fromRel).parentRel);
      const { parentRel, name } = splitRel(toRel);
      const toParentId = await ensureFolder(index, parentRel);
      await ops.move(entry.id, { parentId: fromParentId }, { parentId: toParentId, name });
      index.files.delete(fromRel);
      index.files.set(toRel, entry);
    },
    async remove(rel) {
      const index = await ensureIndex();
      const entry = index.files.get(rel);
      if (!entry) return; // already gone — the engine treats this as done
      await ops.remove(entry.id);
      index.files.delete(rel);
    },
    async readIdentity() {
      const index = await ensureIndex();
      if (!index.identityId) return null;
      try {
        const parsed = JSON.parse((await ops.download(index.identityId)).toString('utf8'));
        const libraryId = parsed?.libraryId;
        // Same reading as the local adapter: an identity we cannot make sense
        // of is "unclaimed", not "belongs to someone else". Refusing every
        // future run over one corrupt byte is the worse failure.
        if (typeof libraryId !== 'string' || !libraryId) return null;
        return { libraryId, lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null };
      } catch {
        return null;
      }
    },
    async writeIdentity(identity: DestinationIdentity) {
      const index = await ensureIndex();
      const data = Buffer.from(`${JSON.stringify(identity, null, 2)}\n`, 'utf8');
      index.identityId = await ops.upload({ parentId: index.rootId, name: IDENTITY_FILE, existingId: index.identityId }, { kind: 'bytes', data }, null);
    },
  };
}

// --- the transport both providers share -----------------------------------
//
// Tokens reach this file and stop here: the vault hands over an accessToken()
// and nothing gives one back out (#233's 2/7 item 2 — tokens never leave the
// main process, and nothing below writes one into a message or a log).

export interface CloudAuth {
  /**
   * A token that is good right now. `force` is the answer to a 401: the token
   * we hold was rejected, so refresh even though it did not look expired.
   */
  accessToken(force?: boolean): Promise<string>;
  /** Injected so a suite can stand up a fake API; defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Base backoff between retries (suites shrink it). */
  retryBaseMs?: number;
}

export interface CloudRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer | null;
  /** Statuses that are an answer rather than a failure (308, 202, 404…). */
  readonly accept?: readonly number[];
  /**
   * Sends no Authorization header. Required for OneDrive's upload session URLs,
   * which answer 401 to a request that carries one.
   */
  readonly anonymous?: boolean;
}

const MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Honours Retry-After (seconds or HTTP-date) when the provider sends one. */
function retryDelayMs(res: Response | null, attempt: number, base: number): number {
  const header = res?.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 0), 60_000);
  }
  return base * 2 ** attempt;
}

/**
 * The provider's own error code, and nothing else. Both providers answer with
 * `{ error: { code, message } }` (Google adds a numeric code and a `status`);
 * the message can quote request content, so it does not travel into an Error
 * that ends up in a log or a config file.
 */
function errorCode(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown; error_description?: unknown };
    const err = body.error;
    if (typeof err === 'string') return err;
    const detail = (err ?? {}) as { code?: unknown; status?: unknown; errors?: Array<{ reason?: unknown }> };
    if (typeof detail.status === 'string') return detail.status;
    if (typeof detail.code === 'string') return detail.code;
    const reason = detail.errors?.[0]?.reason;
    if (typeof reason === 'string') return reason;
  } catch {
    /* not JSON — the status alone has to do */
  }
  return '';
}

export class CloudApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(kind: string, status: number, code: string) {
    super(`${kind} API ${status}${code ? ` (${code})` : ''}`);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
  }
}

/** Retryable at the status level: rate limits and the provider being unwell. */
const isTransient = (status: number) => status === 429 || (status >= 500 && status < 600);

/**
 * One authorized request, with the small amount of retrying that a backup run
 * benefits from. Anything past that is the next run's job by design (#233).
 */
function createCloudHttp(kind: string, auth: CloudAuth) {
  const doFetch = auth.fetch ?? globalThis.fetch;
  const base = auth.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;

  return async function request(req: CloudRequest): Promise<Response> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const headers: Record<string, string> = { ...(req.headers ?? {}) };
        if (!req.anonymous) headers.authorization = `Bearer ${await auth.accessToken(refreshed)}`;
        // Cast rather than copy: the main-process project types fetch from
        // undici (where a Buffer is a valid body) and the test project mirrors
        // the renderer's DOM lib (where it is not). Copying every chunk into a
        // fresh view to satisfy the stricter of the two would double the memory
        // an upload touches.
        const init = { method: req.method ?? 'GET', headers, body: req.body ?? null } as unknown as Parameters<typeof globalThis.fetch>[1];
        res = await doFetch(req.url, init);
      } catch (err) {
        // No network, DNS, a dropped socket mid-upload. Same treatment as a
        // 5xx: try again a couple of times, then let the run record it.
        if (attempt + 1 >= MAX_ATTEMPTS) throw err;
        await sleep(retryDelayMs(null, attempt, base));
        continue;
      }
      if (res.ok || req.accept?.includes(res.status)) return res;
      // A rejected token is worth exactly one forced refresh: the grant may
      // have been rotated since the run started. A second 401 is a real one.
      if (res.status === 401 && !req.anonymous && !refreshed) {
        refreshed = true;
        await res.text();
        continue;
      }
      if (isTransient(res.status) && attempt + 1 < MAX_ATTEMPTS) {
        const wait = retryDelayMs(res, attempt, base);
        await res.text();
        await sleep(wait);
        continue;
      }
      throw new CloudApiError(kind, res.status, errorCode(await res.text().catch(() => '')));
    }
  };
}

export type CloudHttp = ReturnType<typeof createCloudHttp>;

export { createCloudDestination, createCloudHttp, splitRel };
