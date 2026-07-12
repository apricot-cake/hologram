import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getTip, getTipShown, hideTip, showTip, subscribeTip } from '../_shared/tip.ts';

// TooltipHost — V18 §3: React owns the singleton .ui-tip div (portaled onto
// document.body, replacing tip.ts's hand-rolled createElement/appendChild host)
// plus the document-level [data-tip] delegation that used to be wired at module
// load. tip.ts keeps the store + tipProps(); this island renders whatever it holds.
//
// Placement: centered above the target, flipped below when there's no room,
// clamped into the viewport. Measured with offsetWidth/Height (NOT
// getBoundingClientRect — the pop-in animation scales the element and rect
// measurements mid-animation are ~4% small; see corpus-design ポップ配置).

function trigOf(t: EventTarget | null): HTMLElement | null {
  return t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null;
}
function showFor(trig: HTMLElement): void {
  showTip(trig, trig.dataset.tip || '', trig.hasAttribute('data-tip-rich'));
}

export function TooltipHost() {
  const model = useSyncExternalStore(subscribeTip, getTip);
  const shown = useSyncExternalStore(subscribeTip, getTipShown);
  const ref = useRef<HTMLDivElement>(null);

  // Document-level [data-tip] delegation: any element (React or not) with a data-tip
  // attribute gets the same glass tooltip with zero per-element wiring — this is what
  // lets static HTML / orchestrator.ts replace native `title` by swapping the attribute.
  // pointerover/out bubble (so delegation sees children); the relatedTarget guard and
  // the curTarget latch keep it from flickering as the pointer moves within a trigger.
  useEffect(() => {
    let curTarget: HTMLElement | null = null;
    const onOver = (e: PointerEvent) => {
      const trig = trigOf(e.target);
      if (trig && trig !== curTarget) {
        curTarget = trig;
        showFor(trig);
      }
    };
    const onOut = (e: PointerEvent) => {
      const trig = trigOf(e.target);
      if (trig && !trig.contains(e.relatedTarget as Node)) {
        curTarget = null;
        hideTip();
      }
    };
    // keyboard parity (focusin/out bubble; pointer events don't cover tab focus)
    const onFocusIn = (e: FocusEvent) => {
      const trig = trigOf(e.target);
      if (trig) showFor(trig);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (trigOf(e.target)) hideTip();
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // Measure + place. useLayoutEffect runs before paint, so writing left/top after the
  // .show class is already in the render output can't flash a mispositioned frame.
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d || !shown || !model) return;
    const r = model.target.getBoundingClientRect(); // target is static — rect is fine here
    const w = d.offsetWidth;
    const h = d.offsetHeight;
    const gap = 6;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let y = r.top - h - gap;
    if (y < 8) y = r.bottom + gap; // no room above → below
    d.style.left = x + 'px';
    d.style.top = y + 'px';
  }, [model, shown]);

  // pop-solid: text is the tooltip's whole content, so it gets the solid
  // text-float material (#136 — any translucency muddied the text: the 2026-07-12
  // near-solid hint-glass step superseded the 2026-07-04 lens pick, then #136
  // made the whole family fully solid). The material lives in index.html's
  // floating-surface utility layer, shared by the whole hover-hint family
  // (.kb-hint-pop / .qb-help-pop).
  return createPortal(
    <div ref={ref} className={`ui-tip pop-solid${model?.rich ? ' ui-tip--rich' : ''}${shown ? ' show' : ''}`} role="tooltip">
      {model?.text}
    </div>,
    document.body,
  );
}
