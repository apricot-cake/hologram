import { get as confirmGet } from './confirm.ts';
import { isOpen as fulltextIsOpen } from './fulltext-dialog.ts';
import { isHidden as panelsHidden } from './panels.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { registerShortcut, tryRun } from './shortcut-registry.ts';

/** Base UI Popover の `anchor` prop が、要素の代わりに1点を受け取るときに取る形。 */
export interface VirtualAnchor {
  getBoundingClientRect(): DOMRect;
}

let open_ = false;
// #145 の設計 §2: 「錨が画面に無い時の退避」――サイドバーが完全に隠れて
// いる（Ctrl+Shift+B／panels.ts）とき、通常ならポップオーバーをアンカー
// するはずのフッター行はマウントされたままだが画面外へ移動している
// （components/ui/sidebar.tsx の offcanvas トランスフォーム）ので、それに
// アンカーするとパネルまで画面外に描かれてしまう。null は「トリガー行を
// 使う」（通常のケース）を意味し、サイドバーが隠れている間に開くときだけ
// 設定する。ContextMenu.tsx/KindMenu.tsx がカーソルにアンカーするメニュー
// にすでに使っているのと同じ VirtualElement の技法を、クリック位置の
// 代わりにウィンドウの左下へ向けたもの。
let anchorOverride: VirtualAnchor | null = null;
const subs = new Set<() => void>();

export function isOpen(): boolean {
  return open_;
}

/** サイドバーが隠れている間だけ非 null――LeftSidebar.tsx はこれを PopoverContent の `anchor` へそのまま渡す。 */
export function anchor(): VirtualAnchor | null {
  return anchorOverride;
}

function set(v: boolean): void {
  const next = !!v;
  if (next === open_) return;
  open_ = next;
  for (const cb of [...subs]) cb();
}

export function open(): void {
  anchorOverride = panelsHidden() ? { getBoundingClientRect: () => new DOMRect(0, window.innerHeight, 0, 0) } : null;
  set(true);
}

export function close(): void {
  set(false);
}

export function subscribe(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

function canExecuteOpenHistory(): boolean {
  if (open_) return false;
  if (confirmGet()) return false;
  if (settingsIsOpen()) return false;
  if (fulltextIsOpen()) return false;
  return true;
}

registerShortcut({
  id: 'history.open',
  titleKey: 'shortcutOpenHistory',
  defaultCombo: 'Ctrl+h',
  canExecute: canExecuteOpenHistory,
  perform: open,
});

export function handleShortcutHistoryKey(e: KeyboardEvent): void {
  tryRun('history.open', e);
}
