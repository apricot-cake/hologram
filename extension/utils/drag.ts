// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// Drag-to-save: when the user starts dragging an image, a drop zone
// appears; the image is saved to Hologram ONLY if dropped into that zone. Dragging
// an image anywhere else (to disk, to reorder, etc.) does nothing — no accidental
// saves. On drop, the background fetches the post metadata and saves the dragged
// illustration itself (no screenshot) via the native host. Which post an image
// belongs to comes from media-identity.js, shared with overlay.js's hover save
// button so the two paths can never disagree about what a save records.
import { glassUi } from './glass-ui';
import { createI18n } from './i18n';
import { collectImageUrls, getMediaIdentitySite } from './media-identity';

export async function startDrag(): Promise<void> {
  interface PendingDrag {
    type: string;
    platform: string;
    postUrl: string;
    imageUrls: string[];
  }

  const siteConfig = getMediaIdentitySite();
  if (!siteConfig) return;

  interface DropZone {
    el: HTMLDivElement;
    ring: HTMLDivElement;
    badge: HTMLDivElement;
    label: HTMLDivElement;
  }
  type ZoneState = 'idle' | 'over' | 'busy' | 'ok' | 'partial' | 'fail';

  let pending: PendingDrag | null = null;
  let zone: DropZone | null = null;
  let hideAnim: Animation | null = null; // in-flight exit fade, cancelled if the zone re-shows
  let savingViaDrop = false; // true between a drop-in-zone and its result, so dragend doesn't hide early

  const { getMessage: t, partialSaveText, saveFailureText } = await createI18n();

  // Visual language is shared with the other content-script entrypoints. The palette is theme-independent (#136:
  // near-opaque dark scrim + white ink). The zone element persists across
  // saves; setState re-applies the surface properties before each show so a
  // state-tinted border/shadow from the previous save is never baked in.
  // See glass-ui.ts for the CSP/Trusted Types constraints that shape how
  // everything is styled and built.
  const G = glassUi;

  function ensureOverlay(): DropZone {
    if (zone) return zone;
    // A local const (never reassigned) instead of reading the outer `zone`
    // let from inside these nested closures — TS's null-narrowing on a
    // closure-captured outer variable doesn't cross a function boundary, but a
    // const captured by the same closures narrows fine.
    const el = document.createElement('div');
    el.id = '__hologramDropZone';
    el.style.cssText = [
      'position:fixed',
      'right:24px',
      'bottom:24px',
      'z-index:2147483647',
      'width:280px',
      'box-sizing:border-box',
      'display:none',
      'flex-direction:column',
      'align-items:center',
      'gap:14px',
      'padding:32px 22px 28px',
      'border-radius:20px',
      'border:1px solid transparent', // themed surface props (border-color/background/…) land in setState
      `font:600 14px/1.5 ${G.FONT_SANS}`,
      'text-align:center',
      'pointer-events:auto',
      `transition:transform ${G.DUR_HOVER}ms ${G.EASE_OUT}, border-color ${G.DUR_HOVER}ms, box-shadow ${G.DUR_HOVER}ms`,
    ].join(';');

    // Dashed inset ring = the "drop target" affordance; hidden on result states.
    // Children are pointer-events:none so dragenter/dragleave never flicker.
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;inset:7px;border-radius:14px;border:1.5px dashed transparent;pointer-events:none;transition:border-color ${G.DUR_HOVER}ms,opacity ${G.DUR_HOVER}ms;`;
    el.appendChild(ring);

    const badge = document.createElement('div');
    badge.style.cssText = `width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${G.ACCENT_SOFT};color:${G.ACCENT_TEXT};pointer-events:none;transition:background ${G.DUR_HOVER}ms,color ${G.DUR_HOVER}ms;`;
    el.appendChild(badge);

    const label = document.createElement('div');
    label.style.cssText = 'pointer-events:none;max-width:100%;'; // ink color inherits from the card (set in setState)
    el.appendChild(label);

    const z: DropZone = { el, ring, badge, label };
    zone = z;
    el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      setState(z, 'over');
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', () => {
      setState(z, 'idle');
    });
    el.addEventListener('drop', onDrop, true);
    document.body.appendChild(el);
    return z;
  }

  function setState(z: DropZone, state: ZoneState, text?: string) {
    if (text !== undefined) z.label.textContent = text;
    z.badge.replaceChildren();
    z.el.style.transform = '';
    z.el.style.background = G.CARD_BG;
    z.el.style.color = G.TEXT;
    z.el.style.borderColor = G.CARD_BORDER;
    z.el.style.boxShadow = G.CARD_SHADOW;
    z.ring.style.opacity = state === 'idle' || state === 'over' ? '1' : '0';
    z.ring.style.borderColor = G.RING;
    switch (state) {
      case 'idle':
        z.badge.style.background = G.ACCENT_SOFT;
        z.badge.style.color = G.ACCENT_TEXT;
        z.badge.appendChild(G.makeIcon(G.ICONS.drop));
        break;
      case 'over':
        z.badge.style.background = G.ACCENT_FILL;
        z.badge.style.color = '#fff';
        z.badge.appendChild(G.makeIcon(G.ICONS.drop));
        z.el.style.transform = 'scale(1.04) translateY(-2px)';
        z.el.style.borderColor = 'rgba(40,168,219,0.85)';
        z.el.style.boxShadow = `${G.CARD_SHADOW}, 0 0 0 4px rgba(40,168,219,0.22)`;
        z.ring.style.borderColor = G.RING_ACCENT;
        break;
      case 'busy':
        z.badge.style.background = G.BADGE_NEUTRAL;
        z.badge.style.color = G.ACCENT_TEXT;
        z.badge.appendChild(G.makeSpinner());
        break;
      case 'ok':
        z.badge.style.background = G.OK_GREEN;
        z.badge.style.color = '#fff';
        z.badge.appendChild(G.makeIcon(G.ICONS.check));
        z.el.style.borderColor = 'rgba(48,164,108,0.65)';
        break;
      case 'partial':
        z.badge.style.background = G.WARN_AMBER;
        z.badge.style.color = '#fff';
        z.badge.appendChild(G.makeIcon(G.ICONS.warn));
        z.el.style.borderColor = 'rgba(232,161,58,0.65)';
        break;
      case 'fail':
        z.badge.style.background = G.FAIL_RED;
        z.badge.style.color = '#fff';
        z.badge.appendChild(G.makeIcon(G.ICONS.cross));
        z.el.style.borderColor = 'rgba(229,72,77,0.65)';
        break;
    }
  }

  function showOverlay() {
    const z = ensureOverlay();
    if (hideAnim) {
      hideAnim.cancel();
      hideAnim = null;
    }
    z.el.style.opacity = '';
    setState(z, 'idle', t('dragDropHint'));
    const wasHidden = z.el.style.display === 'none';
    z.el.style.display = 'flex';
    if (wasHidden && !G.REDUCED_MOTION) {
      // App toast entrance: rise + slight scale settle at the pop tier.
      z.el.animate(
        [
          { opacity: 0, transform: 'translateY(14px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: G.DUR_POP, easing: G.EASE_OUT },
      );
    }
  }
  function hideOverlay(fade = false) {
    const z = zone;
    if (!z || z.el.style.display === 'none') return;
    if (!fade || G.REDUCED_MOTION) {
      z.el.style.display = 'none';
      return;
    }
    // Exit = the entrance played back (app toast hides through the same
    // rise/settle transition), on the shared pop tier.
    const anim = z.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(14px) scale(0.96)' }], { duration: G.DUR_POP, easing: G.EASE_OUT });
    hideAnim = anim;
    anim.onfinish = () => {
      if (hideAnim === anim) {
        z.el.style.display = 'none';
        hideAnim = null;
      }
    };
  }

  document.addEventListener(
    'dragstart',
    (e) => {
      if (!chrome.runtime?.id) return;
      const target = e.target as Element | null;
      const img = (target?.closest?.('img') as HTMLImageElement | null) || (target?.tagName === 'IMG' ? (target as HTMLImageElement) : null);
      if (!img) return;
      const identity = siteConfig.extractIdentity(img);
      if (!identity || !identity.link) return;
      pending = { type: 'imageDragged', platform: siteConfig.platform, postUrl: identity.link, imageUrls: collectImageUrls(img, siteConfig.platform) };
      showOverlay();
    },
    true,
  );

  // Drag ended without dropping into the zone (dropped elsewhere or cancelled).
  document.addEventListener(
    'dragend',
    () => {
      if (savingViaDrop) return; // a zone drop is handling its own feedback/hide
      pending = null;
      hideOverlay(true);
    },
    true,
  );

  function onDrop(e: Event) {
    e.preventDefault();
    e.stopPropagation();
    const p = pending;
    pending = null;
    if (!p) {
      hideOverlay();
      return;
    }
    savingViaDrop = true;
    const z = ensureOverlay();
    setState(z, 'busy', t('bannerSaving'));
    chrome.runtime.sendMessage(p, (res: any) => {
      const ok = res && res.ok;
      const partial = ok && res.metaOk === false; // saved, but no post metadata
      const grouped = ok && !partial && res.grouped > 0; // same post saved earlier → merges into one card in the app
      const text = partial ? partialSaveText(res.metaReason) : grouped ? t('bannerSavedGrouped', [res.grouped + 1]) : ok ? t('bannerSaved') : saveFailureText(res?.errorKind);
      setState(z, partial ? 'partial' : ok ? 'ok' : 'fail', text);
      if (ok && !G.REDUCED_MOTION) {
        // Small badge pop so the state flip reads even in peripheral vision
        // (app hologramBadgePop: .3s on the shared ease-out curve).
        z.badge.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, easing: G.EASE_OUT });
      }
      setTimeout(
        () => {
          hideOverlay(true);
          savingViaDrop = false;
        },
        // grouped: hold a beat longer — it explains where the image "went"
        partial ? 2600 : grouped ? 2200 : 1400,
      );
    });
  }
}
