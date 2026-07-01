import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { initI18n } from '../_shared/i18n.js';
import './styles.css';

// Tiny external open/closed store so non-React code (the brand-bar gear in
// viewer.js) can drive the modal via window.corpusSettings.open() while React
// stays the source of truth through useSyncExternalStore.
function makeStore() {
  let open = false;
  const subs = new Set();
  return {
    isOpen: () => open,
    set: (v) => {
      const next = !!v;
      if (next === open) return;
      open = next;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); },
  };
}

const store = makeStore();
let mounted = false;

function mount(rootEl) {
  if (mounted) return;
  const el = rootEl || document.getElementById('settingsRoot');
  if (!el) return;
  mounted = true;
  createRoot(el).render(<App store={store} />);
}

window.corpusSettings = {
  open: () => store.set(true),
  close: () => store.set(false),
  isOpen: store.isOpen, // vanilla code (viewer.js) checks this to suppress shortcuts
  mount,
};

// Auto-mount once i18n is ready (so t() is synchronous) and the DOM is parsed.
initI18n().then(() => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount());
  } else {
    mount();
  }
});
