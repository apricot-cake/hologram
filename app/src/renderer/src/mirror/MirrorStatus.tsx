import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { t } from '../_shared/i18n.ts';
import { fmtBackupTime, fmtTime } from '../services/format.ts';
import { getBackup, onBackupStart, onBackupDone } from '../services/backup.ts';

// Backup status rail (#mirrorStatus) — the always-visible sidebar footer showing the
// auto-backup state. This island OWNS the state machine (backup config + last result +
// syncing flag), reading it straight from backup.ts (getBackup + onBackupStart/
// Done) and deriving the model (kind/text/title/time) with its own t() + format.ts's
// fmtBackupTime/fmtTime — there is no viewer push (the old shared push bridge +
// setupMirrorStatusRail are gone). The status modifier (.is-syncing / .is-error / .is-done)
// lives on the host <span> itself (the portal target, not a React-owned element), so a
// useLayoutEffect writes host.className/title there — the inline margin-left:auto style is
// left untouched.

// Status glyphs (verbatim from viewer's old MS_ICON_*): spinning arrows = syncing, check =
// done, triangle = error / prune-guarded.
const IconSync = () => (
  <svg className="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconDone = () => (
  <svg className="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconWarn = () => (
  <svg className="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const CLASS: Record<string, string> = {
  syncing: 'mirror-status is-syncing',
  error: 'mirror-status is-error',
  done: 'mirror-status is-done',
};

type MirrorModel = { kind: 'syncing' | 'error' | 'done'; text: string; title?: string; time?: string } | null;

// Human explanation of a held-back prune (empty vs sharp shrink), counts appended.
function pruneSkipTip(r: any): string {
  if (r.pruneSkipped === 'shrink') {
    const span = r.baselineCount && r.fileCount != null ? `（${r.baselineCount}→${r.fileCount}${t('backupItemsUnit')}）` : '';
    return t('backupPruneShrink') + span;
  }
  return t('backupPruneEmpty');
}

// Derive the rail model from the raw backup config + syncing flag (verbatim from the old
// viewer updateMirrorStatus). No backup folder → null (progressive disclosure: the rail
// stays empty). The 今日/昨日 relative-time words are i18n-owned here and passed to
// fmtBackupTime as labels.
function deriveModel(cfg: any, syncing: boolean): MirrorModel {
  if (!cfg || !cfg.dir) return null;
  if (syncing) return { kind: 'syncing', text: t('mirrorSyncingShort'), title: t('backupSyncing') };
  const r = cfg.lastResult;
  if (!r) return null;
  if (r.ok === false && r.error) return { kind: 'error', text: t('mirrorFailed'), title: r.error };
  if (r.pruneSkipped) return { kind: 'error', text: t('mirrorGuarded'), title: pruneSkipTip(r) };
  const ts = fmtBackupTime(r.at, { today: t('timeToday'), yesterday: t('timeYesterday') });
  let tip = `${t('backupLastLabel')} ${fmtTime(r.at)}`;
  if (r.written) tip += `（+${r.written}${t('backupItemsUnit')}）`;
  else if (r.fileCount) tip += `（${r.fileCount}${t('backupItemsUnit')}）`;
  return { kind: 'done', text: t('mirrorDone'), time: ts, title: tip };
}

export function MirrorStatus() {
  // cfgRef / syncingRef mirror the old viewer closure vars (cfg / mirrorSyncing) 1:1 — the
  // config object is mutated in place (cfg.lastResult = r), so a ref (not a store key) is the
  // faithful home; tick() forces the re-render the old updateMirrorStatus() push used to.
  const cfgRef = useRef<any>(null);
  const syncingRef = useRef(false);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        cfgRef.current = await getBackup();
      } catch {
        cfgRef.current = null;
      }
      if (alive) tick();
    };
    load();
    // A run started: show the spinner. Pull cfg first so a backup configured mid-session
    // still lights the rail (cfg may have been null at boot). onBackupStart/Done register
    // once for the app's lifetime (no unsubscribe, like the other App-level IPC effects) —
    // this island never actually unmounts in the single-page app.
    onBackupStart(async () => {
      syncingRef.current = true;
      if (!cfgRef.current || !cfgRef.current.dir) {
        try {
          cfgRef.current = await getBackup();
        } catch {
          /* ignore */
        }
      }
      if (alive) tick();
    });
    // A run finished: carry over the fresh result (and pull cfg if it was empty when the
    // run began) so the rail is correct without a manual refresh.
    onBackupDone(async (_e: any, r: any) => {
      syncingRef.current = false;
      if (!cfgRef.current) {
        try {
          cfgRef.current = await getBackup();
        } catch {
          /* ignore */
        }
      }
      if (cfgRef.current && r) cfgRef.current.lastResult = r;
      if (alive) tick();
    });
    // Refresh when the settings modal opens — the Data.tsx island may have changed the
    // backup folder.
    const settingsBtn = document.getElementById('settingsBtn');
    settingsBtn?.addEventListener('click', load);
    return () => {
      alive = false;
      settingsBtn?.removeEventListener('click', load);
    };
  }, []);

  const m = deriveModel(cfgRef.current, syncingRef.current);
  // className / title live on the host <span> (portal target), not a React element. m is a
  // fresh object each render, but a re-render only happens on tick() (an actual backup-state
  // change), so re-running this idempotent host write on [m] is correct, not wasteful.
  useLayoutEffect(() => {
    const host = document.getElementById('mirrorStatus');
    if (!host) return;
    host.className = m ? CLASS[m.kind] : 'mirror-status';
    host.title = m ? m.title || '' : '';
  }, [m]);
  if (!m) return null;
  if (m.kind === 'done') {
    return (
      <>
        <IconDone />
        <span className="ms-body">
          <span className="ms-t">{m.text}</span>
          {m.time ? <span className="ms-time">{m.time}</span> : null}
        </span>
      </>
    );
  }
  return (
    <>
      {m.kind === 'syncing' ? <IconSync /> : <IconWarn />}
      <span className="ms-t">{m.text}</span>
    </>
  );
}
