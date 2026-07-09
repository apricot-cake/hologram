// Filter-popover bridge — the imperative→declarative bridge for the date / engagement /
// poster-date-range flyout FORMS (distinct from the value flyout qf-pop, which stays
// imperative for now — its find-input focus-preservation trick is a separate, riskier
// slice; see BACKLOG "React 化"). viewer.ts builds the current field values + already-
// localized labels and owns the apply/remove actions; the filter-popover React island
// subscribes and renders whichever kind ('date' | 'eng' | 'posterDate') is open. Kept
// SEPARATE from corpusStore for the same reason as menu.ts/kind-menu.ts: onApply/onRemove
// carry CALLBACKS, which don't belong in the serializable reactive store. A real ES
// module (named exports), imported directly by its consumers (viewer.ts / FilterPopover.tsx).
//
// model shape (CorpusFilterPopoverModel): { kind, openId, anchorRect:{left,top,right,
// bottom}, editing, fields, labels, typeOptions?, dimOptions?, onApply(fields),
// onRemove() }. openId is an internal monotonic counter (not passed by the caller) so
// the island can key its form on it and remount (reset local input state) on every
// open() — including re-opening the SAME kind to edit a different node. The
// subscribe/notify/openId machinery is the shared makeCallbackBridge (bridge.ts).
import { makeCallbackBridge } from './bridge.ts';

export const { open, close, get, subscribe } = makeCallbackBridge<CorpusFilterPopoverModel>();
