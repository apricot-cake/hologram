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
import { getBackup, setBackup as setBackupConfig, pickBackupDir, onBackupDone, getIntegrityStatus, runOrphanRecovery, onIntegrityCheckDone } from '../../services/backup.ts';
import { onExportProgress, onSaveFolderProgress, pickSaveFolder, moveSaveFolder, exportComplete, importComplete, importPosts, importImages } from '../../services/posts.ts';
import { readLegacyZipPosts } from '../../services/legacy-zip-import.ts';
import { open as confirmOpen } from '../../services/confirm.ts';
import { loadPosts } from '../../services/post-grid-builder.ts';

// Missing-bridge calls throw and land in the callers' try/catch, same as the
// untyped original — the {} fallback only exists for the bare dev server.
const hologram = (): HologramPreload => window.hologram || ({} as HologramPreload);
const reloadPosts = () => {
  if (loadPosts) loadPosts();
};

// save-folder-progress IPC payload (main.js move pipeline).
interface SaveFolderProgress {
  phase: 'copy' | 'switch' | 'cleanup' | 'done' | 'straggler' | 'error';
  done?: number;
  total?: number;
  percent?: number;
  moved?: number;
  leftover?: number;
  error?: string;
}
// backup config + last-run result (get-backup / set-backup / backup-done IPC).
interface BackupResult {
  ok?: boolean;
  error?: string;
  pruneSkipped?: string;
  at?: string;
  written?: number;
  fileCount?: number;
}
interface BackupState {
  dir?: string | null;
  interval?: boolean;
  intervalValue?: number;
  intervalUnit?: string;
  lastResult?: BackupResult | null;
}
// get-integrity-status / integrity-check-done IPC payload (#301).
interface IntegrityStatus {
  lastCheckAt?: string | null;
  dbOk?: boolean | null;
  orphanCount?: number;
  missingCount?: number;
}

// The preload's on* bridges attach a new ipcRenderer listener on every call with
// no remover, and this component remounts on each modal open. So register the
// underlying IPC listeners exactly ONCE and fan out to the live React subscriber
// set — effects only add/remove themselves, never re-subscribe to IPC.
const progressSubs = new Set<(p: SaveFolderProgress) => void>();
const backupSubs = new Set<(r: BackupResult) => void>();
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
    onBackupDone((r: BackupResult) => backupSubs.forEach((cb) => cb(r)));
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
    default:
      return t('saveFolderErrGeneric');
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

// データ: save-folder (with live migration progress), export/import, auto backup.
// Port of viewer.js setupSaveFolder + the export/import handlers + setupBackup —
// only the modal-side UI. The always-visible rail #mirrorStatus stays in viewer.js.
export function Data() {
  // --- save folder ---
  const [saveFolder, setSaveFolder] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; log: string[] } | null>(null); // while/after a move

  // --- backup ---
  const [backup, setBackup] = useState<BackupState | null>(null);

  // --- integrity (#301) ---
  const [integrity, setIntegrity] = useState<IntegrityStatus | null>(null);
  const [recovering, setRecovering] = useState(false);

  // Load both the config save folder and the backup config on mount (the modal
  // remounts each time it opens, so this matches the old "reload on open").
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
        setProgress(null);
        confirmOpen({
          message: t('saveFolderCloudWarn', [res.provider]),
          description: t('saveFolderCloudWarnDesc'),
          okLabel: t('saveFolderCloudWarnOk'),
          cancelLabel: t('confirmCancel'),
          onOk: async () => {
            setMigrating(true);
            try {
              applyMoveResult(await moveSaveFolder(res.dest));
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

  // --- export ---
  const [exportMode, setExportMode] = useState('full');
  const [exportIncludeTrash, setExportIncludeTrash] = useState(false); // #300/St7: opt-in, default off
  const exportZip = async () => {
    // A sticky loading toast shows the live % streamed to disk (fed by main's
    // 'export-progress' via onExportProgress); it also covers the save-dialog wait.
    const id = 'hologram-export';
    toast.loading(t('exporting'), { id, description: '0%' });
    const off = onExportProgress((p) => {
      if (!p || p.done) return;
      toast.loading(t('exporting'), { id, description: `${p.pct ?? 0}%` });
    });
    try {
      const res = await exportComplete(exportMode, exportMode === 'full' && exportIncludeTrash);
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
  // main runs the picker and reads the archive (#485); the legacy branch is the
  // only one that still comes back to the renderer, with its bytes attached.
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
      if (res && res.legacy && res.bytes) {
        const posts = await readLegacyZipPosts(new Uint8Array(res.bytes));
        if (!posts) {
          notify(t('importFailed'));
          return;
        }
        // #34: 取り込む投稿が既にライブラリにあるとき、コピー／置換／スキップを
        // 1回だけ聞く（1件ずつ聞くと数百回になるため、バッチ単位）。重複が無ければ
        // main 側が即座に取り込むので、この確認は出ない。
        const first = await importPosts(posts);
        if (first?.needsChoice) {
          const finish = async (mode: string) => {
            const r = await importPosts(posts, mode);
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
      done(res.imported, res.skipped);
    } catch {
      notify(t('importFailed'));
    }
  };

  // --- import media (arbitrary local image/video files) ---
  const importMedia = async () => {
    try {
      const res = await importImages();
      if (!res || res.canceled) return;
      reloadPosts();
      if (res.skipped > 0) notify(t('importSkipped', [res.imported, res.skipped]));
      else notify(t('imported', [res.imported]));
    } catch {
      notify(t('importFailed'));
    }
  };

  // --- backup events: refresh the status line when a run finishes ---
  // (onBackupStart only drove the rail "syncing" glyph, which stays in viewer.js.)
  useEffect(() => {
    wireIpcOnce();
    const onDone = (r: BackupResult) => {
      if (!r) return;
      setBackup((b) => (b ? Object.assign({}, b, { lastResult: r }) : b));
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

  const saveBackup = async (patch: Partial<BackupState>) => {
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

  // Status line, simplified from viewer.js renderStatus (the rail keeps the icons).
  const renderBackupStatus = () => {
    if (!backup || !backup.dir) return null;
    const r = backup.lastResult;
    if (!r) return null;
    if (r.ok === false && r.error) {
      return <div className="text-destructive mt-2 text-[0.8rem]">{`⚠ ${r.error}`}</div>;
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
      {/* 保存先フォルダ */}
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

          {/* 移行の進捗（移動中以外は非表示） */}
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

      {/* Export / Import ZIP + import media */}
      <Card>
        <CardContent className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Select items={{ full: t('exportModeFull'), images: t('exportModeImages') }} value={exportMode} onValueChange={(v) => v !== null && setExportMode(v)}>
                <SelectTrigger size="sm" className="w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">{t('exportModeFull')}</SelectItem>
                  <SelectItem value="images">{t('exportModeImages')}</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={exportZip}>
                {t('exportZip')}
              </Button>
              <Button variant="outline" onClick={importZip}>
                {t('importZip')}
              </Button>
              {exportMode === 'full' && (
                <div className="flex items-center gap-1.5">
                  <Checkbox id="export-include-trash" checked={exportIncludeTrash} onCheckedChange={(v) => setExportIncludeTrash(v === true)} />
                  <Label htmlFor="export-include-trash" className="font-normal">
                    {t('exportIncludeTrash')}
                  </Label>
                </div>
              )}
            </div>
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

      {/* 自動バックアップ */}
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
        </CardContent>
      </Card>

      {/* 整合性チェック（#301） — 何も問題が無ければ progressive disclosure で非表示 */}
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
