import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { toast } from 'sonner';
import { t } from '../../_shared/i18n.ts';
import { notify } from '../../services/ui.ts';
import { getBackup, setBackup as setBackupConfig, pickBackupDir, onBackupDone, getIntegrityStatus, runOrphanRecovery, onIntegrityCheckDone, listDbGenerations, rollbackDbGeneration } from '../../services/backup.ts';
import { onExportProgress, onSaveFolderProgress, pickSaveFolder, moveSaveFolder, exportComplete, importComplete, importLegacyZip, importImages, getWatchImport, pickWatchImportFolder, setWatchImport } from '../../services/posts.ts';
import { pickLibraryFolder, switchLibrary as switchLibraryIpc, getRecentLibraries, removeRecentLibrary as removeRecentLibraryIpc } from '../../services/library-path.ts';
import { open as confirmOpen } from '../../services/confirm.ts';
import { loadPosts } from '../../services/post-grid-builder.ts';
import type { BackupConfig, BackupRunResult, DbGeneration, IntegrityStatus, RecentLibraryEntry, SaveFolderProgress, WatchImportFolder } from '../../../../main/ipc-payloads.ts';

// Missing-bridge calls throw and land in the callers' try/catch, same as the
// untyped original — the {} fallback only exists for the bare dev server.
const hologram = (): HologramPreload => window.hologram || ({} as HologramPreload);
const reloadPosts = () => {
  if (loadPosts) loadPosts();
};

// The save-folder-progress / get-backup / backup-done / get-integrity-status
// payloads are the shared IPC contract (#228) — this component used to keep its
// own hand-written copies of all four, which is exactly the drift that contract
// exists to stop.

// The preload's on* bridges attach a new ipcRenderer listener on every call with
// no remover, and this component remounts on each modal open. So register the
// underlying IPC listeners exactly ONCE and fan out to the live React subscriber
// set — effects only add/remove themselves, never re-subscribe to IPC.
const progressSubs = new Set<(p: SaveFolderProgress) => void>();
const backupSubs = new Set<(r: BackupRunResult) => void>();
const integritySubs = new Set<(s: IntegrityStatus) => void>();
let ipcWired = false;
function wireIpcOnce() {
  if (ipcWired) return;
  ipcWired = true;
  try {
    onSaveFolderProgress((p) => progressSubs.forEach((cb) => cb(p)));
  } catch {
    /* bare dev server: no preload bridge behind hologramPosts */
  }
  try {
    onBackupDone((r: BackupRunResult) => backupSubs.forEach((cb) => cb(r)));
  } catch {
    /* bare dev server: no preload bridge behind hologramBackup */
  }
  try {
    onIntegrityCheckDone((s: IntegrityStatus) => integritySubs.forEach((cb) => cb(s)));
  } catch {
    /* bare dev server: no preload bridge behind hologramBackup */
  }
}

// Migration error code → message key, faithful to viewer.js setupSaveFolder.errMsg.
const saveFolderErr = (code?: string) => {
  switch (code) {
    case 'same':
      return t('saveFolderErrSame');
    case 'nested':
      return t('saveFolderErrNested');
    case 'config-overlap':
    case 'backup-overlap':
      return t('saveFolderErrOverlap');
    case 'collision':
      return t('saveFolderErrCollision');
    case 'copy-failed':
      return t('saveFolderErrCopyFailed');
    case 'not-writable':
      return t('saveFolderErrNotWritable');
    // #37: the current save folder is missing on disk — relocation (which COPIES
    // from it) refuses outright; the content column's repoint button is
    // the way out, not this dialog's Change button.
    case 'library-missing':
      return t('saveFolderErrLibraryMissing');
    default:
      return t('saveFolderErrGeneric');
  }
};

// #176: pick-library-folder / switch-library error codes. 'not-a-library' is
// new (the four-way classification's 'reject' branch); everything else
// reuses validateSaveFolder's codes via saveFolderErr.
const libraryErr = (code?: string) => {
  switch (code) {
    case 'not-a-library':
      return t('libraryErrNotALibrary');
    case 'busy':
      return t('libraryErrBusy');
    case 'open-failed':
      return t('libraryErrOpenFailed');
    default:
      return saveFolderErr(code);
  }
};

// #37: backup run failures that are specific ERROR CODES (not an arbitrary
// exception .message, which falls through to the default and is shown as-is).
const backupErr = (code?: string | null) => {
  switch (code) {
    case 'dest-missing':
      return t('backupErrDestMissing');
    case 'src-missing':
      return t('backupErrSrcMissing');
    // #233/#176: the destination is claimed by another library, so the run was
    // refused before anything at the destination could be touched.
    case 'library-mismatch':
      return t('backupErrLibraryMismatch');
    default:
      return code || '';
  }
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const fmtTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// Filesystem path shown as an inline code chip.
function PathChip({ children }: { children?: string | null }) {
  return <code className="bg-muted min-w-0 flex-1 rounded-md px-2.5 py-1.5 font-mono text-xs break-all">{children}</code>;
}

// Data: save-folder (with live migration progress), export/import, auto backup.
// Port of viewer.js setupSaveFolder + the export/import handlers + setupBackup —
// only the modal-side UI. The always-visible rail is mirror/MirrorStatus.tsx.
export function Data() {
  // --- save folder ---
  const [saveFolder, setSaveFolder] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; log: string[] } | null>(null); // while/after a move

  // --- library switch (#176) ---
  const [switchingLib, setSwitchingLib] = useState(false);
  const [recentLibraries, setRecentLibraries] = useState<RecentLibraryEntry[]>([]);
  const refreshRecentLibraries = () => {
    Promise.resolve(getRecentLibraries())
      .then((list) => setRecentLibraries(list || []))
      .catch(() => {});
  };

  // --- backup ---
  const [backup, setBackup] = useState<BackupConfig | null>(null);
  // --- restore points (#233's DB generations) ---
  const [generations, setGenerations] = useState<DbGeneration[]>([]);
  const [rollingBack, setRollingBack] = useState(false);

  // --- integrity (#301) ---
  const [integrity, setIntegrity] = useState<IntegrityStatus | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [watchFolders, setWatchFolders] = useState<WatchImportFolder[]>([]);
  const [watchImported, setWatchImported] = useState(0);

  // Load both the config save folder and the backup config on mount (the modal
  // remounts each time it opens, so this matches the old "reload on open").
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshRecentLibraries is a fresh closure every render — this effect intentionally runs once, on mount only
  useEffect(() => {
    Promise.resolve(hologram().getConfig ? hologram().getConfig() : null)
      .then((cfg) => setSaveFolder((cfg && cfg.saveFolder) || ''))
      .catch(() => {});
    Promise.resolve(getBackup())
      .then((b) => setBackup(b || null))
      .catch(() => {});
    Promise.resolve(getIntegrityStatus())
      .then((s) => setIntegrity(s || null))
      .catch(() => {});
    Promise.resolve(getWatchImport())
      .then((v) => {
        setWatchFolders(v?.folders || []);
        setWatchImported(v?.status?.imported || 0);
      })
      .catch(() => {});
    Promise.resolve(listDbGenerations())
      .then((g) => setGenerations(g || []))
      .catch(() => {});
    refreshRecentLibraries();
  }, []);

  // Live migration progress events. The copy percent only drives the bar; log
  // lines are phase milestones (start / switch / cleanup / done) — no "…20%" spam.
  useEffect(() => {
    wireIpcOnce();
    const onProg = (p: SaveFolderProgress) => {
      if (!p) return;
      setProgress((prev) => {
        const log = prev ? prev.log.slice() : [];
        let pct = prev ? prev.pct : 0;
        if (p.phase === 'copy') {
          if (p.done === 0) log.push(t('logCopyStart', [p.total]));
          pct = p.percent as number; // always present in 'copy' events
        } else if (p.phase === 'switch') {
          pct = 100;
          log.push(t('logSwitch'));
        } else if (p.phase === 'cleanup') {
          log.push(t('logCleanup'));
        } else if (p.phase === 'done') {
          pct = 100;
          log.push(t('logMoveDone', [p.moved]));
          if ((p.leftover as number) > 0) log.push(t('logLeftover', [p.leftover]));
        } else if (p.phase === 'straggler') {
          log.push(t('logStraggler', [p.moved]));
        } else if (p.phase === 'error') {
          log.push(saveFolderErr(p.error));
        }
        return { pct, log };
      });
    };
    progressSubs.add(onProg);
    return () => {
      progressSubs.delete(onProg);
    };
  }, []);

  // Apply the outcome of a pick/move round-trip (both return the same shape).
  const applyMoveResult = (res: any) => {
    if (res && res.ok) {
      setSaveFolder(res.saveFolder);
      notify(t('saveFolderMoved', [res.moved]));
      reloadPosts();
    } else {
      notify(saveFolderErr(res && res.error));
    }
  };

  const chooseSaveFolder = async () => {
    setMigrating(true);
    setProgress(null); // box appears on the first progress event (after a folder is picked)
    try {
      const res = await pickSaveFolder();
      if (!res || res.canceled) {
        setProgress(null);
        return;
      }
      // A destination that looks cloud-synced is a warning, not a rejection (#95) —
      // ask, then move if the user still wants it.
      if (res.confirm === 'cloud-sync') {
        // Bound once: the callback below outlives any narrowing on res.dest.
        // main always sends dest alongside confirm — the flat result shape
        // (ipc-payloads.ts) is what leaves it optional.
        const dest = res.dest as string;
        setProgress(null);
        confirmOpen({
          message: t('saveFolderCloudWarn', [res.provider]),
          description: t('saveFolderCloudWarnDesc'),
          okLabel: t('saveFolderCloudWarnOk'),
          cancelLabel: t('confirmCancel'),
          onOk: async () => {
            setMigrating(true);
            try {
              applyMoveResult(await moveSaveFolder(dest));
            } catch {
              notify(t('saveFolderErrGeneric'));
            } finally {
              setMigrating(false);
            }
          },
        });
        return;
      }
      applyMoveResult(res);
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setMigrating(false);
    }
  };

  // --- library switch (#176) — 切り替え / 新規作成 / 最近使ったライブラリ. main
  // reloads every window itself on success (switchLibrary's whole point — an
  // organize-layer store that only partially re-synced is exactly the class of
  // bug a full reload avoids), so there is nothing else to refresh here on ok.
  const doSwitch = async (dest: string) => {
    setSwitchingLib(true);
    try {
      const res = await switchLibraryIpc(dest);
      if (res && res.ok) {
        notify(t('librarySwitched'));
      } else {
        notify(libraryErr(res && res.error));
      }
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setSwitchingLib(false);
      refreshRecentLibraries();
    }
  };

  const pickAndSwitch = async () => {
    setSwitchingLib(true);
    try {
      const res = await pickLibraryFolder();
      if (!res || res.canceled) return;
      if (!res.ok || !res.dest) {
        notify(libraryErr(res && res.error));
        return;
      }
      const dest = res.dest;
      if (res.classification === 'empty') {
        confirmOpen({
          message: t('libraryEmptyConfirm'),
          description: t('libraryEmptyConfirmDesc'),
          okLabel: t('libraryEmptyConfirmOk'),
          cancelLabel: t('confirmCancel'),
          onOk: () => void doSwitch(dest),
        });
        return;
      }
      if (res.classification === 'evidence-no-db') {
        confirmOpen({
          message: t('libraryRecoverConfirm'),
          description: t('libraryRecoverConfirmDesc'),
          okLabel: t('libraryRecoverConfirmOk'),
          cancelLabel: t('confirmCancel'),
          onOk: () => void doSwitch(dest),
        });
        return;
      }
      await doSwitch(dest); // 'has-db' — no confirm needed
    } finally {
      setSwitchingLib(false);
    }
  };

  // A row in "最近使ったライブラリ" is already known-good (it was opened
  // before) — no pick, no classify, no confirm.
  const switchToRecent = (path: string) => void doSwitch(path);
  const forgetRecent = async (path: string) => {
    try {
      await removeRecentLibraryIpc(path);
    } catch {
      /* ignore */
    } finally {
      refreshRecentLibraries();
    }
  };

  // --- writing an archive out ---
  // Two buttons over one main-side call, because #233 separates the two words
  // the old single "Export ZIP" control conflated: a BACKUP file is the whole
  // library plus its organization, made to be restored; an EXPORT is media
  // handed to something else. `mode` is what main already took ('full' /
  // 'images'), so the split is UI vocabulary, not a second code path (#57's
  // "the manual complete ZIP moves under backup, implementation untouched").
  const [exportIncludeTrash, setExportIncludeTrash] = useState(false); // #300/St7: opt-in, default off
  const writeArchive = async (mode: 'full' | 'images') => {
    // A sticky loading toast shows the live % streamed to disk (fed by main's
    // 'export-progress' via onExportProgress); it also covers the save-dialog wait.
    const id = 'hologram-export';
    toast.loading(t('exporting'), { id, description: '0%' });
    const off = onExportProgress((p) => {
      if (!p || p.done) return;
      toast.loading(t('exporting'), { id, description: `${p.pct ?? 0}%` });
    });
    try {
      const res = await exportComplete(mode, mode === 'full' && exportIncludeTrash);
      off();
      toast.dismiss(id);
      if (res && res.saved) notify(t('exported'));
      else if (res && res.empty) notify(t('noData'));
      else if (res && res.error) notify(t('exportFailed'));
      // canceled dialog (res.saved false, no empty/error): the toast is already dismissed.
    } catch {
      off();
      toast.dismiss(id);
      notify(t('exportFailed'));
    }
  };

  // --- import ZIP --- (new complete format vs legacy metadata.json + images/)
  // main runs the picker and reads the archive for BOTH formats (#485 / #322); the
  // legacy branch comes back with the archive's path, not its bytes, and the
  // renderer asks main to finish the import once it has the #34 answer.
  const importZip = async () => {
    try {
      const res = await importComplete();
      if (res && res.canceled) return;
      notify(t('importing'));
      const done = (imported: number, skipped: number) => {
        reloadPosts();
        if (skipped > 0) notify(t('importSkipped', [imported, skipped]));
        else notify(t('imported', [imported]));
      };
      if (res && res.legacy && res.path) {
        // Bound once: the callbacks below outlive the narrowing on res.path.
        const zipPath = res.path;
        // #34: When the posts being imported already exist in the library, ask
        // copy / replace / skip just once (asking per item would mean hundreds of
        // prompts, so it's batched). If there are no duplicates, the main process
        // imports immediately, so this confirmation never appears.
        const first = await importLegacyZip(zipPath);
        if (!first || first.error) {
          notify(t('importFailed'));
          return;
        }
        if (first.needsChoice) {
          const finish = async (mode: string) => {
            const r = await importLegacyZip(zipPath, mode);
            done(r.imported, r.skipped);
          };
          confirmOpen({
            message: t('importDuplicate', [first.duplicates]),
            description: t('importDuplicateDesc'),
            okLabel: t('importDuplicateReplace'),
            altLabel: t('importDuplicateCopy'),
            cancelLabel: t('importDuplicateSkip'),
            onOk: () => void finish('replace'),
            onAlt: () => void finish('copy'),
            // Esc lands here too, and skipping is the answer that changes the
            // least — the library keeps what it has.
            onCancel: () => void finish('skip'),
          });
          return;
        }
        done(first.imported, first.skipped);
        return;
      }
      if (!res || !res.ok) {
        reloadPosts();
        notify(t('importFailed'));
        return;
      }
      // A complete import that answered ok always carries both counters; the
      // fallbacks are only what the flat result shape (ipc-payloads.ts) forces.
      done(res.imported ?? 0, res.skipped ?? 0);
    } catch {
      notify(t('importFailed'));
    }
  };

  // --- import media (arbitrary local image/video files) ---
  const importMedia = async () => {
    try {
      const res = await importImages();
      if (!res || res.canceled) return;
      // #37: main refuses while the save folder is missing (see ipc-transfer.ts's
      // import-images guard) — surface that rather than reporting "0 imported".
      if (res.error) {
        notify(res.error === 'library-missing' ? t('saveFolderErrLibraryMissing') : t('importFailed'));
        return;
      }
      reloadPosts();
      if (res.skipped > 0) notify(t('importSkipped', [res.imported, res.skipped]));
      else notify(t('imported', [res.imported]));
    } catch {
      notify(t('importFailed'));
    }
  };

  const saveWatchFolders = async (folders: WatchImportFolder[], markExisting?: string[]) => {
    try {
      const next = await setWatchImport(folders, markExisting);
      setWatchFolders(next?.folders || folders);
      setWatchImported(next?.status?.imported || 0);
    } catch {
      notify(t('watchImportFailed'));
    }
  };
  const addWatchFolder = async () => {
    try {
      const picked = await pickWatchImportFolder();
      if (!picked || picked.canceled) return;
      if (!picked.ok || !picked.path) {
        notify(t('watchImportOverlap'));
        return;
      }
      const folder = picked.path;
      confirmOpen({
        message: t('watchImportExisting'),
        description: t('watchImportExistingDesc'),
        okLabel: t('watchImportExistingYes'),
        cancelLabel: t('watchImportExistingNo'),
        onOk: () => void saveWatchFolders([...watchFolders, { path: folder, enabled: true }]),
        onCancel: () => void saveWatchFolders([...watchFolders, { path: folder, enabled: true }], [folder]),
      });
    } catch {
      notify(t('watchImportFailed'));
    }
  };

  // --- backup events: refresh the status line when a run finishes ---
  // (onBackupStart only drove the rail "syncing" glyph, which stays in viewer.js.)
  useEffect(() => {
    wireIpcOnce();
    const onDone = (r: BackupRunResult) => {
      if (!r) return;
      setBackup((b) => (b ? Object.assign({}, b, { lastResult: r }) : b));
      // A run can add a generation and carry it to the destination, so both the
      // list and the per-row "also at the destination" badge are stale now.
      Promise.resolve(listDbGenerations())
        .then((g) => setGenerations(g || []))
        .catch(() => {});
    };
    backupSubs.add(onDone);
    return () => {
      backupSubs.delete(onDone);
    };
  }, []);

  // --- integrity events: refresh when the startup check or a backup-run's
  // piggybacked check finishes (#301) ---
  useEffect(() => {
    wireIpcOnce();
    const onDone = (s: IntegrityStatus) => setIntegrity(s || null);
    integritySubs.add(onDone);
    return () => {
      integritySubs.delete(onDone);
    };
  }, []);

  const recoverOrphans = async () => {
    setRecovering(true);
    try {
      const res = await runOrphanRecovery();
      if (res && res.ok) {
        notify(t('integrityRecovered', [res.recovered]));
        reloadPosts();
      }
      try {
        setIntegrity((await getIntegrityStatus()) || null);
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    } finally {
      setRecovering(false);
    }
  };

  const saveBackup = async (patch: Partial<BackupConfig>) => {
    try {
      const res = await setBackupConfig(patch);
      if (res && res.ok === false && res.error === 'overlap') notify(t('backupOverlap'));
      if (res && res.backup) setBackup(res.backup);
    } catch {
      /* ignore */
    }
  };
  const chooseBackupDir = async () => {
    try {
      const res = await pickBackupDir();
      if (res && res.error === 'overlap') {
        notify(t('backupOverlap'));
        return;
      }
      if (res && res.backup) setBackup(res.backup);
    } catch {
      /* ignore */
    }
  };

  // Rolling back to one generation (#233). Confirmed first because it replaces
  // the whole organization layer, and because main reloads every window a moment
  // after it answers — the toast below is the only report the user gets.
  const rollBackTo = (g: DbGeneration) => {
    confirmOpen({
      message: t('backupRestoreConfirm', [fmtTime(g.at)]),
      description: t('backupRestoreConfirmDesc'),
      okLabel: t('backupRestoreOk'),
      cancelLabel: t('confirmCancel'),
      onOk: async () => {
        setRollingBack(true);
        try {
          const res = await rollbackDbGeneration(g.name);
          if (res && res.ok) notify(t('backupRestoreDone', [fmtTime(g.at), res.reregistered ?? 0]));
          else notify(res && res.error === 'busy' ? t('backupRestoreBusy') : t('backupRestoreFailed'));
        } catch {
          notify(t('backupRestoreFailed'));
        } finally {
          setRollingBack(false);
        }
      },
    });
  };

  // Status line, simplified from viewer.js renderStatus (the rail keeps the icons).
  const renderBackupStatus = () => {
    if (!backup || !backup.dir) return null;
    const r = backup.lastResult;
    if (!r) return null;
    if (r.ok === false && r.error) {
      return <div className="text-destructive mt-2 text-[0.8rem]">{`⚠ ${backupErr(r.error)}`}</div>;
    }
    if (r.pruneSkipped) {
      const msg = r.pruneSkipped === 'shrink' ? t('backupPruneShrink') : t('backupPruneEmpty');
      return <div className="text-destructive mt-2 text-[0.8rem]">{`⚠ ${msg}`}</div>;
    }
    let s = `${t('backupLastLabel')} ${fmtTime(r.at)}`;
    if (r.written) s += `（+${r.written}${t('backupItemsUnit')}）`;
    else if (r.fileCount) s += `（${r.fileCount}${t('backupItemsUnit')}）`;
    return <div className="text-muted-foreground mt-2 text-[0.8rem]">{s}</div>;
  };

  return (
    <div className="space-y-6">
      {/* #176: switch between libraries — separate from "保存先フォルダ" below,
          which MOVES the current library rather than opening a different one. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('libraryCardTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('libraryCardHint')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <PathChip>{saveFolder}</PathChip>
          </div>
          <div className="text-muted-foreground text-[0.8rem]">
            {t('libraryBackupPrefix')}
            {(backup && backup.dir) || t('libraryBackupNone')}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="outline" onClick={() => void pickAndSwitch()} disabled={switchingLib}>
              {switchingLib ? t('libraryChanging') : t('librarySwitch')}
            </Button>
            <Button variant="outline" onClick={() => void pickAndSwitch()} disabled={switchingLib}>
              {t('libraryCreateNew')}
            </Button>
          </div>
          {recentLibraries.length > 1 && (
            <div>
              <div className="text-sm font-medium">
                <Highlight text={t('libraryRecentTitle')} />
              </div>
              <div className="mt-2 space-y-1.5">
                {recentLibraries
                  .filter((r) => r.path !== saveFolder)
                  .map((r) => (
                    <div key={r.path} className="flex flex-wrap items-center gap-2.5">
                      <PathChip>{r.path}</PathChip>
                      {r.exists ? (
                        <Button variant="ghost" size="sm" onClick={() => switchToRecent(r.path)} disabled={switchingLib}>
                          {t('librarySwitchTo')}
                        </Button>
                      ) : (
                        <>
                          <span className="text-destructive text-xs">{t('libraryRecentDead')}</span>
                          <Button variant="ghost" size="sm" onClick={() => void forgetRecent(r.path)}>
                            {t('libraryRecentForget')}
                          </Button>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save destination folder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('saveFolderSubTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('saveFolderHint')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <PathChip>{saveFolder}</PathChip>
            <Button variant="outline" onClick={chooseSaveFolder} disabled={migrating}>
              {migrating ? t('saveFolderMoving') : t('saveFolderChange')}
            </Button>
          </div>

          {/* Migration progress (hidden except while moving) */}
          {progress && (
            <div className="space-y-2.5">
              <div className="text-sm font-medium">{t('saveFolderProgressTitle')}</div>
              <div className="flex items-center gap-3">
                <Progress value={progress.pct} className="flex-1" />
                <span className="text-muted-foreground min-w-10 text-right text-xs tabular-nums">{progress.pct}%</span>
              </div>
              <div className="bg-muted text-muted-foreground max-h-36 overflow-y-auto rounded-md p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {progress.log.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('watchImportTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('watchImportHint')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {watchFolders.map((folder) => (
            <div key={folder.path} className="flex flex-wrap items-center gap-2.5">
              <Checkbox checked={folder.enabled} onCheckedChange={(v) => void saveWatchFolders(watchFolders.map((item) => (item.path === folder.path ? { ...item, enabled: v === true } : item)))} />
              <PathChip>{folder.path}</PathChip>
              <Button variant="ghost" size="sm" onClick={() => void saveWatchFolders(watchFolders.filter((item) => item.path !== folder.path))}>
                {t('watchImportRemove')}
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2.5">
            <Button variant="outline" onClick={addWatchFolder}>
              {t('watchImportAdd')}
            </Button>
            {watchImported > 0 && <span className="text-muted-foreground text-xs">{t('watchImportLast', [watchImported])}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Export / import media — handing files to something else, not a backup */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('exportSubTitle')} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Button variant="outline" onClick={() => void writeArchive('images')}>
              {t('exportZip')}
            </Button>
            <Hint text={t('hintZip')} />
          </div>
          <Separator />
          <div>
            <Button variant="outline" onClick={importMedia}>
              {t('importImages')}
            </Button>
            <Hint text={t('hintMedia')} />
          </div>
        </CardContent>
      </Card>

      {/* Backup: the automatic destination, and the manual backup file beside it
          (#57 — the two halves of "backup" belong on the same surface, one
          continuous to a destination and one a single file made by hand). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            <Highlight text={t('backupSubTitle')} />
          </CardTitle>
          <CardDescription>
            <Highlight text={t('hintBackup')} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <PathChip>{(backup && backup.dir) || t('backupDirNone')}</PathChip>
            <Button variant="outline" onClick={chooseBackupDir}>
              {t('backupChoose')}
            </Button>
            <Button variant="ghost" onClick={() => saveBackup({ dir: null })}>
              {t('backupClear')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox id="backup-interval" checked={!!(backup && backup.interval)} onCheckedChange={(v) => saveBackup({ interval: v === true })} />
            <Label htmlFor="backup-interval" className="font-normal">
              {t('backupInterval')}
            </Label>
            <Input
              type="number"
              min={1}
              max={999}
              value={(backup && backup.intervalValue) || 1}
              onChange={(e) => {
                const v = Math.max(1, Math.min(999, Number.parseInt(e.target.value, 10) || 1));
                saveBackup({ intervalValue: v });
              }}
              className="h-8 w-16 text-xs"
            />
            <Select items={{ day: t('unitDay'), week: t('unitWeek'), month: t('unitMonth') }} value={(backup && backup.intervalUnit) || 'day'} onValueChange={(v) => v !== null && saveBackup({ intervalUnit: v })}>
              <SelectTrigger size="sm" className="w-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">{t('unitDay')}</SelectItem>
                <SelectItem value="week">{t('unitWeek')}</SelectItem>
                <SelectItem value="month">{t('unitMonth')}</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm">{t('backupIntervalUnit')}</span>
          </div>
          {renderBackupStatus()}

          <Separator />

          {/* Restore points: the DB generations the engine keeps locally (#233).
              Media is write-once and never rolled back, so this is the
              organization layer only — the wording says so rather than leaving
              "restore" to imply the posts go away too. */}
          <div>
            <div className="text-sm font-medium">
              <Highlight text={t('backupRestoreSubTitle')} />
            </div>
            {generations.length === 0 ? (
              <div className="text-muted-foreground mt-2.5 text-[0.8rem]">{t('backupRestoreNone')}</div>
            ) : (
              <div className="mt-2.5 space-y-1.5">
                {generations.map((g) => (
                  <div key={g.name} className="flex flex-wrap items-center gap-2.5">
                    <span className="min-w-40 text-sm tabular-nums">{fmtTime(g.at)}</span>
                    {/* Fixed width so the buttons line up down the column: the
                        two location labels are different lengths, and a ragged
                        edge reads as an unrelated control per row. */}
                    <span className="text-muted-foreground min-w-36 text-xs">{g.atDestination ? t('backupRestoreBoth') : t('backupRestoreHere')}</span>
                    <Button variant="outline" size="sm" onClick={() => rollBackTo(g)} disabled={rollingBack}>
                      {t('backupRestoreBtn')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Hint text={t('hintBackupRestore')} />
          </div>

          <Separator />

          <div>
            <div className="text-sm font-medium">
              <Highlight text={t('backupFileSubTitle')} />
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
              <Button variant="outline" onClick={() => void writeArchive('full')}>
                {t('backupFileCreate')}
              </Button>
              <Button variant="outline" onClick={importZip}>
                {t('importZip')}
              </Button>
              <div className="flex items-center gap-1.5">
                <Checkbox id="export-include-trash" checked={exportIncludeTrash} onCheckedChange={(v) => setExportIncludeTrash(v === true)} />
                <Label htmlFor="export-include-trash" className="font-normal">
                  {t('exportIncludeTrash')}
                </Label>
              </div>
            </div>
            <Hint text={t('hintBackupFile')} />
          </div>
        </CardContent>
      </Card>

      {/* Integrity check (#301) — hidden via progressive disclosure when there are no problems */}
      {integrity && (integrity.dbOk === false || (integrity.orphanCount ?? 0) > 0 || (integrity.missingCount ?? 0) > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <Highlight text={t('integritySubTitle')} />
            </CardTitle>
            <CardDescription>
              <Highlight text={t('hintIntegrity')} />
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {integrity.dbOk === false && <div className="text-destructive text-[0.8rem]">{`⚠ ${t('integrityDbBad')}`}</div>}
            {(integrity.orphanCount ?? 0) > 0 && (
              <div className="text-destructive flex flex-wrap items-center gap-2.5 text-[0.8rem]">
                <span>{`⚠ ${t('integrityOrphanLine', [integrity.orphanCount])}`}</span>
                <Button variant="outline" size="sm" onClick={recoverOrphans} disabled={recovering}>
                  {t('integrityRecoverBtn')}
                </Button>
              </div>
            )}
            {(integrity.missingCount ?? 0) > 0 && <div className="text-destructive text-[0.8rem]">{`⚠ ${t('integrityMissingLine', [integrity.missingCount])}`}</div>}
            {integrity.lastCheckAt && <div className="text-muted-foreground text-[0.8rem]">{t('integrityLastChecked', [fmtTime(integrity.lastCheckAt)])}</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
