'use strict';

import { makeCallbackBridge } from './bridge.ts';

// Shared UI utilities — single source of truth, so every caller (folders.ts, the
// *-builder.ts modules, etc.) consumes the SAME toast + escape implementation instead of
// hand-rolling their own.

interface CorpusToastModel {
  openId: number;
  msg: string;
}

// Transient toast via the glass #ivToast surface (DESIGN.md: glass = transient surface).
// V18 §2: the Toast island (app/islands/toast/Toast.tsx) owns #ivToast's content + .show
// class + auto-hide timer; this module only pushes the message. Reuses makeCallbackBridge
// (qf-pop.ts/filter-popover.ts) — open() stamps a fresh openId even for the identical
// message twice in a row, so the island's auto-hide effect (keyed on it) always restarts,
// matching the old clearTimeout+setTimeout behavior. Never closed to null: the island keeps
// rendering the last message while faded out via CSS (opacity/transform on .show), same as
// the old code leaving textContent alone and only toggling the class.
const toastBridge = makeCallbackBridge<CorpusToastModel>();
export function notify(msg: unknown) {
  toastBridge.open({ msg: msg == null ? '' : String(msg) });
}
export const getToast = toastBridge.get;
export const subscribeToast = toastBridge.subscribe;

// Quote-safe HTML escape for text placed via innerHTML. Escapes " and ' too, so
// a result accidentally used in an attribute stays safe (viewer's old div-based
// escape left those unescaped). Display is unchanged for normal text content.
export function escapeHtml(s: unknown) {
  const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAP[c]);
}
