'use strict';

import { toast } from 'sonner';

// Shared UI utilities — single source of truth, so every caller (folders.ts, the
// *-builder.ts modules, etc.) consumes the SAME toast + escape implementation instead of
// hand-rolling their own.

// An optional button on a toast. Today the only one is "Undo" (#235): a
// completed bulk/destructive edit offers the way back right where it reported
// itself, instead of making you remember Ctrl+Z.
export type NotifyAction = { label: string; onClick: () => void };

// Transient toast via sonner (the shadcn/ui standard toaster). The <Toaster /> outlet is
// mounted once in App.tsx (components/ui/sonner.tsx); sonner's toast() is callable
// from anywhere — vanilla service modules included — through its own external store, so
// this keeps the same one-liner contract the old #ivToast bridge had.
export function notify(msg: unknown, action?: NotifyAction | null) {
  const text = msg == null ? '' : String(msg);
  if (!action) {
    toast(text);
    return;
  }
  toast(text, { action: { label: action.label, onClick: action.onClick } });
}

// Quote-safe HTML escape for text placed via innerHTML. Escapes " and ' too, so
// a result accidentally used in an attribute stays safe (viewer's old div-based
// escape left those unescaped). Display is unchanged for normal text content.
export function escapeHtml(s: unknown) {
  const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => MAP[c]);
}
