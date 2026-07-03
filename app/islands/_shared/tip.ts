// Instant glass tooltip (.ui-tip) — replaces native `title` attributes on
// custom controls: the OS tooltip is delayed (~1s) and OS-styled, which reads
// as cheap next to the glass UI. One module-level singleton div spans every
// island root (plain DOM, no React), so any component can spread tipProps()
// onto its trigger. Styling lives in index.html (.ui-tip + .glass-frost);
// this module only owns show/hide/placement.
//
// Placement: centered above the target, flipped below when there's no room,
// clamped into the viewport. Measured with offsetWidth/Height (NOT
// getBoundingClientRect — the pop-in animation scales the element and rect
// measurements mid-animation are ~4% small; see corpus-design ポップ配置).

let el: HTMLDivElement | null = null;

function host(): HTMLDivElement {
  if (!el) {
    el = document.createElement('div');
    el.className = 'ui-tip glass-frost';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
  }
  return el;
}

export function showTip(target: HTMLElement, text: string): void {
  if (!text) return;
  const d = host();
  d.textContent = text;
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
export function tipProps(text: string) {
  return {
    onPointerEnter: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text),
    onPointerLeave: hideTip,
    onPointerDown: hideTip,
    onFocus: (e: { currentTarget: HTMLElement }) => showTip(e.currentTarget, text),
    onBlur: hideTip,
  };
}
