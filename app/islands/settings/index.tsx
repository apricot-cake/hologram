import { App as SettingsApp } from './App.tsx';
import type { OpenStore } from './App.tsx';
import './styles.css';

// Settings modal — lives under the single App root now (SettingsHost is portaled into
// #settingsRoot by app/App.tsx). A tiny external open/closed store lets non-React code
// (the brand-bar gear in viewer.js) drive the modal via window.corpusSettings.open()
// while React stays the source of truth through useSyncExternalStore. i18n is resolved by
// the unified root before it renders, so t() is synchronous inside the modal.
function makeStore(): OpenStore {
  let open = false;
  const subs = new Set<() => void>();
  return {
    isOpen: () => open,
    set: (v) => {
      const next = !!v;
      if (next === open) return;
      open = next;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}

const store = makeStore();

window.corpusSettings = {
  open: () => store.set(true),
  close: () => store.set(false),
  isOpen: store.isOpen, // vanilla code (viewer.js) checks this to suppress shortcuts
};

export function SettingsHost() {
  return <SettingsApp store={store} />;
}
