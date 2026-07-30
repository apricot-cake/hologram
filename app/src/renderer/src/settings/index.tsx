import { App as SettingsApp } from './App.tsx';
import { close as settingsClose, isOpen as settingsIsOpen, open as settingsOpen, subscribe as settingsSubscribe } from '../services/settings.ts';

// Settings modal — a plain child of the single App root (#621 removed the empty
// <div id="settingsRoot"> it used to be portaled into; the dialog portals itself onto
// document.body, so the mount point never did anything). The open/closed store moved to
// services/settings.ts so
// orchestrator.ts (the brand-bar gear) and the *-builder.ts Esc/shortcut guards can
// call open()/close()/isOpen() directly instead of reading a global bridge. React
// stays the source of truth through useSyncExternalStore, wired below into the OpenStore
// shape App.tsx expects. i18n is resolved by the unified root before it renders, so t() is
// synchronous inside the modal.
const store = { isOpen: settingsIsOpen, set: (v: boolean) => (v ? settingsOpen() : settingsClose()), subscribe: settingsSubscribe };

export function SettingsHost() {
  return <SettingsApp store={store} />;
}
