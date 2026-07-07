// Searchbox bridge (window.corpusSearchBox): connects viewer.js (search DATA +
// business logic) to the searchbox React island (react-aria ComboBox owning the
// input + suggest dropdown). The handlers are functions, so they ride this
// dedicated bridge instead of the serializable corpusStore — same reasoning as
// menu.js / kind-menu.js. The island loads before viewer.js finishes booting
// (viewer awaits corpusI18n first), so it PULLS handlers() lazily at interaction
// time instead of caching them at mount. The VALUE itself never travels here —
// that's corpusStore 'searchQuery'.
(function () {
  'use strict';
  let handlers: CorpusSearchBoxHandlers | null = null; // { getSuggestions(q), onPick(item), onConfirmText() }
  window.corpusSearchBox = {
    init(h: CorpusSearchBoxHandlers) {
      handlers = h;
    }, // viewer.js registers its callbacks
    handlers() {
      return handlers;
    }, // the island pulls them per interaction
  };
})();
