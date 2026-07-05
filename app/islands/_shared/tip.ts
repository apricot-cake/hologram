// The single shared hover-hint surface (.ui-tip) — one glass tooltip that EVERY
// hover hint drives, so tooltips can't drift apart in material/timing/placement.
// Three ways to trigger it, all feeding the same singleton div:
//   1. React:      spread tipProps(text) onto a trigger (hover + keyboard focus).
//   2. Any markup: put data-tip="…" on an element (a document-level delegation
//      shows it) — lets non-React / imperative code (viewer.js, static HTML) opt
//      in with just an attribute, replacing native `title` (OS-delayed, OS-styled).
//   3. Imperative: window.corpusTip.show(el, text[, rich]) / .hide().
// data-tip-rich (or the rich arg) switches to the multi-line variant (wraps, wider)
// for explanatory hints; the default is a single-line label. Styling lives in
// index.html (.ui-tip / .ui-tip--rich + the glass material); this module only owns
// show/hide/placement.
//
// Placement: centered above the target, flipped below when there's no room,
// clamped into the viewport. Measured with offsetWidth/Height (NOT
// getBoundingClientRect — the pop-in animation scales the element and rect
// measurements mid-animation are ~4% small; see corpus-design ポップ配置).

let el: HTMLDivElement | null = null;

function host(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    // glass-lens (high-transparency), NOT glass-frost: the tooltip floats over
    // sidebar text and should read as see-through glass (user 2026-07-04 —
    // frost's 55% fill looked like an opaque chip). The rich variant bumps the
    // fill (index.html) so a whole sentence still reads.
    el.className = 'ui-tip glass-lens';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
  }
  return el;
}

export function showTip(target: HTMLElement, text: string, rich = false): void {
  if (!text) return;
  const d = host();
  d.textContent = text;
  d.classList.toggle('ui-tip--rich', rich);
  const r = target.getBoundingClientRect(); // target is static — rect is fine here
  const w = d.offsetWidth;
  const h = d.offsetHeight;
  const gap = 6;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  let y = r.top - h - gap;
  if (y < 8) y = r.bottom + gap; // no room above → below
  d.style.left = x + 'px';
  d.style.top = y + 'px';
  d.classList.add('show');
}

export function hideTip(): void {
  if (el) el.classList.remove('show');
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

// Document-level [data-tip] delegation: any element (React or not) with a data-tip
// attribute gets the same glass tooltip with zero per-element wiring — this is what
// lets static HTML / viewer.js replace native `title` by swapping the attribute.
// pointerover/out bubble (so delegation sees children); the relatedTarget guard and
// the curTarget latch keep it from flickering as the pointer moves within a trigger.
let wired = false;
let curTarget: HTMLElement | null = null;
function trigOf(t: EventTarget | null): HTMLElement | null {
  return t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null;
}
function showFor(trig: HTMLElement): void {
  showTip(trig, trig.dataset.tip || '', trig.hasAttribute('data-tip-rich'));
}
function wireDelegation(): void {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('pointerover', (e) => {
    const trig = trigOf(e.target);
    if (trig && trig !== curTarget) {
      curTarget = trig;
      showFor(trig);
    }
  });
  document.addEventListener('pointerout', (e) => {
    const trig = trigOf(e.target);
    if (trig && !trig.contains(e.relatedTarget as Node)) {
      curTarget = null;
      hideTip();
    }
  });
  // keyboard parity (focusin/out bubble; pointer events don't cover tab focus)
  document.addEventListener('focusin', (e) => {
    const trig = trigOf(e.target);
    if (trig) showFor(trig);
  });
  document.addEventListener('focusout', (e) => {
    if (trigOf(e.target)) hideTip();
  });
}
wireDelegation();

// Imperative handle for non-React code that wants direct control (viewer.js).
if (typeof window !== 'undefined') {
  (window as unknown as { corpusTip?: unknown }).corpusTip = { show: showTip, hide: hideTip };
}
