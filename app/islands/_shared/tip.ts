// The single shared hover-hint surface (.ui-tip) — one tooltip that EVERY
// hover hint drives, so tooltips can't drift apart in material/timing/placement.
// Two ways to trigger it, both feeding the same TooltipHost island:
//   1. React:      spread tipProps(text) onto a trigger (hover + keyboard focus).
//   2. Any markup: put data-tip="…" on an element (TooltipHost's document-level
//      delegation shows it) — lets static HTML / orchestrator-set attributes opt
//      in with just an attribute, replacing native `title` (OS-delayed, OS-styled).
// data-tip-rich (or the rich arg) switches to the multi-line variant (wraps, wider)
// for explanatory hints; the default is a single-line label. Styling lives in
// index.html (.ui-tip / .ui-tip--rich + the hint-glass material); this module only owns
// the show/hide store — rendering, placement, and the [data-tip] delegation live in
// tooltip/TooltipHost.tsx (App.tsx mounts it onto document.body).

export interface TipModel {
  target: HTMLElement;
  text: string;
  rich: boolean;
}

// Last-shown content is kept (not nulled) on hide so the text stays rendered while
// the tooltip fades out via CSS — same idiom as toast/Toast.tsx. `shown` is the
// only thing hideTip() flips.
let current: TipModel | null = null;
let shown = false;
const subs = new Set<() => void>();
function notify(): void {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* ignore */
    }
  }
}

export function showTip(target: HTMLElement, text: string, rich = false): void {
  if (!text) return;
  current = { target, text, rich };
  shown = true;
  notify();
}

export function hideTip(): void {
  if (!shown) return;
  shown = false;
  notify();
}

// Snapshot accessors for TooltipHost's useSyncExternalStore (stable refs between changes).
export function getTip(): TipModel | null {
  return current;
}
export function getTipShown(): boolean {
  return shown;
}
export function subscribeTip(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

// Spreadable trigger props: hover + keyboard focus show, leave/blur/press hide
// (macOS help tags hide on click; the label is redundant once acted on).
export function tipProps(text: string, rich = false) {
  return {
    onPointerEnter: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text, rich),
    onPointerLeave: hideTip,
    onPointerDown: hideTip,
    onFocus: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text, rich),
    onBlur: hideTip,
  };
}
