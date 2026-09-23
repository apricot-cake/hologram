// 表示中の画像の編集操作を上部ツールバーへ渡す。
export interface ImageEditControls {
  editing: boolean;
  busy?: boolean;
  saving?: boolean;
  cropping?: boolean;
  flipped?: boolean;
  start(): void;
  crop?(): void;
  rotate?(): void;
  flip?(): void;
  reset?(): void;
  save?(): void;
  cancel?(): void;
}
let current: ImageEditControls | null = null;
const listeners = new Set<() => void>();
export const get = () => current;
export const isEditing = () => !!current?.editing;
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify() {
  for (const listener of listeners) listener();
}
export function register(controls: ImageEditControls) {
  current = controls;
  notify();
  return () => {
    if (current === controls) {
      current = null;
      notify();
    }
  };
}
