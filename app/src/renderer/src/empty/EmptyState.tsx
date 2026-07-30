import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// Empty-state placeholder (#emptyState): the "no posts yet" first-run message, the "no
// results" filtered-empty message, or the poster first-run message. Pure presentation —
// viewer keeps the container's show/hide + the delegated CTA click handler. Labels come
// from i18n keys here (the component owns them), so no static text set-up in viewer races
// us on a language reload.
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
      <>
        <p>
          <strong>{t('posterEmptyTitle')}</strong>
        </p>
        <p>{t('posterEmptyDesc')}</p>
      </>
    );
  }
  if (variant === 'firstRun') {
    return (
      <>
        <p>
          <strong>{t('emptyTitle')}</strong>
        </p>
        <p>{t('emptyDesc')}</p>
        {/* emptyCaptureHint carries <kbd> markup, so it's set as HTML (matches the old innerHTML). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: i18n string with intentional <kbd> markup */}
        <p dangerouslySetInnerHTML={{ __html: t('emptyCaptureHint') }} />
        <button type="button" className="empty-cta" id="emptyImportBtn">
          {t('importZip')}
        </button>
      </>
    );
  }
  // 'filtered' (post or poster): a search / filter ate everything → one-click reset.
  return (
    <>
      <p>
        <strong>{t('emptySearchTitle')}</strong>
      </p>
      <p>{t('emptySearchDesc')}</p>
      <button type="button" className="empty-cta" id="emptyResetBtn">
        {t('emptyResetBtn')}
      </button>
    </>
  );
}
