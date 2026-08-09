'use strict';

// Ctrl+Shift+N＝新しいウィンドウを開く（#32 St1: プロセス1つ、ウィンドウ N 個）。ウィンドウの
// 生成は main が持ち（lib-window.ts の createWindow）、ここはその操作を IPC で転送するだけ。
// 登録は他の document レベルのショートカットと並んで GlobalShortcuts コンポーネント
// （app/App.tsx）にあり、防ぎと操作は、それが呼ぶものの隣であるここに残る。
//
// 防ぎの形はこのリポジトリの作法どおり（selection-builder.ts の Ctrl+A、panels.ts の
// Ctrl+Shift+B）＝打ち込み中と、モーダルが画面を持っている間は、このキーに手を出さない。
// 確認や設定やパレットのダイアログの背後から2つ目のウィンドウを開くと、その流れを途中で
// 捨てて新しいウィンドウの文脈へ移ることになり、そこでのこのキーの意味とは違う。
import { get as confirmGet } from './confirm.ts';
import { isOpen as paletteIsOpen } from './command-registry.ts';
import { isOpen as lightboxIsOpen } from './lightbox.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { hologramIpc } from './ipc.ts';

export function handleShortcutNewWindowKey(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
  if ((e.key || '').toLowerCase() !== 'n') return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (confirmGet() || lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  if (paletteIsOpen()) return;
  e.preventDefault();
  hologramIpc.openNewWindow();
}
