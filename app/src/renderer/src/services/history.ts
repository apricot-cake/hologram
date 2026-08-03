// Global history page (#145) — the renderer-side half. Recording is a
// fire-and-forget IPC call hung off tabs-builder.ts's onPush hook (main owns the
// actual write — see ipc-history.ts/lib-db-write.ts); reading/deleting/clearing
// pass straight through to main's keyset-paged query. A real ES module (named
// exports), imported directly by tabs-builder.ts, history-panel.ts, and
// command-builder.ts's palette provider.
import { hologramIpc } from './ipc.ts';
import type { HistoryQueryOptions, HistoryQueryResult, HistoryRow } from '../../../main/ipc-payloads.ts';

// The last recorded u, across every tab in this renderer — #145 design §4:
// "連続する同一 u は積まない" (the same rule makeNavHistory's own push()
// applies within one tab's stack, generalized to the whole app). Module-level
// on purpose: a global history log has no per-tab scope to key this on.
let lastU: string | null = null;

/**
 * Records ONE push-time visit. Called only from tabs-builder.ts's onPush hook
 * (never on replace — see tab-state.ts's onPush doc). `title` is the caller's
 * already-derived display label (tabTitleOf / imageTabTitleOf / the fixed
 * "posters" label) — this module generates no label of its own.
 */
export function recordPush(entry: HologramNavEntry, title: string): void {
  if (entry.u === lastU) return;
  lastU = entry.u;
  noteRecent({ id: -1, ts: Date.now(), u: entry.u, kind: entry.kind, title, state: entry.state });
  hologramIpc.appendHistory({ ts: Date.now(), u: entry.u, kind: entry.kind, title, state: entry.state }).catch(() => {
    /* best-effort — a dropped history row is not worth surfacing */
  });
}

export function queryHistory(opts: HistoryQueryOptions): Promise<HistoryQueryResult> {
  return hologramIpc.queryHistory(opts);
}

export function deleteHistoryRow(id: number): Promise<void> {
  dropRecent(id);
  return hologramIpc.deleteHistoryRow(id).then(() => undefined);
}

export function clearHistory(): Promise<void> {
  recent = [];
  lastU = null;
  return hologramIpc.clearHistory().then(() => undefined);
}

// --- Recent-visit cache (command palette's "history" section, #145 design §9) ---
// The palette's candidate providers are synchronous (services/command-registry.ts:
// "entries(query) … candidates as of right now"), so a live DB round trip per
// keystroke is not an option. A small in-memory ring of the most recent visits —
// filled from recordPush, so it is always current for THIS session — gives the
// palette's @history-style quick-jump rows without a query engine of their own.
// Rows this cache never saw (from before the app opened, or another window) only
// show up on the full history panel, which reads the DB directly — the palette
// trading completeness for being synchronous is the same trade queryEntries'
// query-gated corpus providers already make for tags/posters.
const RECENT_CAP = 50;
let recent: HistoryRow[] = [];

function noteRecent(row: HistoryRow): void {
  recent = [row, ...recent.filter((r) => r.u !== row.u)].slice(0, RECENT_CAP);
}

function dropRecent(id: number): void {
  recent = recent.filter((r) => r.id !== id);
}

/** Synchronous — the palette's history provider reads this directly. */
export function recentHistory(): readonly HistoryRow[] {
  return recent;
}
