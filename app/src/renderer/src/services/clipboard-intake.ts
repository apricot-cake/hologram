'use strict';

// Paste-to-import (#85) — Ctrl/Cmd+V anywhere in the app window drops whatever
// image is on the clipboard into the library.
//
// SCOPE: this is the in-app key and nothing else. An OS-wide hotkey (globalShortcut)
// and an OS notification were deliberately deferred to v2 — #85's 2026-07-16 comment
// has the reasoning (a system-wide key grab, a registration-failure UI and a
// will-quit unregister are the expensive half of the feature, for a convenience the
// window-focus route already covers). Pulling a URL out of the clipboard's text/html
// is not done here either, and not "not yet built" but ruled out: a record with a url
// presents itself as an SNS post, which is a lie about where those pixels came from.
//
// THE GUARD IS THE FEATURE. Ctrl+V is the paste key, so the only way this can be
// added at all is by staying out of the way of every place a paste means what it
// normally means: the tag editor, the search box, any contentEditable, and any
// overlay that owns the screen. That is the same guard shape every other app-wide
// shortcut uses (services/panels.ts's Ctrl+Shift+B, selection-builder.ts's Ctrl+A /
// Ctrl+C), and it is written the same way on purpose — a shortcut that guards
// differently from its neighbours is a shortcut that will drift away from them.
//
// Registration lives in the GlobalShortcuts component (app/App.tsx) with the rest of
// the document-level keys; guard + action stay here, next to the IPC call they make.
import { get as confirmGet } from './confirm.ts';
import { isOpen as paletteIsOpen } from './command-registry.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isActive as imageViewIsActive } from './image-tab.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { get as storeGet } from './store.ts';
import { importClipboard } from './posts.ts';
import { formatDate } from './format.ts';
import { notify } from './ui.ts';
import { t } from '../_shared/i18n.ts';

/**
 * Ask main for whatever image the clipboard holds, and report the outcome.
 *
 * The three outcomes are three different toasts on purpose: an empty clipboard is
 * the common case (the user had text on it) and must not read as a failure, which
 * is #85's own acceptance condition. The grid refresh is NOT done here — main
 * pushes `posts-changed` after the write, the same route an in-app delete uses.
 */
export async function importFromClipboard(): Promise<void> {
  try {
    const res = await importClipboard(t('clipboardTitle', [formatDate(new Date())]));
    if (!res || res.error) notify(t('importFailed'));
    else if (res.empty) notify(t('clipboardNoImage'));
    else notify(t('clipboardImported'));
  } catch {
    notify(t('importFailed'));
  }
}

/**
 * Ctrl/Cmd+V. Registration lives in the GlobalShortcuts component (app/App.tsx).
 *
 * Shift/Alt are left alone: Ctrl+Shift+V is "paste without formatting" in most
 * editors, so claiming it here would break the one paste variant a user is most
 * likely to reach for inside a field this handler has already stepped back from.
 */
export function handleShortcutClipboardKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  if ((e.key || '').toLowerCase() !== 'v') return;
  // The one guard #85 calls its most important: while the caret is in a field,
  // Ctrl+V is the ordinary paste and this handler does not exist.
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  if (confirmGet() || lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  if (paletteIsOpen()) return;
  // The single-image view is its own screen with its own keys — same exclusion as
  // Ctrl+C / Space (selection-builder.ts).
  if (imageViewIsActive()) return;
  // Trash (#268): a paste is a new save, and the trash is the one destination where
  // saving into the library is off. Pasting there would silently drop the image into
  // a grid the user is not looking at. Asked of the store, like every other guard
  // above asks its own module — reading a body class would be the DOM sniffing #153
  // rules out, and it made the class exist for no other reader.
  if (storeGet('browseMode') === 'trash') return;
  e.preventDefault();
  void importFromClipboard();
}
