// Is the script still attached to the extension that injected it? (#594)
//
// THE SITUATION. Reloading the extension — or Chrome updating it on its own,
// which is the same event after release — does not touch the content scripts
// already running in open tabs. They keep executing from memory with their
// connection to the extension severed: "orphaned". Everything they drew is
// still on the page and none of it works any more.
//
// WHAT IS ACTUALLY OBSERVABLE, measured in a disposable Chromium by reloading
// the extension under a live tab (scripts/e2e-extension-orphan.cts keeps
// measuring it):
//
//   chrome.runtime               stays an object
//   chrome.runtime.id            flips to undefined — and READING IT NEVER THROWS
//   chrome.runtime.sendMessage   throws synchronously, "Extension context invalidated."
//   chrome.storage.local.get     throws synchronously, same message
//   chrome.runtime.onMessage.addListener / removeListener
//                                do NOT throw (Chrome has already dropped them)
//
// So `chrome.runtime.id` is the one door that can be opened to ask the question
// rather than to find out the hard way, and asking costs a property read.
//
// WHY NOT THE OTHER TWO IDIOMS. A long-lived `chrome.runtime.connect()` port
// whose `onDisconnect` fires on invalidation is the other well-known detector —
// but an open port holds the MV3 service worker awake (it is the same mechanism
// the keep-alive hack abuses), and this extension has a resident script on every
// open timeline. Probing by sending a message wakes the worker for the same
// reason. Catching the exception from a real call is not detection at all: by
// then the thing the user asked for has already failed.
//
// THERE IS NO PLATFORM EVENT for this. The web-extensions standard has an open
// request for one (w3c/webextensions#138 — content scripts get no shutdown
// notification), so polling or asking are the only two shapes available, and
// this module is the "ask, at the moments we were going to use the API anyway"
// shape. Nothing here runs on a timer.

type GoneHandler = () => void;

const handlers: GoneHandler[] = [];
let announced = false;

// One handler blowing up must not cost the others theirs: teardown handlers run
// against a page the extension no longer controls, and a half-finished teardown
// is worse than either end of it.
function run(handler: GoneHandler): void {
  try {
    handler();
  } catch {
    /* the point of the handler was cleanup; there is nowhere left to report to */
  }
}

// Say it out loud, once. Callers that learned the context is gone from a thrown
// call rather than from the probe use this directly.
export function noteExtensionGone(): void {
  if (announced) return;
  announced = true;
  // Spliced, not iterated: a handler that registers another one during teardown
  // would otherwise extend the array being walked.
  for (const handler of handlers.splice(0, handlers.length)) run(handler);
}

// The probe. Announces on the first false, so every guarded entry point is also
// what triggers the cleanup — there is no separate watcher to keep in step.
export function extensionAlive(): boolean {
  let alive = false;
  try {
    alive = Boolean(chrome.runtime?.id);
  } catch {
    alive = false; // not seen in any measurement; costs one branch to not depend on that
  }
  if (!alive) noteExtensionGone();
  return alive;
}

// Run `handler` when this context is orphaned — immediately if that already
// happened, since a caller registering late is exactly the caller that has just
// been told to give up.
export function onExtensionGone(handler: GoneHandler): () => void {
  if (announced) {
    run(handler);
    return () => undefined;
  }
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}
