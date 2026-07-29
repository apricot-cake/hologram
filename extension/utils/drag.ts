// Persistent content script (manifest content_scripts for x / bsky / pixiv).
// Drag-to-save: when the user starts dragging an image, a drop zone
// appears; the image is saved to Hologram ONLY if dropped into that zone. Dragging
// an image anywhere else (to disk, to reorder, etc.) does nothing — no accidental
// saves. On drop, the background fetches the post metadata and saves the dragged
// illustration itself (no screenshot) via the native host. Which post an image
// belongs to comes from media-identity.js, shared with overlay.js's hover save
// button so the two paths can never disagree about what a save records.
import { buildChoiceRow, checkDuplicate } from './duplicate-guard.ts';
import { collectImageUrls, getMediaIdentitySite } from './extractor/index.ts';
import { ICONS } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { createI18n } from './i18n.ts';
import type { ImageDraggedMessage, SaveResponse } from './messages.ts';

export async function startDrag(): Promise<void> {
  type PendingDrag = ImageDraggedMessage;

  const siteConfig = getMediaIdentitySite();
  if (!siteConfig) return;

  let pending: PendingDrag | null = null;
  let zone: StatusSurface | null = null;
  let savingViaDrop = false; // true between a drop-in-zone and its result, so dragend doesn't hide early

  const { getMessage: t, partialSaveText, saveFailureText } = await createI18n();

  // The drop zone is the `zone` face of the surface every on-page save path
  // draws with (#44 — status-surface.ts). What used to live here was a private
  // copy of the state→colour→glyph table; now this file decides only WHICH
  // state it is in, and the shared component and its stylesheet decide what
  // that looks like.
  function ensureOverlay(): StatusSurface {
    if (zone) return zone;
    const z = new StatusSurface({ variant: 'zone', resting: ICONS.drop });
    zone = z;
    z.el.id = '__hologramDropZone';
    z.el.addEventListener('dragenter', (e) => {
      e.preventDefault();
      z.setState('active');
    });
    z.el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    z.el.addEventListener('dragleave', () => {
      z.setState('idle');
    });
    z.el.addEventListener('drop', onDrop, true);
    return z;
  }

  function showOverlay() {
    const z = ensureOverlay();
    const wasHidden = !z.el.isConnected;
    z.setState('idle', t('dragDropHint'));
    z.mount();
    // The element's presence IS the open state, so a re-show after an exit that
    // already finished has to replay the entrance; one that is still fading is
    // caught mid-flight by enter() cancelling it.
    if (wasHidden) z.enter();
  }

  function hideOverlay(fade = false) {
    const z = zone;
    if (!z || !z.el.isConnected) return;
    if (!fade) {
      z.remove();
      return;
    }
    z.exit();
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
    z.setState('busy', t('bannerSaving'));
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
        z.setState('ask', t('dupTitle'));
        z.slot(
          buildChoiceRow(t, (choice) => {
            if (choice === 'skip') {
              z.setState('success', t('dupSkipped'));
              setTimeout(() => {
                hideOverlay(true);
                savingViaDrop = false;
              }, 1400);
              return;
            }
            z.setState('busy', t('bannerSaving'));
            send(z, p, choice === 'replace' ? hit.captureId : null);
          }),
        );
      });
  }

  function send(z: StatusSurface, p: PendingDrag, replaces: string | null) {
    chrome.runtime.sendMessage({ ...p, replaces } satisfies ImageDraggedMessage, (res?: SaveResponse) => {
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
        text = saveFailureText(res?.errorKind);
      }
      z.setState(partial ? 'partial' : ok ? 'success' : 'error', text);
      // Small badge pop so the state flip reads even in peripheral vision
      // (app hologramBadgePop: .3s on the shared ease-out curve).
      if (ok) z.pop();
      setTimeout(
        () => {
          hideOverlay(true);
          savingViaDrop = false;
        },
        // grouped/replaced: hold a beat longer — both explain where the image "went"
        partial ? 2600 : grouped || replaced ? 2200 : 1400,
      );
    });
  }
}
