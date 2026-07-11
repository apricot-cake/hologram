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
