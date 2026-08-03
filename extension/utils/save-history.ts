// "Did that save actually go in?" — the extension's own record of its recent
// saves, read by the toolbar popup (#124).
//
// WHY THE EXTENSION KEEPS ITS OWN. The full record of every save is the native
// host's capture.log, and the extension cannot read it: the host appends, and
// there is no message type that asks for it back. Adding one was considered and
// rejected — it would widen the extension/host boundary for a list that only
// has to cover "the last handful, on this machine, right now". So this is a
// small ring buffer the extension writes for itself.
//
// chrome.storage.local, not .session: the question survives a browser restart
// ("I saved a few things last night — did they land?"), and the answer would
// not. Nothing here leaves the machine.

export const SAVE_HISTORY_KEY = 'saveHistory.v1';

// Twenty rows. The popup is a glance, not a log viewer — the diagnostics page
// and capture.log are where a long history is read — and the ring has to stay
// small enough that a bulk intake cannot push a whole evening's ordinary saves
// out of it (see the folding below, which is the other half of that promise).
export const SAVE_HISTORY_MAX = 20;

export interface SaveHistoryEntry {
  ts: number;
  ok: boolean;
  // Which route this save came in on, in the vocabulary the save gate already
  // uses ('save' | 'savePost' | 'saveDragged' | 'saveBookmark').
  type: string;
  platform: string | null;
  // The post's own URL, kept WHOLE. The popup shortens it for display, but the
  // row is clickable — opening the post it names is the one action a row has.
  url: string | null;
  // The tab the save came from. Only used to decide whether two intake saves
  // belong to the same run (see foldInto); never displayed.
  tabId?: number | null;
  // The host's own id for the record, when the route learned one. Carried for
  // #125: "open this in the app" has to name a record the app can find, and an
  // id the extension minted for itself would not be that.
  captureId?: string | null;
  // Set by the bulk-intake routes (#362). Its presence is what makes a row
  // foldable.
  capturedVia?: string | null;
  // How many saves this row stands for. Absent means one.
  count?: number;
  error?: string | null;
}

export const countOf = (entry: SaveHistoryEntry): number => (typeof entry.count === 'number' && entry.count > 0 ? entry.count : 1);

// Two saves belong to the same run when they came in through the same intake on
// the same tab and ended the same way.
//
// `ok` is part of it even though a run's outcome is not what a person calls a
// "run": folding a failure into a row of successes would hide it inside a
// number, and a save that did NOT go in has to be as visible as one that did —
// that is the whole reason this list exists.
function sameRun(a: SaveHistoryEntry, b: SaveHistoryEntry): boolean {
  return !!a.capturedVia && a.capturedVia === b.capturedVia && a.tabId === b.tabId && a.ok === b.ok;
}

// Add one save to the ring.
//
// A bulk intake (#362) saves a post a second, so without folding one run fills
// all twenty rows and the list stops being "the recent saves" — it becomes a
// window onto the last twenty seconds of one run. So a save that continues the
// run at the head of the list bumps that row's count and timestamp instead of
// pushing a new one. An ordinary save in between ends the run: the next intake
// save after it starts a fresh row, which is what keeps the list honest about
// the order things happened in.
//
// Pure, and takes the ring rather than reading it, so the rule can be tested
// without chrome.storage.
export function foldInto(rows: readonly SaveHistoryEntry[], entry: SaveHistoryEntry, max = SAVE_HISTORY_MAX): SaveHistoryEntry[] {
  const head = rows[0];
  if (head && sameRun(head, entry)) {
    return [{ ...head, ts: entry.ts, count: countOf(head) + 1, captureId: entry.captureId ?? head.captureId ?? null }, ...rows.slice(1)];
  }
  return [entry, ...rows].slice(0, max);
}

// How many saves happened today, counting a folded run as the number of saves
// it stands for. Deliberately derived rather than counted into a field of its
// own: a separate counter is one more thing that can disagree with the list
// beside it.
export function savedOn(rows: readonly SaveHistoryEntry[], now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return rows.filter((row) => row.ok && row.ts >= start).reduce((sum, row) => sum + countOf(row), 0);
}

export function rowsOf(stored: unknown): SaveHistoryEntry[] {
  return Array.isArray(stored) ? (stored.filter((row) => row && typeof row === 'object' && typeof (row as SaveHistoryEntry).ts === 'number') as SaveHistoryEntry[]) : [];
}

export async function readSaveHistory(): Promise<SaveHistoryEntry[]> {
  try {
    const got = await chrome.storage.local.get(SAVE_HISTORY_KEY);
    return rowsOf(got?.[SAVE_HISTORY_KEY]);
  } catch {
    return [];
  }
}

// Never throws and never delays the save that produced it: a save whose record
// could not be written is still a save, and the list is a convenience.
export async function recordSave(entry: SaveHistoryEntry): Promise<void> {
  try {
    const rows = await readSaveHistory();
    await chrome.storage.local.set({ [SAVE_HISTORY_KEY]: foldInto(rows, entry) });
  } catch {
    /* best effort */
  }
}
