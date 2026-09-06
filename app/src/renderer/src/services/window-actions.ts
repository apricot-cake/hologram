'use strict';

import { get as confirmGet } from './confirm.ts';
import { isOpen as fulltextIsOpen } from './fulltext-dialog.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { hologramIpc } from './ipc.ts';

export function handleShortcutNewWindowKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
  if ((e.key || '').toLowerCase() !== 'n') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (confirmGet()) return;
  if (settingsIsOpen()) return;
  if (fulltextIsOpen()) return;
  e.preventDefault();
  hologramIpc.openNewWindow();
}
