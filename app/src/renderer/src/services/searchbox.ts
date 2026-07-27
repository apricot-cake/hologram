// Searchbox bridge: connects viewer.ts (search DATA + business logic) to the
// searchbox React component (react-aria ComboBox owning the input + suggest dropdown).
// The handlers are functions, so they ride this dedicated bridge instead of the
// serializable hologramStore — same reasoning as menu.ts / kind-menu.ts. The component
// loads before viewer.ts finishes booting (viewer awaits hologramI18n first), so it
// PULLS handlers() lazily at interaction time instead of caching them at mount. The
// VALUE itself never travels here — that's hologramStore 'searchQuery'. A real ES
// module (named exports).

let registered: HologramSearchBoxHandlers | null = null; // { getSuggestions(q), onPick(item), onConfirmText() }

// viewer.ts registers its callbacks.
export function init(h: HologramSearchBoxHandlers): void {
  registered = h;
}

// The component pulls them per interaction.
export function handlers(): HologramSearchBoxHandlers | null {
  return registered;
}

// Focus travels the opposite way: the component registers a focus callback at
// mount, and the `/` / Ctrl+K shortcut handler (search-box-builder) calls
// focusSearchBox() — replacing the old getElementById('#searchBox') id
// contract (P2④, #153 zero-tolerance). Returns an unregister so an unmounting
// component detaches cleanly.
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
