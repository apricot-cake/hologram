'use strict';

// The index execution queue (#834, parent #98): the ONE thing in the app that
// walks the library in the background.
//
// #48 (colour), #49 (OCR / text extraction), #50 (AI tags) and #51 (visual
// search) each need every record processed once. Four separate sweeps would run
// at the same time and fight each other for the main thread, and each would have
// to re-invent the same four decisions — how many at once, in what priority,
// how to stop, what counts as already done. This module owns those; a feature
// only registers a job kind (lib-index-jobs.ts) and says what it computes.
//
// Two entry points feed it, and NEITHER keeps its own record of progress:
//
//   - new saves: the "records changed" broadcast triggers a scan limited to rows
//     whose updatedAt moved since the last scan.
//   - backfill: the whole library, walked in chunks.
//
// Resumability comes from the derived store, not from a cursor (#834's rejected
// alternative, and #98's 2026-08-02 comment §3): whether a job still has work is
// derived from derived_progress's indexedSegments/totalSegments. A crash mid-
// backfill therefore costs a re-scan, not re-processing — and there is no second
// piece of state that can disagree with the first about how far we got. The
// `since` stamp below is the only in-memory shortcut, and it is an optimisation
// only: forget it and the scan merely covers more rows than it had to.
//
// Electron-free — every side effect (database, filesystem, logging, the renderer
// push) arrives as a dependency, so the whole state machine unit-tests in plain
// node.

import { candidateKey, planRecord, resolveInput, type IndexCandidate, type IndexJobKind, type IndexProgressRow, type IndexRecord, type ResolveInputDeps } from './lib-index-jobs.ts';
import type { JobPool } from './lib-job-pool.ts';
import type { IndexQueueStatus } from './ipc-payloads.ts';

export type { IndexQueueStatus };

export interface IndexProgressWrite {
  captureId: string;
  assetRef: string;
  jobKind: string;
  modelId: string | null;
  modelRev: string | null;
  indexedSegments: number;
  totalSegments: number;
}

export interface IndexQueueDeps {
  pool: JobPool;
  /** #830's opt-in flag, read per plan so toggling it takes effect immediately. */
  aiEnabled(): boolean;
  /**
   * captureIds of records that may need work. `since` is an updatedAt bound
   * (null = the whole library); the returned maxUpdatedAt becomes the next bound.
   */
  listCaptureIds(since: string | null): { ids: string[]; maxUpdatedAt: string | null };
  recordsByIds(ids: string[]): IndexRecord[];
  progressOf(captureId: string, assetRef: string, jobKind: string): IndexProgressRow | undefined;
  saveProgress(row: IndexProgressWrite): void;
  resolve: ResolveInputDeps;
  onJobError(candidate: IndexCandidate, err: unknown): void;
  onStatusChange(status: IndexQueueStatus): void;
}

// One chunk of captureIds per scan job. Big enough that a 9k library is ~45
// scan jobs rather than 9k, small enough that a chunk's plan (which reads
// derived_progress once per asset × kind) stays a short synchronous burst
// between the pool's setImmediate yields.
const SCAN_CHUNK = 200;
// Status is pushed to the renderer; a per-job push would be one IPC message per
// decoded image. Coalesce instead — the indicator is a progress bar, not a log.
const STATUS_COALESCE_MS = 250;
// The scan runs ahead of the jobs (it is cheap: indexed reads only), so without
// a ceiling a full backfill would materialise a candidate — and the record it
// carries — for the entire library before the first job finished. Pause the walk
// while this many are outstanding and resume as they drain; the queue depth,
// not the library size, is what bounds memory.
const MAX_QUEUE_DEPTH = 500;

const kinds = new Map<string, IndexJobKind>();

let deps: IndexQueueDeps | null = null;
let queued = new Set<string>();
let scanIds: string[] = [];
let scanning = false;
let sinceStamp: string | null = null;
let paused = false;
let done = 0;
let total = 0;
let currentKind: string | null = null;
let statusTimer: NodeJS.Timeout | null = null;

/**
 * Adds a job kind. Feature Issues call this at startup; the queue itself never
 * knows what any kind computes. Re-registering the same id replaces it, so a
 * hot-reloaded dev build does not end up with two of everything.
 */
export function registerIndexJobKind(kind: IndexJobKind): void {
  kinds.set(kind.id, kind);
}

export function registeredIndexJobKinds(): IndexJobKind[] {
  return [...kinds.values()];
}

export function indexQueueStatus(): IndexQueueStatus {
  return {
    active: total > done || scanning || scanIds.length > 0,
    paused,
    scanning: scanning || scanIds.length > 0,
    done,
    total,
    currentKind,
  };
}

function emitStatus(immediate = false) {
  if (!deps) return;
  if (immediate) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    deps.onStatusChange(indexQueueStatus());
    return;
  }
  if (statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    deps?.onStatusChange(indexQueueStatus());
  }, STATUS_COALESCE_MS);
}

/** Everything drained — the counters are per-run, so the next run starts at 0/0. */
function settleIfIdle() {
  if (total > done || scanning || scanIds.length > 0) return;
  done = 0;
  total = 0;
  currentKind = null;
  emitStatus(true);
}

function enqueue(candidates: IndexCandidate[]) {
  const d = deps;
  if (!d) return;
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (queued.has(key)) continue;
    queued.add(key);
    total++;
    void runCandidate(d, candidate, key);
  }
  if (candidates.length) emitStatus();
}

async function runCandidate(d: IndexQueueDeps, candidate: IndexCandidate, key: string) {
  const kind = kinds.get(candidate.jobKind);
  try {
    await d.pool.run(
      async () => {
        if (!kind) return;
        currentKind = kind.id;
        const resolved = await resolveInput(candidate, kind, d.resolve);
        if (!resolved.ok) {
          // No progress row is written for a resolution failure, on purpose: an
          // empty/oversize/missing input is a fact about the FILE, not a result,
          // and re-deciding it costs one stat (the thumbnail path additionally
          // hits lib-thumbnails.ts's own negative-result cache). Writing a
          // "failed" marker would invent a third state that #833's schema
          // deliberately does not have, and would keep a file excluded after the
          // reason for excluding it went away.
          return;
        }
        const result = await kind.run(resolved.input, { record: candidate.record, asset: candidate.asset, fromSegment: candidate.fromSegment });
        d.saveProgress({
          captureId: candidate.record.captureId,
          assetRef: candidate.asset.ref,
          jobKind: kind.id,
          modelId: result.modelId ?? null,
          modelRev: result.modelRev ?? null,
          indexedSegments: result.indexedSegments,
          totalSegments: result.totalSegments,
        });
      },
      { priority: 'background' },
    );
  } catch (err) {
    // Left without a progress row for the same reason as above — a transient
    // failure retries on the next backfill rather than being remembered as a
    // result.
    d.onJobError(candidate, err);
  } finally {
    queued.delete(key);
    done++;
    emitStatus();
    // The walk stopped at MAX_QUEUE_DEPTH — this drain is what lets it continue.
    if (!paused && scanIds.length) scheduleScan();
    settleIfIdle();
  }
}

function scheduleScan() {
  const d = deps;
  if (!d || scanning || paused || !scanIds.length) return;
  if (total - done >= MAX_QUEUE_DEPTH) return; // runCandidate's drain resumes it
  scanning = true;
  void d.pool
    .run(
      () => {
        const chunk = scanIds.splice(0, SCAN_CHUNK);
        const kindList = registeredIndexJobKinds();
        if (!kindList.length) return;
        const aiEnabled = d.aiEnabled();
        for (const record of d.recordsByIds(chunk)) {
          const { run } = planRecord(record, kindList, { aiEnabled, progressOf: d.progressOf });
          enqueue(run);
        }
      },
      { priority: 'background' },
    )
    .catch(() => {
      // A scan chunk that throws costs those records this pass; the next
      // backfill re-walks them (nothing was written, so nothing is lost).
    })
    .finally(() => {
      scanning = false;
      scheduleScan();
      emitStatus();
      settleIfIdle();
    });
}

/**
 * Walks the library and queues whatever still has work.
 *
 * `full` re-walks everything (startup, and after the AI opt-in is turned on —
 * records skipped as 'ai-disabled' are not remembered anywhere, so they have to
 * be re-decided). Without it the walk is limited to rows whose updatedAt moved
 * since the last scan, which is what a save triggers.
 */
export function requestBackfill(opts: { full?: boolean } = {}): void {
  const d = deps;
  if (!d) return;
  const { ids, maxUpdatedAt } = d.listCaptureIds(opts.full ? null : sinceStamp);
  if (maxUpdatedAt && (!sinceStamp || maxUpdatedAt > sinceStamp)) sinceStamp = maxUpdatedAt;
  if (!ids.length) return;
  scanIds = scanIds.concat(ids);
  emitStatus(true);
  if (!paused) scheduleScan();
}

/** The save-delta hook: something changed, look at what moved. */
export function notifyRecordsChanged(): void {
  requestBackfill();
}

export function pauseIndexQueue(): void {
  if (paused) return;
  paused = true;
  deps?.pool.pauseBackground();
  emitStatus(true);
}

export function resumeIndexQueue(): void {
  if (!paused) return;
  paused = false;
  deps?.pool.resumeBackground();
  scheduleScan();
  emitStatus(true);
}

/**
 * Starts the queue. Called once per process; the initial full backfill is what
 * picks up everything that existed before this build (and everything a previous
 * run was interrupted in the middle of).
 */
export function startIndexQueue(d: IndexQueueDeps): void {
  deps = d;
  requestBackfill({ full: true });
}

/**
 * Drops queued work and the scan bound — for a library switch (#176), where
 * every captureId in flight belongs to a library that is no longer open.
 * In-flight jobs still finish; their progress rows are keyed by captureId, which
 * is unique across libraries, so a late write lands harmlessly.
 */
export function clearIndexQueue(): void {
  deps?.pool.clearBackground();
  queued = new Set();
  scanIds = [];
  sinceStamp = null;
  done = 0;
  total = 0;
  currentKind = null;
  emitStatus(true);
}

/** Test-only: forgets deps, kinds and all state. */
export function resetIndexQueueForTest(): void {
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = null;
  kinds.clear();
  deps = null;
  queued = new Set();
  scanIds = [];
  scanning = false;
  sinceStamp = null;
  paused = false;
  done = 0;
  total = 0;
  currentKind = null;
}
