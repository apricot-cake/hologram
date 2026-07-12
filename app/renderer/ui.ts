'use strict';

import { toast } from 'sonner';

// Shared UI utilities — single source of truth, so every caller (folders.ts, the
// *-builder.ts modules, etc.) consumes the SAME toast + escape implementation instead of
// hand-rolling their own.

// Transient toast via sonner (the shadcn/ui standard toaster). The <Toaster /> outlet is
// mounted once in App.tsx (islands/components/ui/sonner.tsx); sonner's toast() is callable
// from anywhere — vanilla service modules included — through its own external store, so
// this keeps the same one-liner contract the old #ivToast bridge had.
export function notify(msg: unknown) {
  toast(msg == null ? '' : String(msg));
}

// Quote-safe HTML escape for text placed via innerHTML. Escapes " and ' too, so
// a result accidentally used in an attribute stays safe (viewer's old div-based
// escape left those unescaped). Display is unchanged for normal text content.
export function escapeHtml(s: unknown) {
  const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAP[c]);
}
