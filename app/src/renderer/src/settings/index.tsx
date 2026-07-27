import { App as SettingsApp } from './App.tsx';
import { close as settingsClose, isOpen as settingsIsOpen, open as settingsOpen, subscribe as settingsSubscribe } from '../services/settings.ts';

// Settings modal — lives under the single App root now (SettingsHost is portaled into
// #settingsRoot by app/App.tsx; the actual dialog renders through a Radix portal onto
// document.body). The open/closed store moved to services/settings.ts so
// orchestrator.ts (the brand-bar gear) and the *-builder.ts Esc/shortcut guards can
// call open()/close()/isOpen() directly instead of reading a global bridge. React
// stays the source of truth through useSyncExternalStore, wired below into the OpenStore
// shape App.tsx expects. i18n is resolved by the unified root before it renders, so t() is
// synchronous inside the modal.
const store = { isOpen: settingsIsOpen, set: (v: boolean) => (v ? settingsOpen() : settingsClose()), subscribe: settingsSubscribe };

export function SettingsHost() {
  return <SettingsApp store={store} />;
}
