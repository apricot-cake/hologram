import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';

// Empty-state placeholder (#emptyState): the "no posts yet" first-run message, the "no
// results" filtered-empty message, or the poster first-run message. Pure presentation —
// viewer keeps the container's show/hide + the delegated CTA click handler. Labels come
// from i18n keys here (the island owns them), so no static text set-up in viewer races
// us on a language reload.
//
// P4-B slice⑩ folded the POST variant into a self-derived selector (corpusStore's
// 'postGroups'/'allPostsCount'/'searchQuery' are all already reactive) instead of a
// viewer push — one less `.render(` call. The POSTER variant still arrives via
// window.corpusEmpty (viewer pushes it from renderPosters); that fold-in is slice⑫'s
// job (needs posterGroups + buildUsers() in the store first, same prerequisite shape).
const subPostGroups = (cb: () => void) => window.corpusStore.subscribe('postGroups', cb);
const getPostGroups = () => window.corpusStore.get('postGroups') as any[] | null | undefined;
const subAllPostsCount = (cb: () => void) => window.corpusStore.subscribe('allPostsCount', cb);
const getAllPostsCount = () => (window.corpusStore.get('allPostsCount') as number | undefined) ?? 0;
const subSearchQuery = (cb: () => void) => window.corpusStore.subscribe('searchQuery', cb);
const getSearchQuery = () => (window.corpusStore.get('searchQuery') as string | undefined) ?? '';
const subMode = (cb: () => void) => window.corpusStore.subscribe('browseMode', cb);
const getMode = () => (window.corpusStore.get('browseMode') as string | undefined) ?? 'posts';

export function EmptyState() {
  const mode = useSyncExternalStore(subMode, getMode);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const allPostsCount = useSyncExternalStore(subAllPostsCount, getAllPostsCount);
  const query = useSyncExternalStore(subSearchQuery, getSearchQuery);
  const posterVariant = useSyncExternalStore(window.corpusEmpty.subscribe, window.corpusEmpty.get);
  // postGroups is undefined before the first renderPosts() ever ran (nothing to show
  // yet — mirrors the old bridge's initial `current = null`), an array while the grid
  // has content (nothing to show), or explicitly null when renderPosts() found the
  // filtered/grouped set empty (viewer distinguishes these on purpose — see
  // renderer/viewer.ts's renderPosts and renderer/grid.ts's computeModel).
  const variant: CorpusEmptyVariant | null = mode === 'posts' ? (postGroups === null ? (allPostsCount === 0 && !query.trim() ? 'firstRun' : 'filtered') : null) : posterVariant;
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
