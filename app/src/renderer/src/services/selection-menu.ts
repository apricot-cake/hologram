// Selected-text context menu (#167) — コピー / Googleで検索 / ライブラリ内検索.
//
// Why this exists at all: Electron ships no default context menu and the window
// runs removeMenu() (app/src/main/index.ts), so Chromium's own "copy / search"
// rows are gone with it. Selecting body text and right-clicking it — a reflex on
// Windows and in every browser — hit nothing outside the card grid, and hit a
// card menu with no text rows inside it.
//
// Two faces, ONE item list:
//   - on a card, post-grid-builder splices these rows into the card's own menu,
//     so text on a card still produces exactly one menu;
//   - everywhere else (inspector body, metadata, …) handleContextmenu below opens
//     a menu holding only these rows.
//
// The document-level handler only fires when nothing else claimed the event.
// Every existing context menu (card / poster / tab / folder / saved search / tag
// chip) calls preventDefault(), so defaultPrevented is the "already handled"
// signal — no registry of surfaces to keep in sync, and "no selection" still
// means "no menu", exactly as before.

import { hologramIpc } from './ipc.ts';
import { open as menuOpen } from './menu.ts';

// Menu-row glyphs, same 24×24 stroke set the card menu draws (post-grid-builder's
// CM_IC) — the magnifier is literally the SauceNAO/ascii2d row's icon, since
// ライブラリ内検索 is the same verb pointed inward.
const SEL_IC = {
  copy: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  web: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/></svg>',
  library: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
};

// `sel*` so a row can be spliced into ANY other menu without colliding with the
// acts that menu already owns.
const ACTS = ['selCopy', 'selWeb', 'selLibrary'];

// The one place the web-search URL is built. Google is fixed by decision (#167):
// a switchable engine has no demand yet, and when it gets some, this function is
// the whole seam.
//
// Sliced because a URL has real length limits (Chromium ~2MB, the Windows shell
// far less) and a selection has none — a whole post pasted into a query string
// would fail as a URL rather than as a search.
export function webSearchUrl(text: string): string {
  return 'https://www.google.com/search?q=' + encodeURIComponent(text.slice(0, 1000));
}

// A selection is a search TERM, not a document: newlines and runs of spaces from
// the source layout are noise in both the web query and the library query.
export function searchTermOf(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// The selected text IF the right-click landed on the selection, '' otherwise.
//
// Chromium collapses a selection when you right-click away from it, so a menu
// keyed on the selection has to ask the same question: without this test, text
// left selected in the inspector would keep offering コピー while the user
// right-clicks something else across the app.
//
// intersectsNode, NOT containsNode: a right-click lands on the ELEMENT that
// HOLDS the selected text, and a range over that text neither contains that
// element nor partially contains it (the element is an inclusive ancestor of
// both range ends, which is precisely the case both of those predicates exclude)
// — containsNode(el, true) is false there, which would have killed the feature on
// its main path. intersectsNode asks the question that actually matters: does
// this node overlap the range at all.
export function selectionTextAt(target: EventTarget | null): string {
  const sel = typeof window === 'undefined' ? null : window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
  const text = searchTermOf(sel.toString());
  if (!text) return '';
  if (target instanceof Node && !sel.getRangeAt(0).intersectsNode(target)) return '';
  return text;
}

export interface SelectionMenuDeps {
  t(key: string): string;
  /** Run `text` as the library's search term — search-box-builder's searchFor. */
  searchInLibrary(text: string): void;
}

export function makeSelectionMenu(deps: SelectionMenuDeps) {
  // Ordered the way Chromium orders them: the text rows come first, because the
  // gesture that produced them was aimed at the text. On a card they sit above
  // the card's own rows for the same reason (and only while a selection exists —
  // the card menu is unchanged otherwise).
  function items(): HologramMenuItem[] {
    return [
      { label: deps.t('ctxCopyText'), act: 'selCopy', icon: SEL_IC.copy },
      { label: deps.t('ctxSearchWeb'), act: 'selWeb', icon: SEL_IC.web },
      { label: deps.t('ctxSearchLibrary'), act: 'selLibrary', icon: SEL_IC.library },
    ];
  }

  /** true = the act belonged to this menu and has been handled. */
  function pick(text: string, item: HologramMenuItem): boolean {
    const act = item.act;
    if (!act || !ACTS.includes(act)) return false;
    const term = searchTermOf(text || '');
    if (!term) return true; // ours, but nothing left to act on
    if (act === 'selCopy') hologramIpc.copyText(term);
    else if (act === 'selWeb') hologramIpc.openExternal(webSearchUrl(term));
    else if (act === 'selLibrary') deps.searchInLibrary(term);
    return true;
  }

  // Document-level fallback: the surfaces that have no menu of their own.
  function handleContextmenu(e: MouseEvent) {
    if (e.defaultPrevented) return; // another menu already owns this click
    const text = selectionTextAt(e.target);
    if (!text) return; // no selection → no menu, same as before
    e.preventDefault();
    menuOpen({ items: items(), x: e.clientX, y: e.clientY }, (item) => {
      pick(text, item);
    });
  }

  return { items, pick, handleContextmenu };
}
