import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';
import { resetAllFilters, resetPosterFilters, runZipImport } from '../services/orchestrator.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// Empty-state placeholder: the "no posts yet" first-run message, the "no results"
// filtered-empty message, or the poster first-run message. It owns its own container and
// its own visibility — the shell used to mount it inside a static `#emptyState` div whose
// `hidden` two render pipelines wrote by hand, while this component already knew from the
// store whether it had anything to say. Its buttons call the orchestrator directly, in
// place of the delegated click listener that matched them by element id (#153).
//
// BOTH variants (post and poster) are folded into self-derived selectors —
// hologramStore already carries everything needed reactively — instead of a viewer
// push. The old shared push bridge has no callers left anywhere and was deleted.
const subPostGroups = (cb: () => void) => storeSubscribe('postGroups', cb);
const getPostGroups = () => storeGet('postGroups') as any[] | null | undefined;
const subAllPostsCount = (cb: () => void) => storeSubscribe('allPostsCount', cb);
const getAllPostsCount = () => (storeGet('allPostsCount') as number | undefined) ?? 0;
const subPosterGroups = (cb: () => void) => storeSubscribe('posterGroups', cb);
const getPosterGroups = () => storeGet('posterGroups') as any[] | undefined; // never explicitly null — see the comment below
const subAllUsersCount = (cb: () => void) => storeSubscribe('allUsersCount', cb);
const getAllUsersCount = () => (storeGet('allUsersCount') as number | undefined) ?? 0;
const subSearchQuery = (cb: () => void) => storeSubscribe('searchQuery', cb);
const getSearchQuery = () => (storeGet('searchQuery') as string | undefined) ?? '';
const subMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getMode = () => (storeGet('browseMode') as string | undefined) ?? 'posts';

export function EmptyState() {
  const mode = useSyncExternalStore(subMode, getMode);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const allPostsCount = useSyncExternalStore(subAllPostsCount, getAllPostsCount);
  const posterGroups = useSyncExternalStore(subPosterGroups, getPosterGroups);
  const allUsersCount = useSyncExternalStore(subAllUsersCount, getAllUsersCount);
  const query = useSyncExternalStore(subSearchQuery, getSearchQuery);
  let variant: HologramEmptyVariant | null = null;
  // The trash has its own empty state, inside its own view (#268) — this
  // placeholder belongs to the two library grids and would otherwise answer for a
  // destination it knows nothing about.
  if (mode === 'trash') return null;
  if (mode === 'posts') {
    // postGroups is undefined before the first renderPosts() ever ran (nothing to
    // show yet), an array while the grid has content (nothing to show), or
    // explicitly null when renderPosts() found the filtered/grouped set empty
    // (orchestrator distinguishes these on purpose — see services/orchestrator.ts's
    // renderPosts and services/grid.ts's computeModel).
    if (postGroups === null) variant = allPostsCount === 0 && !query.trim() ? 'firstRun' : 'filtered';
  } else {
    // posterGroups has no such null sentinel — viewer always pushes an array
    // (possibly empty) once renderPosters() has run at all, undefined before that
    // (the poster grid never needed the post grid's unmount-before-innerHTML-clear
    // ordering, so there was nothing forcing a null push — see services/grid.ts's
    // makePosterGridSource doc comment).
    if (posterGroups !== undefined && posterGroups.length === 0) variant = allUsersCount === 0 && !query.trim() ? 'posterFirstRun' : 'filtered';
  }
  if (!variant) return null;
  if (variant === 'posterFirstRun') {
    return (
      <Frame>
        <p className="mb-2">
          <strong>{t('posterEmptyTitle')}</strong>
        </p>
        <p>{t('posterEmptyDesc')}</p>
      </Frame>
    );
  }
  if (variant === 'firstRun') {
    return (
      <Frame>
        <p className="mb-2">
          <strong>{t('emptyTitle')}</strong>
        </p>
        <p className="mb-2">{t('emptyDesc')}</p>
        {/* emptyCaptureHint carries <kbd> markup, so it's set as HTML (matches the old innerHTML). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string with intentional <kbd> markup */}
        <p className="mb-2" dangerouslySetInnerHTML={{ __html: t('emptyCaptureHint') }} />
        <Cta onClick={() => runZipImport?.()}>{t('importZip')}</Cta>
      </Frame>
    );
  }
  // 'filtered' (post or poster): a search / filter ate everything → one-click reset.
  return (
    <Frame>
      <p className="mb-2">
        <strong>{t('emptySearchTitle')}</strong>
      </p>
      <p>{t('emptySearchDesc')}</p>
      <Cta onClick={() => (mode === 'posters' ? resetPosterFilters?.() : resetAllFilters?.())}>{t('emptyResetBtn')}</Cta>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-slot="empty-state" className="px-5 py-15 text-center text-[var(--text-subtle)]">
      {children}
    </div>
  );
}

/** "What to do next" affordance — rounded square = action, per DESIGN.md. */
function Cta({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mt-3 cursor-pointer rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-4.5 py-[7px] text-[13px] text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:bg-[var(--hover)] hover:text-[var(--accent-text)]">
      {children}
    </button>
  );
}
