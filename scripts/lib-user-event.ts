// The user's own events, for the jsdom suites that drive the content scripts.
//
// `dispatchEvent` produces `isTrusted: false` BY DEFINITION — that is the whole
// distinction #323 rests on, and since it the extension's save handlers ignore
// anything else (extension/utils/user-gesture.ts). So a test that dispatches a
// plain event is playing the PAGE, not the user.
//
// Both roles are wanted: most suites are asking what a user's press does, while
// the guard's own tests ask what a hostile page's press does NOT do. Naming the
// user's side here keeps the difference visible in each suite — `asUser(...)` is
// the user, a bare `dispatchEvent` is the page — instead of leaving every
// dispatch ambiguous.
//
// WHY IT IS WRITTEN THIS WAY. Two layers of the platform exist to stop exactly
// what this function does, and both have to be answered:
//
//   1. `isTrusted` is `[LegacyUnforgeable]` — an own, non-configurable property
//      of every event instance — so defineProperty cannot replace it on the
//      event itself. jsdom keeps the value on a backing object behind that
//      getter, reachable through the event's only own symbol.
//   2. `dispatchEvent` SETS IT FALSE as its first step, so a value written
//      before the dispatch is gone by the time any listener runs. Hence a getter
//      (with a no-op setter to absorb that step) rather than a value.
//
// What comes out is an event the extension cannot tell from a real one, which is
// what makes it the right stand-in. In a real browser the equivalent is the
// DevTools protocol's `Input.*` domain, which is what the Playwright suites
// drive and why they need no help from here.
export function asUser<E extends Event>(event: E): E {
  const impl = Object.getOwnPropertySymbols(event).find((symbol) => String(symbol) === 'Symbol(impl)');
  if (!impl) throw new Error('asUser: not a jsdom event — no backing object to mark trusted');
  Object.defineProperty((event as any)[impl], 'isTrusted', { get: () => true, set: () => {}, configurable: true });
  return event;
}
