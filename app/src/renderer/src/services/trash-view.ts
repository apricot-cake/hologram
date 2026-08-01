// Trash destination state (#268) — the model behind the Trash entry in the left
// nav and the `trash` browse view it opens. The raw IPC calls stay in trash.ts
// (list/restore/delete/empty, 1:1 forwarding); this owns everything the VIEW needs:
// the loaded records grouped into cards, its own selection, and the restore /
// permanent-delete / empty-all commands.
//
// Its selection is deliberately NOT services/selection.ts's: that set feeds the
// floating bar's tag / folder / group actions, and those are exactly the edits the
// trash must not offer (#268 design finalized — "normal tag/folder editing and new saves
// are disabled within the Trash"). Two sets that can never be confused is what keeps that true by
// construction rather than by a guard in every action.
//
// The card MODEL is the library's own (post-grid-builder's cardModel, handed to
// hologramTrashGridSource) so a trashed post looks exactly like it did in the grid;
// the grouping function is injected here for the same reason — a multi-image post
// deleted as one card comes back as one card.
//
// Nothing here knows where the trash lives on disk, and that is what lets the
// library's own card model draw these records: list-trash names their files
// relative to the SAVE FOLDER (`.trash/<file>`, see lib-trash-capture.ts's
// rebaseOntoTrash), which is the one frame every filename in the app is read in
// (#267). The prefix is invisible to restore/permanent-delete as well: both
// address a record by its captureId, which main recovers with baseOf().
import { open as confirmOpen } from './confirm.ts';
import { postIdKey, stampPost } from './records.ts';
import { set as storeSet } from './store.ts';
import { deleteFromTrash, emptyTrash, listTrash, restorePost } from './trash.ts';
import { notify } from './ui.ts';

export interface TrashViewDeps {
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  /** post-grid-builder's groupRecords — the SAME grouping the library grid uses. */
  groupRecords(list: HologramPost[]): HologramPostGroup[];
  /** Single-image peek (services/lightbox.ts), the same one the inspector thumb opens. */
  openQuickView(g: HologramPostGroup): void;
}

let deps: TrashViewDeps | null = null;
export function configure(d: TrashViewDeps) {
  deps = d;
}

let groups: HologramPostGroup[] = [];
let count = 0; // trashed CAPTURES (not cards) — what the sidebar badge shows
let selected = new Set<string>(); // group keys (postIdKey of the card's rep)
let anchor: string | null = null; // shift-range anchor
let busy = false;
let loaded = false;

export interface TrashViewSnapshot {
  groups: HologramPostGroup[];
  selected: ReadonlySet<string>;
  count: number;
  busy: boolean;
  loaded: boolean;
}
let snapshot: TrashViewSnapshot = { groups, selected, count, busy, loaded };

const subs = new Set<() => void>();
function publish() {
  snapshot = { groups, selected, count, busy, loaded };
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}
export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}
export function getSnapshot(): TrashViewSnapshot {
  return snapshot;
}
/** The sidebar badge reads only this (a number is a stable snapshot on its own). */
export function getCount(): number {
  return count;
}

const keyOfGroup = (g: HologramPostGroup) => postIdKey(g.rep);

// Read .trash/ and rebuild the card set. Cheap enough to be the ONLY refresh path
// (a directory read plus a group pass), so the badge and the view never disagree
// about what is in there.
export async function refresh(): Promise<void> {
  if (!deps) return; // called before orchestrator wired us (a component mounted first)
  let records: HologramPost[] = [];
  try {
    records = ((await listTrash()) || []) as HologramPost[];
  } catch {
    records = [];
  }
  // Most recently deleted first — the order every trash is read in (Explorer's
  // Date deleted, macOS Finder's Date Deleted, digiKam's Deletion Time).
  records.sort((a, b) => String((b as any).trashedAt || '').localeCompare(String((a as any).trashedAt || '')));
  count = records.length;
  groups = deps.groupRecords(records.map(stampPost));
  const live = new Set(groups.map(keyOfGroup));
  const kept = new Set([...selected].filter((k) => live.has(k)));
  if (kept.size !== selected.size) selected = kept;
  if (anchor && !live.has(anchor)) anchor = null;
  loaded = true;
  // null (not []) unmounts the grid's cells synchronously — same sentinel the post
  // grid uses (see services/grid.ts's computeModel).
  storeSet('trashGroups', groups.length ? groups : null);
  publish();
}

// --- selection -------------------------------------------------------------
// Plain click replaces, Ctrl/Cmd toggles, Shift extends from the anchor — the
// gesture the post grid already teaches (#143), so nothing new is learned here.
export function clickCard(key: string, mods: { ctrl?: boolean; shift?: boolean }) {
  if (mods.shift && anchor) {
    const keys = groups.map(keyOfGroup);
    const a = keys.indexOf(anchor);
    const b = keys.indexOf(key);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      selected = new Set(keys.slice(lo, hi + 1));
      publish();
      return;
    }
  }
  if (mods.ctrl) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  } else {
    selected = new Set([key]);
  }
  anchor = key;
  publish();
}
export function clearSelection() {
  if (!selected.size) return;
  selected = new Set();
  anchor = null;
  publish();
}
export function selectAll() {
  selected = new Set(groups.map(keyOfGroup));
  publish();
}
export function preview(key: string) {
  const g = groups.find((x) => keyOfGroup(x) === key);
  if (g && deps) deps.openQuickView(g);
}

// --- commands --------------------------------------------------------------
function selectedGroups(): HologramPostGroup[] {
  return groups.filter((g) => selected.has(keyOfGroup(g)));
}
async function run(work: () => Promise<void>) {
  if (busy) return;
  busy = true;
  publish();
  try {
    await work();
  } finally {
    busy = false;
    await refresh(); // refresh() publishes
  }
}

export function restoreSelected() {
  const picked = selectedGroups();
  if (!picked.length) return;
  const n = picked.reduce((sum, g) => sum + g.records.length, 0);
  run(async () => {
    for (const g of picked) {
      for (const r of g.records) {
        try {
          await restorePost((r.image || r.video || r.captureId) as string);
        } catch {
          /* keep going — one bad record must not strand the rest */
        }
      }
    }
    if (deps) notify(deps.t('trashRestored', [n]));
  });
}

// Permanent deletion is the one action here that cannot be undone by any other
// screen, so it asks — the same shape as the library's own delete confirm
// (services/confirm.ts). #105's keyword-gated wipe stays reserved for "Empty".
export function requestDeleteSelected() {
  const picked = selectedGroups();
  if (!picked.length || !deps) return;
  const n = picked.reduce((sum, g) => sum + g.records.length, 0);
  const d = deps;
  confirmOpen({
    message: d.t('trashDeleteConfirm', [n]),
    description: d.t('trashDeleteConfirmDesc'),
    okLabel: d.t('trashDeleteBtn'),
    cancelLabel: d.t('confirmCancel'),
    onOk: () =>
      run(async () => {
        for (const g of picked) {
          for (const r of g.records) {
            try {
              await deleteFromTrash(r.captureId as string);
            } catch {
              /* keep going */
            }
          }
        }
        notify(d.t('trashDeleted', [n]));
      }),
  });
}

// Empty all — #105's explicit confirmation, carried over unchanged from the settings
// section this replaced (same message/description keys, same AlertDialog).
export function requestEmptyAll() {
  if (!count || !deps) return;
  const d = deps;
  confirmOpen({
    message: d.t('trashEmptyBtn'),
    description: d.t('trashEmptyConfirm'),
    okLabel: d.t('trashEmptyBtn'),
    cancelLabel: d.t('confirmCancel'),
    onOk: () =>
      run(async () => {
        try {
          await emptyTrash();
        } catch {
          /* best-effort — refresh() shows whatever survived */
        }
        notify(d.t('trashEmptied'));
      }),
  });
}
