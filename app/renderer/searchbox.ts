// Searchbox bridge: connects viewer.ts (search DATA + business logic) to the
// searchbox React island (react-aria ComboBox owning the input + suggest dropdown).
// The handlers are functions, so they ride this dedicated bridge instead of the
// serializable corpusStore — same reasoning as menu.ts / kind-menu.ts. The island
// loads before viewer.ts finishes booting (viewer awaits corpusI18n first), so it
// PULLS handlers() lazily at interaction time instead of caching them at mount. The
// VALUE itself never travels here — that's corpusStore 'searchQuery'. A real ES
// module (named exports).

let registered: CorpusSearchBoxHandlers | null = null; // { getSuggestions(q), onPick(item), onConfirmText() }

// viewer.ts registers its callbacks.
export function init(h: CorpusSearchBoxHandlers): void {
  registered = h;
}

// The island pulls them per interaction.
export function handlers(): CorpusSearchBoxHandlers | null {
  return registered;
}

// Focus travels the opposite way: the island registers a focus callback at
// mount, and the `/` / Ctrl+K shortcut handler (search-box-builder) calls
// focusSearchBox() — replacing the old getElementById('#searchBox') id
// contract (P2④, #153 zero-tolerance). Returns an unregister so an unmounting
// island detaches cleanly.
let focusFn: (() => void) | null = null;
export function registerFocus(fn: () => void): () => void {
  focusFn = fn;
  return () => {
    if (focusFn === fn) focusFn = null;
  };
}
export function focusSearchBox(): void {
  if (focusFn) focusFn();
}
