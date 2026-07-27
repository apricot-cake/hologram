// Naming-prompt bridge — the imperative→declarative bridge for the shared naming
// dialog (a shadcn Dialog + Input). Callers pass open(config) a label + an initial
// value + onOk(value); the React island (PromptHost) renders the dialog, owns the
// input state, and calls back with the trimmed value.
//
// This exists because window.prompt() does not work here: Electron's renderer
// answers `prompt() is not supported.` and throws, so every naming flow that reached
// for it silently died at the first keystroke of the user's intent.
//
// Same shape as confirm.ts (callbacks aren't serializable, so this is a dedicated
// bridge, not hologramStore). ModalChrome (App.tsx) reads get()/subscribe() for the
// modal-open body class + titlebar tint, exactly as it does for confirm.
//
// config: { title, value?, okLabel?, cancelLabel?, placeholder?, onOk(value:string) }
let current: HologramPromptModel | null = null;
let seq = 0;
const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
};
export function open(config: HologramPromptConfig) {
  current = Object.assign({ openId: ++seq }, config);
  notify();
}
export function close() {
  current = null;
  notify();
}
export function get() {
  return current;
}
export function subscribe(cb: () => void) {
  subs.add(cb);
  return () => subs.delete(cb);
}
