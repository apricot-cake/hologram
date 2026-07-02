import { useState, useEffect, useRef } from 'react';
import { Hint } from '../components/Hint.jsx';
import { Highlight } from '../components/Highlight.jsx';
import { t } from '../../_shared/i18n.js';

const corpus = () => window.corpus || {};
const notify = (m) => {
  if (window.corpusUI && window.corpusUI.notify) window.corpusUI.notify(m);
};
const reloadPosts = () => {
  if (window.corpusViewer && window.corpusViewer.reloadPosts) window.corpusViewer.reloadPosts();
};

// The preload's on* bridges attach a new ipcRenderer listener on every call with
// no remover, and this component remounts on each modal open. So register the
// underlying IPC listeners exactly ONCE and fan out to the live React subscriber
// set — effects only add/remove themselves, never re-subscribe to IPC.
const progressSubs = new Set();
const backupSubs = new Set();
let ipcWired = false;
function wireIpcOnce() {
  if (ipcWired) return;
  ipcWired = true;
  if (corpus().onSaveFolderProgress) corpus().onSaveFolderProgress((p) => progressSubs.forEach((cb) => cb(p)));
  if (corpus().onBackupDone) corpus().onBackupDone((_e, r) => backupSubs.forEach((cb) => cb(r)));
}

// Migration error code → message key, faithful to viewer.js setupSaveFolder.errMsg.
const saveFolderErr = (code) => {
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

const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// データ: save-folder (with live migration progress), export/import, auto backup.
// Port of viewer.js setupSaveFolder + the export/import handlers + setupBackup —
// only the modal-side UI. The always-visible rail #mirrorStatus stays in viewer.js.
export function Data() {
  // --- save folder ---
  const [saveFolder, setSaveFolder] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState(null); // { pct, log: [] } while/after a move

  // --- backup ---
  const [backup, setBackup] = useState(null); // { dir, interval, intervalValue, intervalUnit, lastResult }

  // file input for the legacy ZIP path
  const zipInputRef = useRef(null);

  // Load both the config save folder and the backup config on mount (the modal
  // remounts each time it opens, so this matches the old "reload on open").
  useEffect(() => {
    Promise.resolve(corpus().getConfig ? corpus().getConfig() : null)
      .then((cfg) => setSaveFolder((cfg && cfg.saveFolder) || ''))
      .catch(() => {});
    Promise.resolve(corpus().getBackup ? corpus().getBackup() : null)
      .then((b) => setBackup(b || null))
      .catch(() => {});
  }, []);

  // Live migration progress events. The copy percent only drives the bar; log
  // lines are phase milestones (start / switch / cleanup / done) — no "…20%" spam.
  useEffect(() => {
    wireIpcOnce();
    const onProg = (p) => {
      if (!p) return;
      setProgress((prev) => {
        const log = prev ? prev.log.slice() : [];
        let pct = prev ? prev.pct : 0;
        if (p.phase === 'copy') {
          if (p.done === 0) log.push(t('logCopyStart', [p.total]));
          pct = p.percent;
        } else if (p.phase === 'switch') {
          pct = 100;
          log.push(t('logSwitch'));
        } else if (p.phase === 'cleanup') {
          log.push(t('logCleanup'));
        } else if (p.phase === 'done') {
          pct = 100;
          log.push(t('logMoveDone', [p.moved]));
          if (p.leftover > 0) log.push(t('logLeftover', [p.leftover]));
        } else if (p.phase === 'straggler') {
          log.push(t('logStraggler', [p.moved]));
        } else if (p.phase === 'error') {
          log.push(saveFolderErr(p.error));
        }
        return { pct, log };
      });
    };
    progressSubs.add(onProg);
    return () => progressSubs.delete(onProg);
  }, []);

  const chooseSaveFolder = async () => {
    setMigrating(true);
    setProgress(null); // box appears on the first progress event (after a folder is picked)
    try {
      const res = await corpus().pickSaveFolder();
      if (!res || res.canceled) {
        setProgress(null);
        return;
      }
      if (res.ok) {
        setSaveFolder(res.saveFolder);
        notify(t('saveFolderMoved', [res.moved]));
        reloadPosts();
      } else {
        notify(saveFolderErr(res.error));
      }
    } catch {
      notify(t('saveFolderErrGeneric'));
    } finally {
      setMigrating(false);
    }
  };

  // --- export ---
  const [exportMode, setExportMode] = useState('full');
  const exportZip = async () => {
    notify(t('exporting'));
    try {
      const res = await corpus().exportComplete(exportMode);
      if (res && res.saved) notify(t('exported'));
      else if (res && res.empty) notify(t('noData'));
      else if (res && res.error) notify(t('exportFailed'));
    } catch {
      notify(t('exportFailed'));
    }
  };

  // --- import ZIP --- (new complete format vs legacy metadata.json + images/)
  const onZipPicked = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const input = e.target;
    notify(t('importing'));
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const zip = await window.JSZip.loadAsync(buf);
      const isComplete = !!zip.file('corpus-export.json') || Object.keys(zip.files).some((p) => p.indexOf('library/') === 0);
      if (isComplete) {
        const res = await corpus().importComplete(buf);
        reloadPosts();
        input.value = '';
        if (!res || !res.ok) {
          notify(t('importFailed'));
          return;
        }
        if (res.skipped > 0) notify(t('importSkipped', [res.imported, res.skipped]));
        else notify(t('imported', [res.imported]));
        return;
      }
      const metaEntry = zip.file('metadata.json');
      if (!metaEntry) {
        notify(t('importFailed'));
        input.value = '';
        return;
      }
      const meta = JSON.parse(await metaEntry.async('string'));
      const posts = [];
      for (const m of Array.isArray(meta) ? meta : []) {
        const f = m.imageFile && zip.file(m.imageFile);
        if (!f) continue;
        const b64 = await f.async('base64');
        posts.push(Object.assign({}, m, { image: 'data:image/jpeg;base64,' + b64 }));
      }
      const { imported, skipped } = await corpus().importPosts(posts);
      reloadPosts();
      input.value = '';
      if (skipped > 0) notify(t('importSkipped', [imported, skipped]));
      else notify(t('imported', [imported]));
    } catch {
      notify(t('importFailed'));
      input.value = '';
    }
  };

  // --- import media (arbitrary local image/video files) ---
  const importMedia = async () => {
    try {
      const res = await corpus().importImages();
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
    const onDone = (r) => {
      if (!r) return;
      setBackup((b) => (b ? Object.assign({}, b, { lastResult: r }) : b));
    };
    backupSubs.add(onDone);
    return () => backupSubs.delete(onDone);
  }, []);

  const saveBackup = async (patch) => {
    try {
      const res = await corpus().setBackup(patch);
      if (res && res.ok === false && res.error === 'overlap') notify(t('backupOverlap'));
      if (res && res.backup) setBackup(res.backup);
    } catch {
      /* ignore */
    }
  };
  const chooseBackupDir = async () => {
    try {
      const res = await corpus().pickBackupDir();
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
      return <div className="hint" style={{ marginTop: '6px', color: 'var(--danger)' }}>{`⚠ ${r.error}`}</div>;
    }
    if (r.pruneSkipped) {
      const msg = r.pruneSkipped === 'shrink' ? t('backupPruneShrink') : t('backupPruneEmpty');
      return <div className="hint" style={{ marginTop: '6px', color: 'var(--danger)' }}>{`⚠ ${msg}`}</div>;
    }
    let s = `${t('backupLastLabel')} ${fmtTime(r.at)}`;
    if (r.written) s += `（+${r.written}${t('backupItemsUnit')}）`;
    else if (r.fileCount) s += `（${r.fileCount}${t('backupItemsUnit')}）`;
    return (
      <div className="hint" style={{ marginTop: '6px' }}>
        {s}
      </div>
    );
  };

  const codeStyle = {
    flex: 1,
    minWidth: '200px',
    fontSize: '12px',
    color: 'var(--text)',
    background: 'var(--surface-2)',
    padding: '6px 10px',
    borderRadius: '6px',
    wordBreak: 'break-all',
  };

  return (
    <>
      {/* 保存先フォルダ */}
      <div className="data-section">
        <div style={{ fontSize: '13px', fontWeight: 600 }}>
          <Highlight text={t('saveFolderSubTitle')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0' }}>
          <code style={codeStyle}>{saveFolder}</code>
          <button className="btn-outline" onClick={chooseSaveFolder} disabled={migrating}>
            {migrating ? t('saveFolderMoving') : t('saveFolderChange')}
          </button>
        </div>
        <Hint text={t('saveFolderHint')} />
      </div>

      {/* 移行の進捗（移動中以外は非表示） */}
      {progress && (
        <div className="data-section" style={{ marginTop: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600 }}>{t('saveFolderProgressTitle')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0' }}>
            <div style={{ flex: 1, height: '8px', background: 'var(--surface-3)', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: progress.pct + '%', background: 'var(--accent)', borderRadius: '999px', transition: 'width .15s ease' }} />
            </div>
            <span style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', minWidth: '42px', textAlign: 'right', color: 'var(--text-muted)' }}>{progress.pct}%</span>
          </div>
          <div style={{ fontSize: '11px', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', color: 'var(--text-muted)', background: 'var(--surface-2)', borderRadius: '6px', padding: '8px 10px', maxHeight: '140px', overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
            {progress.log.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {/* Export / Import ZIP */}
      <div className="data-section" style={{ marginTop: '14px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* mode select + export button are one joined control */}
          <span style={{ display: 'inline-flex', alignItems: 'stretch' }}>
            <select value={exportMode} onChange={(e) => setExportMode(e.target.value)} style={{ width: 'auto', fontSize: '12px', borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}>
              <option value="full">{t('exportModeFull')}</option>
              <option value="images">{t('exportModeImages')}</option>
            </select>
            <button className="btn-outline" onClick={exportZip} style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
              {t('exportZip')}
            </button>
          </span>
          <button className="btn-outline" onClick={() => zipInputRef.current && zipInputRef.current.click()} style={{ marginLeft: '10px' }}>
            {t('importZip')}
          </button>
        </div>
        <Hint text={t('hintZip')} />
        <input type="file" ref={zipInputRef} hidden accept=".zip" onChange={onZipPicked} />
      </div>

      {/* Import media */}
      <div className="data-section" style={{ marginTop: '14px' }}>
        <button className="btn-outline" onClick={importMedia}>
          {t('importImages')}
        </button>
        <Hint text={t('hintMedia')} />
      </div>

      {/* 自動バックアップ */}
      <div className="data-section" style={{ marginTop: '14px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600 }}>
          <Highlight text={t('backupSubTitle')} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '8px 0' }}>
          <code style={codeStyle}>{(backup && backup.dir) || t('backupDirNone')}</code>
          <button className="btn-outline" onClick={chooseBackupDir}>
            {t('backupChoose')}
          </button>
          <button className="btn-outline" onClick={() => saveBackup({ dir: null })}>
            {t('backupClear')}
          </button>
        </div>
        <label className="radio-line">
          <input type="checkbox" checked={!!(backup && backup.interval)} onChange={(e) => saveBackup({ interval: e.target.checked })} /> <span>{t('backupInterval')}</span>{' '}
          <input
            type="number"
            min="1"
            max="999"
            value={(backup && backup.intervalValue) || 1}
            onChange={(e) => {
              const v = Math.max(1, Math.min(999, Number.parseInt(e.target.value, 10) || 1));
              saveBackup({ intervalValue: v });
            }}
            style={{ width: '56px', fontSize: '12px', padding: '2px 4px' }}
          />{' '}
          <select value={(backup && backup.intervalUnit) || 'day'} onChange={(e) => saveBackup({ intervalUnit: e.target.value })} style={{ fontSize: '12px', padding: '2px 4px' }}>
            <option value="day">{t('unitDay')}</option>
            <option value="week">{t('unitWeek')}</option>
            <option value="month">{t('unitMonth')}</option>
          </select>{' '}
          <span>{t('backupIntervalUnit')}</span>
        </label>
        <Hint text={t('hintBackup')} />
        {renderBackupStatus()}
      </div>
    </>
  );
}
