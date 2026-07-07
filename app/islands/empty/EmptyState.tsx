import { useSyncExternalStore } from 'react';
import { t } from '../_shared/i18n.ts';

// Empty-state placeholder (#emptyState): the "no posts yet" first-run message, the "no
// results" filtered-empty message, or the poster first-run message. Pure presentation —
// the variant arrives from viewer via window.corpusEmpty (viewer keeps the container's
// show/hide + the delegated CTA click handler). The button IDs (emptyImportBtn /
// emptyResetBtn) match the old innerHTML so viewer's #emptyState delegation fires
// unchanged. Labels come from i18n keys here (the island owns them), so no static text
// set-up in viewer races us on a language reload.
export function EmptyState() {
  const variant = useSyncExternalStore(window.corpusEmpty.subscribe, window.corpusEmpty.get);
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
