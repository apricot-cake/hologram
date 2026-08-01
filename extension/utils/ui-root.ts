// The one ShadowRoot every page-level piece of Hologram UI is drawn inside
// (#44, carrying out the boundary #154 set and #270 deferred).
//
// WHY A SHADOW ROOT. Everything the extension draws sits on someone else's
// page. Without a root, host CSS reaches our elements (a `div { all: unset }`
// or a `*` rule is enough) and our CSS would reach theirs. #270 held the line
// by writing every declaration as an inline style, which wins against a host's
// non-!important rules — but it also meant the look could never be expressed as
// CSS classes, so "banner" and "drop zone" were two hand-kept copies of the same
// state→colour→icon table. The root is what makes one stylesheet possible.
//
// WHAT IS *NOT* IN HERE. The saved mark and the hover save button stay children
// of the picture they annotate. They are not on this layer and this module does
// not want them: a fixed layer has to copy viewport coordinates on every scroll
// frame, which visibly trails smooth scrolling, and it draws over the host's own
// sticky header. Both were measured on the previous implementation (#270's
// design review, 2026-07-29). They are isolated all the same: #310 gave each of
// those controls its OWN small shadow root, in place in the subtree, so the
// boundary is there without the move (overlay.ts's CONTROL_TAG).
//
// HOW THE CSS GETS IN. Constructed stylesheets, never an injected <style>: a
// host serving `style-src 'none'` kills a <style> even inside a shadow root,
// while `adoptedStyleSheets` is not a CSP-guarded sink at all (measured, #270 —
// see tokens.ts for the full table). x.com ships exactly that policy.
import { ensureTokens, withCurrentTokenSheet } from './tokens.ts';
import componentsCss from './components.css?inline';

const HOST_TAG = 'hologram-extension-ui';

// The host element's own box. Written as inline !important because this is the
// ONE element a host page can still see and target — everything else is behind
// the shadow boundary. Inline !important is the top of the cascade, so even a
// hostile `hologram-extension-ui { display: none !important }` loses.
const HOST_STYLE: Record<string, string> = {
  position: 'fixed',
  inset: '0',
  // The layer must not eat the page's clicks; each interactive part turns
  // pointer events back on for itself (see components.css).
  'pointer-events': 'none',
  'z-index': '2147483647',
  margin: '0',
  padding: '0',
  border: '0',
  // A transform/filter/perspective anywhere on this element would make it the
  // containing block for `position: fixed` descendants, which is exactly what
  // the surfaces inside rely on NOT happening.
  transform: 'none',
  filter: 'none',
  contain: 'none',
  display: 'block',
  visibility: 'visible',
  opacity: '1',
};

const COMPONENTS_STATE = Symbol.for('hologram.components-stylesheet');
interface ComponentsState {
  css: string;
  sheet: CSSStyleSheet | null;
  previous: Set<CSSStyleSheet>;
}

const componentScope = globalThis as typeof globalThis & { [COMPONENTS_STATE]?: ComponentsState };

function componentsSheet(): CSSStyleSheet | null {
  const current = componentScope[COMPONENTS_STATE];
  if (current?.css === componentsCss) return current.sheet;
  let sheet: CSSStyleSheet | null = null;
  try {
    const created = new CSSStyleSheet();
    created.replaceSync(componentsCss);
    sheet = created;
  } catch {
    // jsdom and any engine without constructed sheets: see below
  }
  const next: ComponentsState = {
    css: componentsCss,
    sheet,
    previous: new Set(current?.previous ?? []),
  };
  if (current?.sheet) next.previous.add(current.sheet);
  componentScope[COMPONENTS_STATE] = next;
  return sheet;
}

function adoptCurrentStyles(root: ShadowRoot): void {
  try {
    const components = componentsSheet();
    const componentState = componentScope[COMPONENTS_STATE];
    const obsolete = componentState?.previous ?? new Set<CSSStyleSheet>();
    const kept = root.adoptedStyleSheets.filter((candidate) => candidate !== components && !obsolete.has(candidate));
    root.adoptedStyleSheets = [...withCurrentTokenSheet(kept), ...(components ? [components] : [])];
  } catch {
    /* constructed stylesheets are an enhancement; saving remains available */
  }
}

// The root for THIS document, creating it on first use.
//
// Idempotent across script instances, not just across calls: the resident
// content script and the on-demand Alt+S script run in the same isolated world
// but are separate bundles with separate module scopes, so a module-level cache
// would not be shared between them. The DOM is what they share, so the DOM is
// what gets asked — `mode: 'open'` is what makes that possible, and closed
// would buy nothing (it is not a security boundary against the page, which can
// see the host element either way).
//
// Returns null only if the document cannot host it at all; callers fall back to
// their own element so a styling failure never takes the save path down.
export function ensureUiRoot(): ShadowRoot | null {
  const parent = document.body || document.documentElement;
  if (!parent) return null;

  // Typed as HTMLElement rather than Element: the tag is unknown to the HTML
  // parser but still an HTMLUnknownElement, so it has a style attribute — and
  // an element by this name that somehow is not one would fail the attachShadow
  // below anyway, which the try/catch already turns into "no root".
  const existing = document.querySelector<HTMLElement>(HOST_TAG);
  if (existing?.shadowRoot) {
    // A single-page app can move or drop nodes wholesale; re-attach rather than
    // hand back a root that is no longer in the document.
    if (!existing.isConnected) parent.appendChild(existing);
    ensureTokens();
    adoptCurrentStyles(existing.shadowRoot);
    return existing.shadowRoot;
  }

  try {
    const host = existing || document.createElement(HOST_TAG);
    for (const [property, value] of Object.entries(HOST_STYLE)) host.style.setProperty(property, value, 'important');
    const root = host.attachShadow({ mode: 'open' });
    adoptCurrentStyles(root);
    if (!host.isConnected) parent.appendChild(host);
    // The pages' own UI also wants the tokens on the document (the compact
    // controls in the subtree read them), and that call is idempotent.
    ensureTokens();
    return root;
  } catch {
    return null;
  }
}

// HMR may change CSS while the shared root is idle. Refresh it without creating
// a page-level host that the user has never opened.
export function refreshUiRootStyles(): void {
  ensureTokens();
  const root = document.querySelector(HOST_TAG)?.shadowRoot;
  if (root) adoptCurrentStyles(root);
}

// Everything this root holds, removed. The host element itself is left in place:
// a second Alt+S in the same tab re-uses it, and an empty inert layer costs
// nothing.
export function clearUiRoot(): void {
  const root = document.querySelector(HOST_TAG)?.shadowRoot;
  root?.replaceChildren();
}
