// Global history page (#145) — open/closed state for the sidebar-footer-anchored
// Popover. Same "pure state, React reads through useSyncExternalStore" shape as
// settings.ts / command-registry.ts's own open/close/isOpen/subscribe — a real ES
// module so Ctrl+H (registered here) and the command palette's cmd:history
// (command-builder.ts) can open it without reaching into LeftSidebar.tsx, which
// owns only the Popover's rendering.
import { get as confirmGet } from './confirm.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isOpen as paletteIsOpen } from './command-registry.ts';
import { isHidden as panelsHidden } from './panels.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { registerShortcut, tryRun } from './shortcut-registry.ts';

/** The shape Base UI Popover's `anchor` prop accepts for a point instead of an element. */
export interface VirtualAnchor {
  getBoundingClientRect(): DOMRect;
}

let open_ = false;
// #145 design §2: "錨が画面に無い時の退避" — when the sidebar is fully hidden
// (Ctrl+Shift+B / panels.ts), the footer row that would normally anchor the
// popover is still mounted but translated off-screen (components/ui/sidebar.tsx's
// offcanvas transform), so anchoring to it would paint the panel off-screen too.
// null means "use the trigger row" (the normal case); set only while opening with
// the sidebar hidden. Same VirtualElement technique ContextMenu.tsx/KindMenu.tsx
// already use for a cursor-anchored menu, pointed at the window's bottom-left
// instead of a click position.
let anchorOverride: VirtualAnchor | null = null;
const subs = new Set<() => void>();

export function isOpen(): boolean {
  return open_;
}

/** Non-null only while the sidebar is hidden — LeftSidebar.tsx passes this straight to PopoverContent's `anchor`. */
export function anchor(): VirtualAnchor | null {
  return anchorOverride;
}

function set(v: boolean): void {
  const next = !!v;
  if (next === open_) return;
  open_ = next;
  for (const cb of [...subs]) cb();
}

export function open(): void {
  anchorOverride = panelsHidden() ? { getBoundingClientRect: () => new DOMRect(0, window.innerHeight, 0, 0) } : null;
  set(true);
}

export function close(): void {
  set(false);
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// Ctrl+H — the third of the three entry points (#145 design §2: sidebar footer
// row / Ctrl+H / palette's cmd:history all open the SAME panel). Guard shape
// mirrors the palette's own Ctrl+K (command-registry.ts's canExecuteOpenPalette):
// kept live inside input fields (no isTypingTarget check) on purpose — this is an
// app-wide entry point, not a grid action, the same reasoning that comment gives.
function canExecuteOpenHistory(): boolean {
  if (open_) return false;
  if (confirmGet() || lightboxIsOpen()) return false;
  if (settingsIsOpen()) return false;
  if (paletteIsOpen()) return false;
  return true;
}

registerShortcut({
  id: 'history.open',
  titleKey: 'shortcutOpenHistory',
  defaultCombo: 'Ctrl+h',
  canExecute: canExecuteOpenHistory,
  perform: open,
});

export function handleShortcutHistoryKey(e: KeyboardEvent): void {
  tryRun('history.open', e);
}
