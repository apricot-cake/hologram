// React → orchestrator handshake for the shell cutover (redesign P1).
//
// The orchestrator boots from its module-eval IIFE (imported by App.tsx) and, once
// upon a time, wired its delegated listeners onto index.html's STATIC shell DOM
// (#postGrid, #emptyState, the tab bar…). Now the shell is React-owned (AppShell.tsx),
// so those elements don't exist yet when the IIFE runs. This promise lets the
// orchestrator `await shellReady` before touching the shell DOM; AppShell resolves it
// from a mount effect, so by the time the orchestrator queries #postGrid et al. they
// are in the document.
//
// Symmetric to orchestrator's own `viewerReady` (orchestrator → React, gating bootApp).
// Retired when the orchestrator's boot-time DOM delegation is torn down into per-element
// props/handlers (§8-1 ①, P2 ⑥/⑪).
let signal!: () => void;
export const shellReady: Promise<void> = new Promise((resolve) => {
  signal = resolve;
});

let signalled = false;
export function signalShellReady(): void {
  if (signalled) return; // idempotent: AppShell mounts once, but guard against strict-mode double-invoke
  signalled = true;
  signal();
}
