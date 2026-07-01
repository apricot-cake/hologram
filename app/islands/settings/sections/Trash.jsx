import { useState, useEffect } from 'react';
import { Highlight } from '../components/Highlight.jsx';
import { t } from '../../_shared/i18n.js';

const corpus = () => window.corpus || {};

const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
};

// ゴミ箱: soft-deleted records with restore / permanent-delete / empty-all.
// Port of viewer.js setupTrash — rendered as JSX instead of an innerHTML string.
export function Trash() {
  const [records, setRecords] = useState([]);

  const load = async () => {
    try {
      setRecords((await corpus().listTrash()) || []);
    } catch {
      setRecords([]);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once initial load (load is re-created per render but behaviorally stable)
  useEffect(() => {
    load();
  }, []);

  const restore = async (r) => {
    try {
      await corpus().restorePost(r.image || r.video || r.captureId);
    } catch {
      /* ignore */
    }
    await load();
  };
  const perma = async (r) => {
    try {
      await corpus().deleteFromTrash(r.captureId);
    } catch {
      /* ignore */
    }
    await load();
  };
  const emptyAll = async () => {
    try {
      await corpus().emptyTrash();
    } catch {
      /* ignore */
    }
    await load();
  };

  const thumbStyle = { width: '36px', height: '36px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 };

  return (
    <>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px' }}>
        <Highlight text={records.length ? t('trashCount', [records.length]) : t('trashEmpty')} />
      </div>
      <div style={{ maxHeight: '220px', overflowY: 'auto', marginBottom: '10px' }}>
        {records.map((r) => {
          const title = r.title || r.screenName || r.captureId || '';
          const platform = r.platform || '';
          const date = fmtDate(r.trashedAt);
          return (
            <div key={r.captureId || r.image || r.video} className="trash-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', borderBottom: '1px solid var(--border-subtle)' }}>
              {r.image ? <img src={'psimg://' + r.image} style={thumbStyle} loading="lazy" alt="" /> : <span style={{ ...thumbStyle, background: 'var(--surface-3)', display: 'inline-block' }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{`${platform} ${date}`}</div>
              </div>
              <button className="btn-outline" style={{ fontSize: '11px', padding: '3px 8px', flexShrink: 0 }} onClick={() => restore(r)}>
                {t('trashRestoreBtn')}
              </button>
              <button className="btn-outline" style={{ fontSize: '11px', padding: '3px 8px', flexShrink: 0, color: 'var(--danger)' }} onClick={() => perma(r)}>
                {t('trashDeleteBtn')}
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn-outline" onClick={emptyAll} disabled={!records.length}>
        {t('trashEmptyBtn')}
      </button>
    </>
  );
}
