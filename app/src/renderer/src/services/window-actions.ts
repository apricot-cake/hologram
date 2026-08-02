'use strict';

// Ctrl+Shift+N — open a new window (#32 St1: 1 process / N windows). main owns window
// creation (lib-window.ts's createWindow); this only forwards the gesture over IPC.
// Registration lives in the GlobalShortcuts component (app/App.tsx), alongside the
// other document-level shortcuts; guard + action stay here, next to the call they make.
//
// Guard shape is the house convention (selection-builder.ts's Ctrl+A, panels.ts's
// Ctrl+Shift+B): leave the key alone while typing, and while a modal owns the screen —
// opening a second window from behind a confirm/settings/palette dialog would abandon
// it mid-flow in the new window's context, which is not what the key means there.
import { get as confirmGet } from './confirm.ts';
import { isOpen as paletteIsOpen } from './command-registry.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { hologramIpc } from './ipc.ts';

export function handleShortcutNewWindowKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
  if ((e.key || '').toLowerCase() !== 'n') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (confirmGet() || lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  if (paletteIsOpen()) return;
  e.preventDefault();
  hologramIpc.openNewWindow();
}
