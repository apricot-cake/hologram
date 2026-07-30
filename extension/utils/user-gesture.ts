// The page side's trust boundary (#323).
//
// Everything this extension draws sits on someone else's page, and the DOM's
// event path is shared with that page. A script on it can `dispatchEvent` a
// click, a contextmenu, or a whole drag, and a listener registered by a content
// script sees those exactly as it sees the user's own — same target, same
// bubbling, same handler. So before this, a page could drive a capture session
// to its end: it chose WHICH post got saved and WHEN, with the click that is
// supposed to be the gate no longer part of the path. Every attempt that
// resolved to no post also wrote a diagnostic line, and each of those opened a
// native-messaging connection — Chrome starts a host PROCESS per connection —
// so a loop of synthetic clicks grew host processes for as long as the tab
// lived.
//
// `isTrusted` is the browser's own answer to "did the user do this?". It is true
// only for events the user agent dispatched itself, and a page cannot forge it:
// the property is readonly on the interface, and `dispatchEvent` sets it false
// by definition. Events synthesized through the DevTools protocol (`Input.*`)
// ARE trusted, which is what keeps a real-input browser test on the user's side
// of this line while `page.dispatchEvent` lands on the page's.
//
// WHERE THIS BELONGS. On the handlers that START, ANSWER or END a save: the
// click that picks a post, the duplicate warning's three answers, the drag that
// arms the drop zone and the drop that commits it, the hover save button, the
// intake's stop button, and the keys and right-click that abandon a session.
// NOT on the ones that only follow the pointer — mousemove, pointermove, scroll,
// dragover — because those move our own overlay and can begin nothing; a page
// that dispatches them has moved a highlight, which it could do by scrolling.
//
// This is one half of #323. It closes the path that exists today; the other half
// bounds what any future path can cost, on the side that actually spawns the
// host processes (utils/host-budget.ts).
export function fromUser(event: Event): boolean {
  return event.isTrusted === true;
}

// A listener that untrusted events never reach.
//
// Preferred over an early return written inside each handler: the guard is then
// visible at the REGISTRATION — the line where the page's event path meets ours
// — so a reader sees which listeners are on the user's side of the boundary
// without opening each one, and a handler added later next to them is a visibly
// different shape rather than a silent omission.
export function userOnly<E extends Event>(handler: (event: E) => void): (event: E) => void {
  return (event: E) => {
    if (!fromUser(event)) return;
    handler(event);
  };
}
