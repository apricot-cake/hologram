// What the extension does when it could not inject its UI at all (#269).
//
// THE PROBLEM THIS EXISTS FOR. Clicking the toolbar icon (or Alt+S) asks
// chrome.scripting.executeScript to push capture.js into the page, and
// capture.js is what draws the banner — including the banner that would say a
// save failed. So when the injection ITSELF fails there is, by construction, no
// surface on the page to report it with: the click is completely inert and the
// only trace is a line in capture.log. The toolbar action is the one thing the
// service worker owns and can still paint, so that is where the alert goes.
//
// MEASURED, on a headless Chromium running this extension unpacked
// (2026-07-31, probe run for #269 — the numbers below are why this file is
// shaped the way it is rather than the way the 2026-07-25 design comment
// guessed):
//
//   setBadgeText / setBadgeBackgroundColor / setBadgeTextColor / setTitle
//     work from the service worker with nothing beyond the manifest's `action`
//     — no new permission — AND keep working after the extension's own files
//     have become unreadable.
//   a tabId-scoped badge is really scoped: the other tab read '' and kept the
//     default tooltip, and so did the global badge.
//   Chrome clears a tab-scoped badge AND title by itself when that tab
//     navigates, so navigation only has to drop what WE remember.
//   fetch(chrome.runtime.getURL(...)) answers 200 while the package is
//     readable and rejects ("Failed to fetch") once its directory is gone —
//     which is the only honest way to tell the two causes apart.
//   chrome-extension://<id>/diag.html fails with ERR_FILE_NOT_FOUND in that
//     state. The diagnostics page CANNOT be the escalation for the failure
//     that motivated this issue; it is reachable only in the other branch.
import { actionBadge } from './tokens.ts';

// Four characters is Chrome's own guidance for badge text, and this one says
// the least a mark can: something needs looking at. It is not a count and not
// a state the user chose, so a glyph rather than a word — the tooltip beside
// it is where the sentence lives.
const ALERT_BADGE = '!';

// How long to wait for the liveness probe below. A read of a local extension
// resource does not meaningfully block, but an unbounded await on the failure
// path is exactly the shape #507 spent an issue removing, and the answer only
// picks a wording — timing out is safely read as "assume the package is fine".
const PROBE_TIMEOUT_MS = 2000;

// Which of the two situations the caller is in. Not classified from Chrome's
// error text (that wording is not a contract) but from whether the extension's
// own files can still be read, which is the thing that actually differs.
export type InjectFailureKind =
  // The package cannot be read — the unpacked root moved or was deleted. Every
  // per-call file read fails from here on, so the click is dead until the
  // extension is reloaded, while the resident content scripts keep running from
  // shared memory and make the extension look healthy (see the issue).
  | 'package-unreadable'
  // The package is fine and this page refused. The Web Store, a policy-blocked
  // host, a tab that went away mid-click. Nothing to repair, and no reason to
  // tell anyone to reload anything.
  | 'page-refused';

// Can the extension still read its own files? The question the wording turns
// on, asked the only way that answers it rather than guessing from a message.
export async function packageReadable(): Promise<boolean> {
  try {
    const res = await fetch(chrome.runtime.getURL('diag.html'), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

// diag.html is deliberately the file probed: it is also the page the readable
// branch escalates to, so a successful probe is the same fact as "that page
// will open".
export async function injectFailureKind(): Promise<InjectFailureKind> {
  return (await packageReadable()) ? 'page-refused' : 'package-unreadable';
}

// Where a SECOND failure on the same tab sends the user.
//
// The first press only marks the toolbar. Sending someone to another tab
// because one save did not start is too strong for something that may well be
// a page that simply cannot be scripted; the second press in a row is the
// point at which they are clearly trying and clearly getting nothing.
//
//   package-unreadable → chrome://extensions, filtered to this extension. The
//     Reload button there IS the repair, and it is the only page still capable
//     of rendering: the extension's own diag.html cannot be loaded when its
//     files cannot be read (measured above).
//   page-refused → the diagnostics page, which can print the recorded
//     activate/fail line for whatever the page's objection was.
export function escalationUrl(kind: InjectFailureKind): string {
  return kind === 'package-unreadable' ? `chrome://extensions/?id=${chrome.runtime.id}` : chrome.runtime.getURL('diag.html?issue=inject');
}

// The tooltip. Two sentences, because the two causes need opposite advice and
// one of them would be a lie in the other's situation: telling someone to
// reload a healthy extension because the Web Store refused a script sends them
// to fix something that is not broken.
export function injectFailureTitle(kind: InjectFailureKind): string {
  return chrome.i18n.getMessage(kind === 'package-unreadable' ? 'actionInjectUnreadable' : 'actionInjectRefused');
}

// Raise the alert on one tab's toolbar action. Every call is fire-and-forget:
// none of it can rescue the save, and a rejection here (the tab closed while
// we were asking) must not become a second failure on top of the first.
export function showInjectFailure(tabId: number, kind: InjectFailureKind): void {
  chrome.action.setBadgeText({ text: ALERT_BADGE, tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: actionBadge.background, tabId }).catch(() => {});
  chrome.action.setBadgeTextColor({ color: actionBadge.text, tabId }).catch(() => {});
  chrome.action.setTitle({ title: injectFailureTitle(kind), tabId }).catch(() => {});
}

// Take it back down.
//
// UNCONDITIONAL, not "only if this worker put it there". The service worker is
// killed at any idle moment and comes back with no memory, while Chrome keeps
// the badge it was told to draw — so the first successful injection after a
// restart is the only chance to clear a mark nothing in this process remembers
// setting. Restoring the manifest's own tooltip by name rather than by passing
// an empty string, which is a tooltip of no characters rather than a reset.
export function clearInjectFailure(tabId: number): void {
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  chrome.action.setTitle({ title: chrome.i18n.getMessage('actionTitle'), tabId }).catch(() => {});
}
