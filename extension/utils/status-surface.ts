// The one status surface every on-page save path draws with (#44).
//
// It replaces four hand-kept copies of the same table — capture.ts's setBanner,
// drag.ts's setState, bulk-capture.ts's banner and overlay.ts's failure banner
// each decided independently what colour, glyph and animation a state got, and
// they had already drifted (the bulk banner never tinted its outline; the
// failure banner had no busy state to drift with). #226 asked for exactly this
// and was folded into #44 rather than built on top of the old glass helper.
//
// What varies between a banner and a drop zone is `variant`: where it sits and
// how big it is. Everything else — the state vocabulary, the colours, the
// glyphs, the entrance and exit — is the same object.
import { ICONS, makeIcon } from './icons.ts';
import { motion, prefersReducedMotion } from './tokens.ts';
import { ensureUiRoot } from './ui-root.ts';

// #154 §2's vocabulary. `ask` is `partial`'s colour with input attached: a
// question is an amber "this needs you", and giving it its own name keeps
// callers from reaching for `partial` to mean two different things.
export type SurfaceState = 'idle' | 'active' | 'busy' | 'success' | 'partial' | 'ask' | 'error';
export type SurfaceVariant = 'banner' | 'zone';

// State → glyph, in one place. `null` means the spinner rather than a path
// glyph; `resting` is the caller's own idle/active glyph, which is the only
// thing a variant gets to choose (the banner is aiming, the zone is a target).
const GLYPH: Record<SurfaceState, readonly string[] | null> = {
  idle: null,
  active: null,
  busy: null,
  success: ICONS.check,
  partial: ICONS.warn,
  ask: ICONS.warn,
  error: ICONS.cross,
};

export interface StatusSurfaceOptions {
  variant: SurfaceVariant;
  // The glyph for idle/active — ICONS.target for "click the post you want",
  // ICONS.drop for "drop it here".
  resting: readonly string[];
  // Announced to assistive tech. A question is 'alert' (it waits for someone);
  // a running commentary is 'status' (it does not interrupt).
  role?: 'status' | 'alert';
}

export class StatusSurface {
  readonly el: HTMLDivElement;
  readonly badge: HTMLDivElement;
  readonly label: HTMLDivElement;
  readonly ring: HTMLDivElement | null;
  private readonly resting: readonly string[];
  private readonly variant: SurfaceVariant;
  private slotted: HTMLElement | null = null;
  private exitAnim: Animation | null = null;

  constructor(options: StatusSurfaceOptions) {
    this.variant = options.variant;
    this.resting = options.resting;

    this.el = document.createElement('div');
    this.el.className = 'surface';
    this.el.dataset.variant = options.variant;
    this.el.dataset.state = 'idle';
    this.el.setAttribute('role', options.role || 'status');

    // The zone's dashed ring is part of the target, so it exists only there.
    if (options.variant === 'zone') {
      this.ring = document.createElement('div');
      this.ring.className = 'ring';
      this.el.appendChild(this.ring);
    } else {
      this.ring = null;
    }

    this.badge = document.createElement('div');
    this.badge.className = 'badge';
    this.el.appendChild(this.badge);

    this.label = document.createElement('div');
    this.label.className = 'label';
    this.el.appendChild(this.label);
  }

  // Puts it in the shared ShadowRoot. Falls back to the document when there is
  // no root to be had (a document that cannot take one, an engine without
  // constructed stylesheets): unstyled UI still saves the picture, whereas a
  // throw here would take every line after it in the caller (memory:
  // dead-dom-throw-kills-next-line).
  mount(): void {
    const root = ensureUiRoot();
    if (root) root.appendChild(this.el);
    else (document.body || document.documentElement)?.appendChild(this.el);
  }

  // The ONE place a state becomes a look. Colour comes from components.css via
  // the attribute; this method only decides the glyph and the text.
  setState(state: SurfaceState, text?: string): void {
    if (text !== undefined) this.label.textContent = text;
    this.el.dataset.state = state;
    // A question takes input; every other state is a readout that must not
    // intercept clicks meant for the page. The zone is exempt — it is a drop
    // target at all times, which components.css states for the variant.
    if (this.variant === 'banner') this.el.style.pointerEvents = state === 'ask' ? 'auto' : 'none';
    // Whatever the previous state mounted belongs to that state only.
    this.clearSlot();
    this.badge.replaceChildren();
    if (state === 'busy') {
      const spinner = document.createElement('div');
      spinner.className = 'spinner';
      this.badge.appendChild(spinner);
      return;
    }
    this.badge.appendChild(makeIcon(GLYPH[state] || this.resting, this.variant === 'zone' ? 18 : 15));
  }

  // The choice row, the stop button — anything a single state adds. Held here
  // rather than by the caller so that setState can drop it without every caller
  // remembering to.
  slot(el: HTMLElement): void {
    this.clearSlot();
    this.slotted = el;
    this.el.appendChild(el);
  }

  private clearSlot(): void {
    this.slotted?.remove();
    this.slotted = null;
  }

  // Entrance: the app's toast, mirrored to whichever edge this surface lives on.
  // Web Animations rather than CSS because the pop has to run on INSERTION, and
  // its duration is a number the token sheet cannot hand to `animate()`.
  enter(): void {
    this.exitAnim?.cancel();
    this.exitAnim = null;
    this.el.style.opacity = '';
    if (prefersReducedMotion()) return;
    const [from, to] = this.frames();
    this.el.animate([from, to], { duration: motion.durationBase, easing: motion.easeOut });
  }

  // Exit plays the entrance backwards, then removes. An abrupt remove() reads as
  // a glitch next to the app's own toast. Safe to call twice.
  exit(onDone?: () => void): void {
    if (!this.el.isConnected || prefersReducedMotion()) {
      this.el.remove();
      onDone?.();
      return;
    }
    const [gone, here] = this.frames();
    const anim = this.el.animate([here, gone], { duration: motion.durationFast, easing: motion.easeIn });
    this.exitAnim = anim;
    const finish = () => {
      if (this.exitAnim !== anim) return; // a re-entrance cancelled this one
      this.exitAnim = null;
      this.el.remove();
      onDone?.();
    };
    anim.onfinish = finish;
    anim.oncancel = () => {
      if (this.exitAnim === anim) this.exitAnim = null;
    };
  }

  // The banner drops from the top edge and the zone rises from the bottom.
  // Neither carries a permanent offset any more: the banner used to be centred
  // with translateX(-50%), which every keyframe then had to re-state or the pop
  // flung it half a width sideways. It is centred by margin now (components.css,
  // which explains why), so both variants animate from a bare offset.
  private frames(): [Keyframe, Keyframe] {
    return this.variant === 'banner'
      ? [
          { opacity: 0, transform: 'translateY(-14px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ]
      : [
          { opacity: 0, transform: 'translateY(14px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ];
  }

  // The badge flip, for the moment a save lands. Small enough to read in
  // peripheral vision without pulling the eye off the page.
  pop(): void {
    if (prefersReducedMotion()) return;
    this.badge.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, easing: motion.easeOut });
  }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  get hidden(): boolean {
    return this.el.style.display === 'none';
  }

  remove(): void {
    this.exitAnim?.cancel();
    this.exitAnim = null;
    this.el.remove();
  }
}
