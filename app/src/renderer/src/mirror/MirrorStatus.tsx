import { useEffect, useReducer, useRef } from 'react';
import { t } from '../_shared/i18n.ts';
import { fmtBackupTime, fmtTime } from '../services/format.ts';
import { getBackup, onBackupStart, onBackupDone, getIntegrityStatus, onIntegrityCheckDone } from '../services/backup.ts';
import { isOpen as settingsIsOpen, subscribe as settingsSubscribe } from '../services/settings.ts';

// Backup status rail — the always-visible sidebar footer showing the auto-backup state.
// This component OWNS the state machine (backup config + last result + syncing flag),
// reading it straight from backup.ts (getBackup + onBackupStart/Done) and deriving the
// model (kind/text/title/time) with its own t() + format.ts's fmtBackupTime/fmtTime —
// there is no viewer push (the old shared push bridge + setupMirrorStatusRail are gone).
//
// It renders its own root now (P3 #6). The status tone used to be a modifier class
// (.is-syncing / .is-error / .is-done) that a useLayoutEffect wrote onto the sidebar's
// host <span> — a cross-boundary DOM write into another component's element (#153
// category 4), which existed only because the tone lived in the legacy sheet. The tone is
// a prop of this element's own className now, so the sidebar just places the component.

// Status glyphs (verbatim from viewer's old MS_ICON_*): spinning arrows = syncing, check =
// done, triangle = error / prune-guarded.
const IconSync = () => (
  <svg className="shrink-0 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconDone = () => (
  <svg className="shrink-0" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconWarn = () => (
  <svg className="shrink-0" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

// The rail's tone by state. Only two states colour it — a run in progress and something
// wrong; a finished backup is ordinary sidebar chrome and stays muted.
const TONE: Record<string, string> = {
  syncing: 'text-[var(--accent-text)]',
  error: 'text-[var(--danger)]',
  done: '',
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
// stays empty). The today/yesterday relative-time words are i18n-owned here and passed to
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

// DB<->media integrity model (#301) — independent of backup config (the
// startup check runs with no mirror `dir` set), so it is derived separately
// from deriveModel and takes priority over it (same precedence the existing
// pruneSkipped warning already gets over a plain 'done' state) whenever
// there is something to report. null = nothing wrong (or never checked yet).
function deriveIntegrityModel(integrity: any): MirrorModel {
  if (!integrity) return null;
  if (integrity.dbOk === false) return { kind: 'error', text: t('mirrorDbCorrupt'), title: t('integrityDbBad') };
  if (integrity.orphanCount > 0) return { kind: 'error', text: t('mirrorOrphanFound'), title: t('mirrorOrphanTip', [integrity.orphanCount]) };
  return null;
}

export function MirrorStatus() {
  // cfgRef / syncingRef mirror the old viewer closure vars (cfg / mirrorSyncing) 1:1 — the
  // config object is mutated in place (cfg.lastResult = r), so a ref (not a store key) is the
  // faithful home; tick() forces the re-render the old updateMirrorStatus() push used to.
  const cfgRef = useRef<any>(null);
  const syncingRef = useRef(false);
  const integrityRef = useRef<any>(null);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        cfgRef.current = await getBackup();
      } catch {
        cfgRef.current = null;
      }
      try {
        integrityRef.current = await getIntegrityStatus();
      } catch {
        integrityRef.current = null;
      }
      if (alive) tick();
    };
    load();
    onIntegrityCheckDone((status: any) => {
      integrityRef.current = status;
      if (alive) tick();
    });
    // A run started: show the spinner. Pull cfg first so a backup configured mid-session
    // still lights the rail (cfg may have been null at boot). onBackupStart/Done register
    // once for the app's lifetime (no unsubscribe, like the other App-level IPC effects) —
    // this component never actually unmounts in the single-page app.
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
    onBackupDone(async (r: any) => {
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
    // Refresh when the settings dialog closes — the Data.tsx component may have changed
    // the backup folder. This reads services/settings.ts's own open/closed store (the
    // same one settings/index.tsx wires the Dialog into) instead of reaching across a
    // component boundary into the sidebar's DOM (#153 category 4) — the settings gear's
    // id/element never enters this module at all.
    let settingsWasOpen = settingsIsOpen();
    const unsubSettings = settingsSubscribe(() => {
      const nowOpen = settingsIsOpen();
      if (settingsWasOpen && !nowOpen) load();
      settingsWasOpen = nowOpen;
    });
    return () => {
      alive = false;
      unsubSettings();
    };
  }, []);

  // An orphan/DB-integrity warning wins over the ordinary mirror state (and shows even
  // with no mirror `dir` configured — the startup check runs independent of backup config).
  const m = deriveIntegrityModel(integrityRef.current) || deriveModel(cfgRef.current, syncingRef.current);
  if (!m) return null;
  return (
    // max-w keeps a long state string from widening the sidebar footer; the label
    // truncates instead. group-data-[collapsible=icon]:hidden keeps this out of the rail
    // — a deliberate choice (#678), not a space constraint: the rail's scope is the 5
    // fixed destinations only, and this status readout is ambient state, not a
    // destination. At 72px there is slightly more room than the old 48px, but not enough
    // for icon + status word (+ sometimes a relative-timestamp second line) without
    // clutter, and a labelless icon-only stand-in would itself contradict #678's own rule
    // against unlabeled rail icons. So: expanded column only.
    <span data-slot="mirror-status" title={m.title || ''} className={`ml-2 inline-flex max-w-[150px] items-center gap-[5px] overflow-hidden px-2 text-[11px] whitespace-nowrap text-[var(--text-muted)] group-data-[collapsible=icon]:hidden ${TONE[m.kind]}`}>
      {m.kind === 'done' ? <IconDone /> : m.kind === 'syncing' ? <IconSync /> : <IconWarn />}
      {m.kind === 'done' ? (
        // "Done" alone carries a second line (when it ran), so it stacks; the other two are
        // one line and sit straight in the row.
        <span className="flex min-w-0 flex-col leading-[1.2]">
          <span className="truncate">{m.text}</span>
          {m.time ? <span className="truncate text-[9.5px] text-[var(--text-subtle)]">{m.time}</span> : null}
        </span>
      ) : (
        <span className="truncate">{m.text}</span>
      )}
    </span>
  );
}
