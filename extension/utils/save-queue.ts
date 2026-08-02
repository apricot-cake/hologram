// Retry queue for a save whose bridge send never reached the native host
// (#203). When bridgeSend rejects WITHOUT ever having read an answer —
// connectNative threw, the port disconnected with no reply, or the send
// timed out — the request that would have gone over the wire (screenshot or
// image bytes included) is stashed here, and resent once the host is
// reachable again instead of being lost. Without this, the one fix the
// failure banner can offer (register the host, restart Chrome) also throws
// away the very capture the user was trying to save.
//
// Scope, deliberately narrow — the 2026-08-02 comment on Issue #203 is the
// current design record; this header only summarizes the reasoning that
// comment already gives in full:
//
//   - Only the 'save' and 'saveDragged' host-request shapes are ever queued.
//     'savePost' (bulk intake, and the video/gif branch of a dragged save)
//     never is: its caller can re-run the whole list, and an unreachable
//     host during a bulk run fails hundreds of saves in one stroke — enough
//     to spend this queue's entire byte budget on a single event.
//   - "Unreachable" is a MECHANISM — connectNative threw, no reply ever
//     arrived, or the send timed out — never a match on the host's error
//     TEXT. native-error.ts's string classification is deliberately narrow
//     and brittle to a Chrome wording change; retry eligibility must not
//     inherit that brittleness. background.ts's bridgeSend tags the errors
//     that qualify with `.unreachable`, and this module trusts only that.
//   - One chrome.storage.local KEY PER ENTRY, never one array key holding
//     them all: two saves failing at once must not race a read-modify-write
//     of the same array and silently drop one. background.ts's own
//     diagnostic-log stash (stashLogLocally) already made this call for the
//     same reason; the key shape here matches it on purpose.
//   - The budget is BYTES, not a count. A queued payload can be a multi-MB
//     screenshot plus #292's raw API payload, and chrome.storage.local's
//     whole quota (~10MiB) is shared with the diagnostic ring buffer
//     (background.ts's DIAG_PREFIX). A count cap alone never guaranteed the
//     entries it allowed would actually fit.
import type { SavedEntry, SaveDraggedRequest, SaveRequest } from '../../native-host/protocol.mts';
import type { SaveLogEntry } from './capture-log.ts';
import { NATIVE_HOST } from './native-host.ts';

export const SAVE_QUEUE_PREFIX = 'savequeue_';
// Half of chrome.storage.local's ~10MiB quota — the other half is headroom
// for the diagnostic ring buffer (background.ts's DIAG_PREFIX, DIAG_KEEP)
// sharing the same store, and for the small overhead chrome.storage.local
// itself charges per key on top of the JSON payload measured here.
export const SAVE_QUEUE_BUDGET_BYTES = 5 * 1024 * 1024;
// A secondary, count-based ceiling: without it a long run of very small
// payloads (a dragged illustration, no rawPayloads) could keep growing well
// past what is reasonable just because each one is cheap in bytes.
export const SAVE_QUEUE_MAX_ENTRIES = 20;
// After this many unreachable attempts, an entry is marked given-up rather
// than retried forever — see gaveUp below.
export const SAVE_QUEUE_MAX_TRIES = 5;

type QueueableRequest = SaveRequest | SaveDraggedRequest;

export interface QueuedSaveEntry {
  v: 1;
  ts: string; // ISO — also embedded in the storage key, so eviction can sort by the key alone
  // The NATIVE_HOST this entry was stashed for (#732: dev and release builds
  // talk to different host names and different libraries even though they
  // share one chrome.storage). A resend only ever considers entries whose
  // `host` matches the CURRENT NATIVE_HOST.
  host: string;
  type: QueueableRequest['type'];
  payload: QueueableRequest;
  tries: number;
  // Set once tries reaches SAVE_QUEUE_MAX_TRIES — see the module comment
  // this key sits under. A given-up entry is left in place (not deleted) so
  // the diagnostics page can still count it; it ages out through the same
  // oldest-first eviction as everything else, never on its own schedule.
  gaveUp?: boolean;
  // Set when the degrade step (see stashFailedSave) had to drop #292's raw
  // payloads to make this entry fit the budget. Recorded so a resend does
  // not silently write a record thinner than what the failure banner's
  // "will save automatically" implied.
  rawPayloadsDropped?: boolean;
}

export type SaveQueueLogger = (entry: SaveLogEntry, keepLocal?: boolean) => void;

// --- chrome.storage.local, promisified ------------------------------------------

function storageGet(keys: string[] | null): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (all) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(all || {});
    });
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function storageRemove(keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

// UTF-8 byte length, not UTF-16 code units (`.length` would undercount every
// non-ASCII character a post's text can carry) — matches the unit the quota
// itself is denominated in.
function byteSizeOf(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

interface QueueRow {
  key: string;
  entry: QueuedSaveEntry;
  size: number;
}

// Every queue entry currently in storage, oldest first — lexical key order is
// chronological order, same trick the diagnostic ring buffer's keys use, so
// "drop the oldest" never needs its own sort of `ts`.
function queueRowsOf(all: Record<string, unknown>): QueueRow[] {
  return Object.keys(all)
    .filter((k) => k.startsWith(SAVE_QUEUE_PREFIX))
    .sort()
    .map((key) => ({ key, entry: all[key] as QueuedSaveEntry, size: byteSizeOf(all[key]) }));
}

function hasRawPayloads(payload: QueueableRequest): boolean {
  return Array.isArray(payload.metadata?.rawPayloads) && payload.metadata.rawPayloads.length > 0;
}

function withoutRawPayloads(payload: QueueableRequest): QueueableRequest {
  return { ...payload, metadata: { ...payload.metadata, rawPayloads: [] } };
}

// --- stash -----------------------------------------------------------------------

// Called from background.ts's bridge catch, once per save whose send was
// tagged `.unreachable`. Resolves true when the entry is now in storage and
// eligible for a later resend, false when nothing could be kept — the two
// answers are what the failure banner's wording (i18n.ts's bannerQueued /
// bannerNotQueued) is chosen from, so a caller must never guess one.
export async function stashFailedSave(payload: QueueableRequest, log: SaveQueueLogger): Promise<boolean> {
  const ts = new Date().toISOString();
  let candidatePayload = payload;
  let rawPayloadsDropped = false;
  let size = byteSizeOf({ v: 1, ts, host: NATIVE_HOST, type: payload.type, payload: candidatePayload, tries: 0 });

  // Degrade step 1 (#203 design comment #1): the record itself outranks the
  // acquisition originals — drop rawPayloads and measure again before giving
  // up on the whole entry.
  if (size > SAVE_QUEUE_BUDGET_BYTES && hasRawPayloads(payload)) {
    candidatePayload = withoutRawPayloads(payload);
    rawPayloadsDropped = true;
    size = byteSizeOf({ v: 1, ts, host: NATIVE_HOST, type: payload.type, payload: candidatePayload, tries: 0 });
  }

  if (size > SAVE_QUEUE_BUDGET_BYTES) {
    // Degrade step 2: even alone, and even without the raw payloads, this
    // entry cannot fit the budget. Holding it would only ever crowd out
    // entries that could — and retrying later changes nothing about its
    // size — so the save is not queued at all.
    log({ stage: 'queue', phase: 'fail', reason: 'too-large', type: payload.type, bytes: size }, true);
    return false;
  }

  const entry: QueuedSaveEntry = { v: 1, ts, host: NATIVE_HOST, type: payload.type, payload: candidatePayload, tries: 0 };
  if (rawPayloadsDropped) entry.rawPayloadsDropped = true;

  try {
    const rows = queueRowsOf(await storageGet(null));
    let totalBytes = rows.reduce((sum, row) => sum + row.size, 0) + size;
    let count = rows.length + 1;
    const evicted: string[] = [];
    let i = 0;
    // Oldest-first eviction until the new entry fits both bounds. Always
    // terminates: the candidate alone already passed the budget check above,
    // so evicting every existing row (i reaches rows.length) leaves exactly
    // one entry, which is under both the byte and the count ceiling.
    while ((totalBytes > SAVE_QUEUE_BUDGET_BYTES || count > SAVE_QUEUE_MAX_ENTRIES) && i < rows.length) {
      const oldest = rows[i];
      i++;
      if (!oldest) continue; // unreachable (i < rows.length just held) — satisfies noUncheckedIndexedAccess
      totalBytes -= oldest.size;
      count -= 1;
      evicted.push(oldest.key);
    }
    if (evicted.length) {
      await storageRemove(evicted);
      log({ stage: 'queue', phase: 'evict', count: evicted.length }, true);
    }
    const key = `${SAVE_QUEUE_PREFIX}${ts}_${Math.floor(Math.random() * 1e6)}`;
    await storageSet({ [key]: entry });
    return true;
  } catch (err) {
    // A write can still fail (a QUOTA_BYTES race with the diagnostic ring
    // buffer's own writes, in particular) even after this function's own
    // budget math said it should fit. Discarded, not retried — see the
    // module comment's "budget is bytes" reasoning: another attempt right
    // now would race the same store again.
    log({ stage: 'queue', phase: 'fail', reason: 'quota', type: payload.type, error: (err as Error)?.message }, true);
    return false;
  }
}

// --- sweep (resend) ----------------------------------------------------------------

export interface SweepDeps {
  // background.ts's bridgeSend. Rejects the same way an ordinary save's
  // send does, `.unreachable`-tagged errors included — this module does not
  // reimplement that classification.
  send: (payload: QueueableRequest) => Promise<unknown>;
  // A FRESH "is this permalink saved?" lookup (background.ts's queryBridge),
  // not the badge's cache — resolves null on any failure (fail-open, same
  // rule duplicate-guard.ts's checkDuplicate uses) rather than rejecting.
  query: (url: string) => Promise<SavedEntry | null>;
  log: SaveQueueLogger;
}

// True while a sweep is already running. Single-flight because the service
// worker has exactly one of these at a time (background.ts's own comment on
// flushLog makes the same point about the log queue) — a second trigger
// arriving mid-sweep has nothing useful to add, and letting two run at once
// would double up on connectNative attempts against a host that just failed.
let sweeping = false;

// Resend everything queued for the CURRENT host, oldest first, stopping the
// moment one attempt proves the host is still unreachable (#203 design
// comment: the rest of the queue would fail the exact same way right now,
// and trying them anyway would only spend more connectNative attempts on a
// host that just said no). An entry the host ANSWERED (rather than one that
// timed out or never connected) is dropped outright instead of stopping the
// sweep: that is not the connectivity problem this pause exists to avoid
// repeating.
export async function sweepSaveQueue(deps: SweepDeps): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const rows = queueRowsOf(await storageGet(null)).filter((row) => row.entry?.host === NATIVE_HOST && !row.entry?.gaveUp);
    for (const { key, entry } of rows) {
      const url = entry.payload?.metadata?.url ?? null;
      const captureId = entry.payload?.captureId ?? null;
      if (url) {
        let known: SavedEntry | null = null;
        try {
          known = await deps.query(url);
        } catch {
          known = null; // fail-open — send as usual, same rule duplicate-guard.ts's checkDuplicate uses
        }
        // #34's owners/id already landed by 2026-07-29 — the design comment
        // this module implements folds the idempotency check into v1 for
        // exactly that reason. A match means the host wrote this SAME
        // capture and only the ack was lost; a DIFFERENT captureId for the
        // same URL is a separate, legitimate save and must still go out.
        const alreadyLanded = !!known && (known.id === captureId || (known.owners || []).includes(captureId));
        if (alreadyLanded) {
          await storageRemove([key]).catch(() => {});
          continue;
        }
      }
      try {
        await deps.send(entry.payload);
        await storageRemove([key]).catch(() => {});
      } catch (err: any) {
        if (!err?.unreachable) {
          // The host answered and refused (its own post-unavailable etc.) —
          // retrying would only repeat that answer. Drop this one entry and
          // keep going; it is not the "host is not there" case the break
          // below exists for.
          deps.log({ stage: 'queue', phase: 'fail', reason: 'answered', type: entry.type, error: err?.message }, true);
          await storageRemove([key]).catch(() => {});
          continue;
        }
        const tries = (entry.tries || 0) + 1;
        if (tries >= SAVE_QUEUE_MAX_TRIES) {
          await storageSet({ [key]: { ...entry, tries, gaveUp: true } }).catch(() => {});
          deps.log({ stage: 'queue', phase: 'giveup', type: entry.type }, true);
        } else {
          await storageSet({ [key]: { ...entry, tries } }).catch(() => {});
        }
        break; // still unreachable — the rest would fail the same way right now
      }
    }
  } finally {
    sweeping = false;
  }
}

// --- diagnostics -------------------------------------------------------------------

export interface SaveQueueStats {
  count: number;
  bytes: number;
  gaveUp: number;
}

// Read-only — no send, no eviction, no host filter: the diagnostics page
// shows the WHOLE store's queue (including another host's leftover entries,
// #732), because "what is sitting in storage" is precisely what a person
// reaching this page wants answered.
export async function saveQueueStats(): Promise<SaveQueueStats> {
  const rows = queueRowsOf(await storageGet(null));
  return {
    count: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.size, 0),
    gaveUp: rows.filter((row) => row.entry?.gaveUp).length,
  };
}
