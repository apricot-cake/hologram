import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Chips } from './Chips.tsx';
import type { ChipsModel, QbCluster, QbItem } from './Chips.tsx';

// Presentational island for the query-builder active bars — post (#queryChips)
// and poster (#posterQueryChips). React owns RENDERING the chips; viewer.js's
// createQueryBuilder keeps owning STATE/DATA, the qbNodeMap (id→node), and ALL
// event delegation on the container (click/dragstart/dragover/drop/contextmenu).
//
// render() builds a plain view-model and pushes it here; we emit the SAME DOM
// (.qb-pill/.qb-grp/.qb-op + data-nid) the old innerHTML did, so every delegated
// handler keeps firing — no click bridge, no state moved out of viewer.js.
//
// Both bars share this one bundle, keyed by container id (one React root each).

// ── chip exit animation (AnimatedChips) ─────────────────────────────────────
// viewer.js re-renders the whole model on every tree change, so a removed value
// simply vanishes. To play the corpusPillOut exit, this wrapper diffs the new
// model against the previous one and keeps removed values/clusters as `leaving`
// ghosts (pointer-events:none — their stale data-nid can't reach the delegated
// handlers) for the animation's length, then prunes down to the real model.
// Ghosts never become the diff base: prevRef only ever holds pushed models.

const CHIP_OUT_MS = 200; // keep in sync with --dur-pop (corpusPillOut)

// Splice items that disappeared from `next` back at their old position, marked
// leaving. Returns `next` untouched when nothing was removed.
function ghostItems(prev: QbItem[], next: QbItem[]): QbItem[] {
  const nextIds = new Set(next.map((it) => it.id));
  let out = next;
  prev.forEach((it, i) => {
    if (nextIds.has(it.id)) return;
    if (out === next) out = next.slice();
    out.splice(Math.min(i, out.length), 0, { ...it, isNew: false, leaving: true });
  });
  return out;
}

// Merge leaving ghosts into `next`; null = nothing was removed (render next
// directly). Summary mode has no per-value anatomy to ghost — swap instantly.
function mergeGhosts(prev: ChipsModel, next: ChipsModel): ChipsModel | null {
  if (prev.summary || next.summary) return null;
  let ghosted = false;
  const prevByType = new Map(prev.clusters.map((c) => [c.typeCls, c] as const));
  // Values removed from a surviving cluster → item-level ghosts.
  const clusters: QbCluster[] = next.clusters.map((c) => {
    const p = prevByType.get(c.typeCls);
    if (!p) return c;
    const items = ghostItems(p.items, c.items);
    if (items === c.items) return c;
    ghosted = true;
    return { ...c, items };
  });
  // A whole attribute removed → the entire pill leaves as one.
  const nextTypes = new Set(next.clusters.map((c) => c.typeCls));
  prev.clusters.forEach((p, i) => {
    if (nextTypes.has(p.typeCls)) return;
    ghosted = true;
    clusters.splice(Math.min(i, clusters.length), 0, { ...p, leaving: true, items: p.items.map((it) => ({ ...it, isNew: false })) });
  });
  // Same two shapes for the 除く cluster.
  let excl = next.excl;
  if (prev.excl && next.excl) {
    const items = ghostItems(prev.excl.items, next.excl.items);
    if (items !== next.excl.items) {
      ghosted = true;
      excl = { ...next.excl, items };
    }
  } else if (prev.excl && !next.excl) {
    ghosted = true;
    excl = { ...prev.excl, leaving: true };
  }
  return ghosted ? { ...next, clusters, excl } : null;
}

function AnimatedChips({ model }: { model: ChipsModel | null | undefined }) {
  const [display, setDisplay] = useState(model);
  const prevRef = useRef(model);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = model;
    if (timerRef.current != null) {
      clearTimeout(timerRef.current); // rapid edits: never stack ghost timers
      timerRef.current = null;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const merged = !reduce && prev && model && prev !== model ? mergeGhosts(prev, model) : null;
    if (merged) {
      setDisplay(merged);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setDisplay(model);
      }, CHIP_OUT_MS);
    } else {
      setDisplay(model);
    }
  }, [model]);
  return <Chips model={display} />;
}

const roots = new Map(); // container id → React root

function rootFor(id: string) {
  let r = roots.get(id);
  if (r) return r;
  const el = document.getElementById(id);
  if (!el) return null;
  r = createRoot(el);
  roots.set(id, r);
  return r;
}

function render(id: string, model: ChipsModel) {
  const r = rootFor(id);
  if (r) r.render(<AnimatedChips model={model} />);
}

window.corpusQueryChips = { render };

// Script order is viewer.js → islands, so viewer.js may have run render() (and
// stashed the latest model per container in window.__corpusQueryChips) before
// this bundle finished loading. Replay whatever is pending.
const pending = window.__corpusQueryChips;
if (pending) for (const id of Object.keys(pending)) render(id, pending[id]);
