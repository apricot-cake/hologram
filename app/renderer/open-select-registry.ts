// State-based "is any shadcn Select popup open right now?" registry.
//
// The renderer's imperative Esc/dismiss cascades (inspector-builder.ts's
// handleEscDismissDetail) must defer to an open Select so the first Esc closes
// only the Select, not the inspector behind it. The redesign's zero-tolerance
// rule forbids sniffing the DOM for `[data-slot="select-content"]` to decide
// this — the signal has to come from component state instead.
// components/ui/select.tsx's Select Root wrapper registers/unregisters each
// mounted instance here.
//
// Lives with the other renderer state bridges (qf-pop.ts, tag-pop.ts, …) rather
// than in islands/_shared: the read side is renderer code and the whole thing
// (renderer services + islands) ships as one app.js bundle, so this module is a
// single shared singleton at runtime regardless of where it sits.
//
// Keyed by a per-instance symbol (not a bare counter) so an instance that
// unmounts while still open — via the Root wrapper's unmount cleanup — can be
// dropped without leaking a phantom "open" that would swallow every later Esc.
const openSelects = new Set<symbol>();

export function setSelectOpen(id: symbol, open: boolean): void {
  if (open) openSelects.add(id);
  else openSelects.delete(id);
}

export function isAnySelectOpen(): boolean {
  return openSelects.size > 0;
}
