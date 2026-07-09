// Value-flyout bridge — the imperative→declarative bridge for the sidebar filter
// "value flyout" (qf-pop): clicking a category row (platform / tag / user / …) opens a
// scrollable list of that category's values, optionally with a find box + ぴったり/
// おおまか segment for long lists. viewer.ts owns the bespoke facet logic (qfValues —
// per-category counting/sorting rules) and the pick routing (add/remove filter, poster
// query-builder ops, multi-image toggle); this bridge only carries the CURRENT
// rendered model. Kept SEPARATE from corpusStore for the same reason as
// menu.ts/kind-menu.ts/filter-popover.ts: onPick/onManage carry CALLBACKS. A real ES
// module (named exports), imported directly by its consumers (viewer.ts / QfPop.tsx).
//
// model shape (CorpusQfPopModel): { openId, anchorRect:{left,top,right,bottom}, items,
// showFind, findPlaceholder, searchModeTitle, exactLabel, fuzzyLabel, exactHint,
// fuzzyHint, footerLabel?, onManage?(), onPick(item) }. openId is an internal monotonic
// counter (not passed by the caller): every open() bumps it, so the island can key its
// root on it and remount (reset + refocus the find input) on every open() call —
// including the refresh after a pick, matching the old renderQfPop() rebuild-on-every-
// change behavior. The subscribe/notify/openId machinery is the shared
// makeCallbackBridge (bridge.ts).
import { makeCallbackBridge } from './bridge.ts';

export const { open, close, get, subscribe } = makeCallbackBridge<CorpusQfPopModel>();
