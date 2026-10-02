// 通知をネイティブのトップレイヤーへ載せる。モーダルの外側は inert に
// なるため、モーダル表示中は ShadowRoot のホストもその内側へ移す。
const STATE_KEY = Symbol.for('hologram.toast-layer');
interface ToastLayerState {
  stack: HTMLElement;
  host: HTMLElement;
  modal: Element | null;
  observer: MutationObserver;
}
const scope = globalThis as typeof globalThis & { [STATE_KEY]?: ToastLayerState };

function sync(state: ToastLayerState) {
  const root = state.stack.getRootNode();
  if (!(root instanceof ShadowRoot) && !state.stack.isConnected) {
    state.observer.disconnect();
    delete scope[STATE_KEY];
    return;
  }
  let modal: Element | null = null;
  try {
    const dialogs = [...document.querySelectorAll('dialog:modal')];
    modal = document.activeElement?.closest('dialog:modal') ?? dialogs.at(-1) ?? null;
  } catch {
    // Popover API を持たない環境では通常の固定レイヤーを使う。
  }
  const parent = modal ?? document.body ?? document.documentElement;
  const changed = state.modal !== modal;
  if (state.host.parentElement !== parent) {
    if (state.host.isConnected && typeof parent.moveBefore === 'function') parent.moveBefore(state.host, null);
    else parent.appendChild(state.host);
  }
  state.modal = modal;
  const stack = state.stack;
  if (typeof stack.showPopover !== 'function') return;
  if (!stack.querySelector('[data-variant="toast"]')) {
    if (stack.matches(':popover-open')) stack.hidePopover();
    return;
  }
  // 後から開いたモーダルより前面に置き直す。
  if (changed && stack.matches(':popover-open')) stack.hidePopover();
  if (!stack.matches(':popover-open')) stack.showPopover();
}

export function mountToastLayer(stack: HTMLElement): void {
  stack.setAttribute('popover', 'manual');
  const root = stack.getRootNode();
  const host = root instanceof ShadowRoot ? (root.host as HTMLElement) : stack;
  let state = scope[STATE_KEY];
  if (!state || state.stack !== stack) {
    state?.observer.disconnect();
    const observer = new MutationObserver(() => {
      if (scope[STATE_KEY]) sync(scope[STATE_KEY]);
    });
    state = { stack, host, modal: null, observer };
    scope[STATE_KEY] = state;
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    if (root instanceof ShadowRoot) observer.observe(root, { childList: true, subtree: true });
  }
  sync(state);
}
