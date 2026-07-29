// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// Drag-to-save: when the user starts dragging an image, a drop zone
// appears; the image is saved to Hologram ONLY if dropped into that zone. Dragging
// an image anywhere else (to disk, to reorder, etc.) does nothing — no accidental
// saves. On drop, the background fetches the post metadata and saves the dragged
// illustration itself (no screenshot) via the native host. Which post an image
// belongs to comes from media-identity.js, shared with overlay.js's hover save
// button so the two paths can never disagree about what a save records.
import { SAVE_WATCHDOG_MS } from './deadline.ts';
import { buildChoiceRow, checkDuplicate } from './duplicate-guard.ts';
import { collectImageUrls, getMediaIdentitySite } from './extractor/index.ts';
import { ICONS, makeIcon, makeSpinner } from './icons.ts';
import { ensureTokens, motion, prefersReducedMotion, token } from './tokens.ts';
import { createI18n } from './i18n.ts';
import type { ImageDraggedMessage, SaveResponse } from './messages.ts';

export async function startDrag(): Promise<void> {
  type PendingDrag = ImageDraggedMessage;

  const siteConfig = getMediaIdentitySite();
  if (!siteConfig) return;

  interface DropZone {
    el: HTMLDivElement;
    ring: HTMLDivElement;
    badge: HTMLDivElement;
    label: HTMLDivElement;
  }
  type ZoneState = 'idle' | 'over' | 'busy' | 'ok' | 'partial' | 'fail' | 'ask';

  let pending: PendingDrag | null = null;
  let zone: DropZone | null = null;
  // The duplicate warning's three answers (#34) while the question is up.
  let choices: HTMLElement | null = null;
  let hideAnim: Animation | null = null; // in-flight exit fade, cancelled if the zone re-shows
  let savingViaDrop = false; // true between a drop-in-zone and its result, so dragend doesn't hide early

  const { getMessage: t, partialSaveText, saveFailureText } = await createI18n();

  // Visual language is shared with the other content-script entrypoints: a
  // themed surface generated from the app's design tokens, following the
  // browser's light/dark setting (#270 — see tokens.ts). The zone element
  // persists across saves; setState re-applies the surface properties before
  // each show so a state-tinted border/shadow from the previous save is never
  // baked in.
  ensureTokens();

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
      `font:600 14px/1.5 ${token.fontSans}`,
      'text-align:center',
      'pointer-events:auto',
      `transition:transform ${token.durationBase} ${token.easeOut}, border-color ${token.durationBase}, box-shadow ${token.durationBase}`,
    ].join(';');

    // Dashed inset ring = the "drop target" affordance; hidden on result states.
    // Children are pointer-events:none so dragenter/dragleave never flicker.
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;inset:7px;border-radius:14px;border:1.5px dashed transparent;pointer-events:none;transition:border-color ${token.durationBase},opacity ${token.durationBase};`;
    el.appendChild(ring);

    const badge = document.createElement('div');
    badge.style.cssText = `width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${token.accentSoft};color:${token.accent};pointer-events:none;transition:background ${token.durationBase},color ${token.durationBase};`;
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
    z.el.style.background = token.surface;
    z.el.style.color = token.ink;
    z.el.style.borderColor = token.overlayBorder;
    z.el.style.boxShadow = token.overlayShadow;
    z.ring.style.opacity = state === 'idle' || state === 'over' ? '1' : '0';
    z.ring.style.borderColor = token.ring;
    // The choices belong to the question only — every other state drops them.
    choices?.remove();
    choices = null;
    switch (state) {
      case 'idle':
        z.badge.style.background = token.accentSoft;
        z.badge.style.color = token.accent;
        z.badge.appendChild(makeIcon(ICONS.drop));
        break;
      case 'over':
        // Drag-over is an ACTIVE state, the other half of what ADR 0013 scopes
        // the product accent to — so the whole zone takes the accent at once
        // (badge fill, outline, glow, ring) rather than tinting one part of it.
        z.badge.style.background = token.accent;
        z.badge.style.color = token.onAccent;
        z.badge.appendChild(makeIcon(ICONS.drop));
        z.el.style.transform = 'scale(1.04) translateY(-2px)';
        z.el.style.borderColor = token.accent;
        z.el.style.boxShadow = `${token.overlayShadow}, 0 0 0 4px ${token.accentSoft}`;
        z.ring.style.borderColor = token.accent;
        break;
      case 'busy':
        z.badge.style.background = token.badgeNeutral;
        z.badge.style.color = token.accent;
        z.badge.appendChild(makeSpinner());
        break;
      case 'ok':
        z.badge.style.background = token.success;
        z.badge.style.color = token.onSuccess;
        z.badge.appendChild(makeIcon(ICONS.check));
        z.el.style.borderColor = token.success;
        break;
      case 'partial':
        z.badge.style.background = token.warning;
        z.badge.style.color = token.onWarning;
        z.badge.appendChild(makeIcon(ICONS.warn));
        z.el.style.borderColor = token.warning;
        break;
      case 'fail':
        z.badge.style.background = token.danger;
        z.badge.style.color = token.onDanger;
        z.badge.appendChild(makeIcon(ICONS.cross));
        z.el.style.borderColor = token.danger;
        break;
      case 'ask':
        z.badge.style.background = token.warning;
        z.badge.style.color = token.onWarning;
        z.badge.appendChild(makeIcon(ICONS.warn));
        z.el.style.borderColor = token.warning;
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
    if (wasHidden && !prefersReducedMotion()) {
      // App toast entrance: rise + slight scale settle at the pop tier.
      z.el.animate(
        [
          { opacity: 0, transform: 'translateY(14px) scale(0.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: motion.durationBase, easing: motion.easeOut },
      );
    }
  }
  function hideOverlay(fade = false) {
    const z = zone;
    if (!z || z.el.style.display === 'none') return;
    if (!fade || prefersReducedMotion()) {
      z.el.style.display = 'none';
      return;
    }
    // Exit = the entrance played back (app toast hides through the same
    // rise/settle transition), on the shared pop tier.
    const anim = z.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(14px) scale(0.96)' }], { duration: motion.durationFast, easing: motion.easeIn });
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
    // #34: the picture the pointer carried is the whole of what this path
    // saves, so its own URLs are the picture set to compare — which is what
    // keeps a manga's next page (same post, a picture the library does not
    // have) from being called a duplicate.
    checkDuplicate(p.platform, p.postUrl, p.imageUrls)
      .catch(() => null)
      .then((hit) => {
        if (!hit) {
          send(z, p, null);
          return;
        }
        setState(z, 'ask', t('dupTitle'));
        choices = buildChoiceRow(t, (choice) => {
          if (choice === 'skip') {
            setState(z, 'ok', t('dupSkipped'));
            setTimeout(() => {
              hideOverlay(true);
              savingViaDrop = false;
            }, 1400);
            return;
          }
          setState(z, 'busy', t('bannerSaving'));
          send(z, p, choice === 'replace' ? hit.captureId : null);
        });
        z.el.appendChild(choices);
      });
  }

  function send(z: DropZone, p: PendingDrag, replaces: string | null) {
    // The drop zone shows a spinner until this answers, so it needs an end the
    // same way the capture banner does (#507). Longer than everything the
    // background is itself allowed to spend, so only a background that has gone
    // quiet reaches it — a slow save still gets to finish and say so.
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      done(z, undefined, replaces, true);
    }, SAVE_WATCHDOG_MS);
    chrome.runtime.sendMessage({ ...p, replaces } satisfies ImageDraggedMessage, (res?: SaveResponse) => {
      if (settled) return; // a late answer to a drop already given up on
      settled = true;
      clearTimeout(watchdog);
      done(z, res, replaces, false);
    });
  }

  // The one place a drop's outcome is put on screen, whether it came back from
  // the background or ran out of time.
  function done(z: DropZone, res: SaveResponse | undefined, replaces: string | null, timedOut: boolean) {
    const ok = res?.ok === true;
    let partial = false;
    let grouped = false;
    // The old capture is on its way to the trash, so this is not a merge —
    // say so INSTEAD of "grouped" (#34).
    const replaced = ok && !!replaces;
    let text: string;
    if (res?.ok) {
      partial = res.metaOk === false; // saved, but no post metadata
      grouped = !partial && !replaced && res.grouped > 0; // same post saved earlier → merges into one card in the app
      text = partial ? partialSaveText(res.metaReason) : replaced ? t('dupReplaced') : grouped ? t('bannerSavedGrouped', [res.grouped + 1]) : t('bannerSaved');
    } else {
      text = saveFailureText(timedOut ? 'timeout' : res?.errorKind);
    }
    setState(z, partial ? 'partial' : ok ? 'ok' : 'fail', text);
    if (ok && !prefersReducedMotion()) {
      // Small badge pop so the state flip reads even in peripheral vision
      // (app hologramBadgePop: .3s on the shared ease-out curve).
      z.badge.animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1.12)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 300, easing: motion.easeOut });
    }
    setTimeout(
      () => {
        hideOverlay(true);
        savingViaDrop = false;
      },
      // grouped/replaced: hold a beat longer — both explain where the image "went"
      partial ? 2600 : grouped || replaced ? 2200 : 1400,
    );
  }
}
