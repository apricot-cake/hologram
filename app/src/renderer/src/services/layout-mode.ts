// The layout's width breakpoint (#259) — the ONE place that knows the number.
//
// #243 removed every width-driven reshape, and the cleanup had to hunt down width
// knowledge scattered across media queries and JS (an outside-click handler gated
// itself with its own `max-width: 1279px`, which is exactly the kind of stray copy
// that gets missed). #259 brought a single reshape back and put the number here so
// it could not scatter a second time.
//
// Nothing reshapes by width any more: #975 docked the inspector at every width and
// ADR 0027 (#981) fixed the sidebar to the rail. So the live store this file used to
// export (isWide / subscribe) went with its last reader — AppShell had been holding a
// subscription whose value nothing used (#988).
//
// The number stays, and it stays HERE rather than moving to the harnesses that read
// it, because "the layout's breakpoint" is what it means: e2e/lib/viewport.ts derives
// the Playwright window from it, app/src/main/smoke-window-size.ts is pinned against
// it, and scripts/harness-viewport.test.ts fails if either drifts to the narrow side
// or writes the number down a second time.
//
// 1280 with the boundary on the wide side: a 2560px display split in half lands
// exactly on 1280, and that half is wide enough to hold both panels plus a usable
// grid. A 1920 display's half (960) falls to the narrow side, which is the case
// that motivated the issue — 256 + 320 of panel against 382 of content.
export const WIDE_MIN_PX = 1280;
