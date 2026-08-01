import { useState, useSyncExternalStore } from 'react';
import { FolderSymlink, FolderX, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import { open as confirmOpen } from '../services/confirm.ts';
import { getLibraryStatus, pickRepointFolder, applyRepoint } from '../services/library-path.ts';
import { notify } from '../services/ui.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../services/store.ts';

// #37: replaces the whole content column (AppShell) when the CURRENT save folder is
// missing on disk — moved, renamed, or the drive that held it is unmounted, from
// OUTSIDE the app. Deliberately NOT the ordinary empty/EmptyState.tsx 'firstRun'
// variant: since #302 the posts table lives in the DB, independent of the save
// folder, so a missing folder does not make postGroups empty — the grid would
// otherwise render every card with a broken thumbnail instead of explaining what
// happened. hologramStore's 'libraryMissing'/'libraryMissingPath' are seeded by
// App.tsx's LibraryStatusGate on boot (services/library-path.ts's getLibraryStatus,
// a fresh statSync every call — there is no push channel, see index.ts's
// refreshLibraryStatus comment) and refreshed here after Retry/repoint.
const subMissing = (cb: () => void) => storeSubscribe('libraryMissing', cb);
const getMissing = () => !!storeGet('libraryMissing');
const subPath = (cb: () => void) => storeSubscribe('libraryMissingPath', cb);
const getPath = () => (storeGet('libraryMissingPath') as string | null | undefined) ?? null;

export function LibraryMissingState() {
  const missing = useSyncExternalStore(subMissing, getMissing);
  const path = useSyncExternalStore(subPath, getPath);
  const [busy, setBusy] = useState(false);
  if (!missing) return null;

  const refresh = async () => {
    try {
      const status = await getLibraryStatus();
      storeSet('libraryMissing', !!(status && status.missing));
      storeSet('libraryMissingPath', (status && status.path) || null);
      if (!status || !status.missing) notify(t('libraryMissingResolved'));
    } catch {
      /* leave the screen up — the user can retry again */
    }
  };

  const retry = async () => {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const doRepoint = async (dest: string) => {
    setBusy(true);
    try {
      const res = await applyRepoint(dest);
      if (res && res.ok) {
        storeSet('libraryMissing', false);
        storeSet('libraryMissingPath', null);
        notify(t('libraryMissingRepointDone'));
      } else {
        notify(t('saveFolderErrGeneric'));
      }
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const repoint = async () => {
    setBusy(true);
    try {
      const res = await pickRepointFolder();
      if (!res || res.canceled) return;
      if (!res.ok || !res.dest) {
        notify(t('saveFolderErrGeneric'));
        return;
      }
      if (res.hasEvidence) {
        await doRepoint(res.dest);
        return;
      }
      // No sign of an existing library at the chosen folder (#37) — surfaced as a
      // confirm rather than a silent repoint, since existing posts' images would
      // not resolve there unless this really is where the library was moved to.
      const dest = res.dest;
      confirmOpen({
        message: t('libraryMissingRepointConfirm'),
        description: t('libraryMissingRepointConfirmDesc'),
        okLabel: t('libraryMissingRepointConfirmOk'),
        cancelLabel: t('confirmCancel'),
        onOk: () => void doRepoint(dest),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Empty data-slot="library-missing" className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderX />
        </EmptyMedia>
        <EmptyTitle>{t('libraryMissingTitle')}</EmptyTitle>
        <EmptyDescription>
          {t('libraryMissingDesc')}
          <br />
          <code className="bg-muted mt-2 inline-block max-w-full rounded-md px-2.5 py-1.5 font-mono text-xs break-all">{path}</code>
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={() => void retry()} disabled={busy}>
            <RotateCw />
            {t('libraryMissingRetry')}
          </Button>
          <Button variant="outline" onClick={() => void repoint()} disabled={busy}>
            <FolderSymlink />
            {t('libraryMissingRepoint')}
          </Button>
        </div>
      </EmptyContent>
    </Empty>
  );
}
