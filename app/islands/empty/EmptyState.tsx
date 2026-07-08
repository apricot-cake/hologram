import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';

// Empty-state placeholder (#emptyState): the "no posts yet" first-run message, the "no
// results" filtered-empty message, or the poster first-run message. Pure presentation —
// viewer keeps the container's show/hide + the delegated CTA click handler. Labels come
// from i18n keys here (the island owns them), so no static text set-up in viewer races
// us on a language reload.
//
// P4-B slice⑩ (post) and slice⑫ (poster) folded BOTH variants into self-derived
// selectors — corpusStore already carries everything needed reactively — instead
// of a viewer push. window.corpusEmpty (the old shared bridge) has no callers left
// anywhere and was deleted.
const subPostGroups = (cb: () => void) => window.corpusStore.subscribe('postGroups', cb);
const getPostGroups = () => window.corpusStore.get('postGroups') as any[] | null | undefined;
const subAllPostsCount = (cb: () => void) => window.corpusStore.subscribe('allPostsCount', cb);
const getAllPostsCount = () => (window.corpusStore.get('allPostsCount') as number | undefined) ?? 0;
const subPosterGroups = (cb: () => void) => window.corpusStore.subscribe('posterGroups', cb);
const getPosterGroups = () => window.corpusStore.get('posterGroups') as any[] | undefined; // never explicitly null — see the comment below
const subAllUsersCount = (cb: () => void) => window.corpusStore.subscribe('allUsersCount', cb);
const getAllUsersCount = () => (window.corpusStore.get('allUsersCount') as number | undefined) ?? 0;
const subSearchQuery = (cb: () => void) => window.corpusStore.subscribe('searchQuery', cb);
const getSearchQuery = () => (window.corpusStore.get('searchQuery') as string | undefined) ?? '';
const subMode = (cb: () => void) => window.corpusStore.subscribe('browseMode', cb);
const getMode = () => (window.corpusStore.get('browseMode') as string | undefined) ?? 'posts';

export function EmptyState() {
  const mode = useSyncExternalStore(subMode, getMode);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const allPostsCount = useSyncExternalStore(subAllPostsCount, getAllPostsCount);
  const posterGroups = useSyncExternalStore(subPosterGroups, getPosterGroups);
  const allUsersCount = useSyncExternalStore(subAllUsersCount, getAllUsersCount);
  const query = useSyncExternalStore(subSearchQuery, getSearchQuery);
  let variant: CorpusEmptyVariant | null = null;
  if (mode === 'posts') {
    // postGroups is undefined before the first renderPosts() ever ran (nothing to
    // show yet), an array while the grid has content (nothing to show), or
    // explicitly null when renderPosts() found the filtered/grouped set empty
    // (viewer distinguishes these on purpose — see renderer/viewer.ts's
    // renderPosts and renderer/grid.ts's computeModel).
    if (postGroups === null) variant = allPostsCount === 0 && !query.trim() ? 'firstRun' : 'filtered';
  } else {
    // posterGroups has no such null sentinel — viewer always pushes an array
    // (possibly empty) once renderPosters() has run at all, undefined before that
    // (the poster grid never needed the post grid's unmount-before-innerHTML-clear
    // ordering, so there was nothing forcing a null push — see renderer/grid.ts's
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
