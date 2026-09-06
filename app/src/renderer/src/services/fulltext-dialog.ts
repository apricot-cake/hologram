import { get as confirmGet } from './confirm.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { registerShortcut, tryRun } from './shortcut-registry.ts';

let opened = false;
let sequence = 0;
const subscribers = new Set<() => void>();
export const isOpen = () => opened;
export const openId = () => sequence;
export function open() {
  if (opened) return;
  opened = true;
  sequence++;
  for (const cb of subscribers) cb();
}
export function close() {
  if (!opened) return;
  opened = false;
  for (const cb of subscribers) cb();
}
export function subscribe(cb: () => void) {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}
registerShortcut({
  id: 'fulltext.open',
  titleKey: 'shortcutOpenFulltextSearch',
  defaultCombo: 'Ctrl+Shift+f',
  canExecute: () => !opened && !confirmGet() && !settingsIsOpen(),
  perform: open,
});
export function handleShortcutFullTextKey(e: KeyboardEvent) {
  tryRun('fulltext.open', e);
}
