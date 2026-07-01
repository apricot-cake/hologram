import { useState, useEffect } from 'react';
import { Hint } from '../components/Hint.jsx';
import { Highlight } from '../components/Highlight.jsx';
import { Switch } from '../components/Switch.jsx';
import { t } from '../../_shared/i18n.js';
import { getPrefs } from '../ipc.js';

// 危険な操作: re-enable the delete confirmation + wipe the whole library.
// The wipe is NOT reimplemented here — the button only triggers the shared
// keyword-gated confirm overlay via window.corpusViewer.confirmClearAll().
export function Danger() {
  // checked = confirmation is shown (i.e. NOT skipped).
  const [confirmShown, setConfirmShown] = useState(true);

  useEffect(() => {
    Promise.resolve(getPrefs()).then((p) => {
      if (p) setConfirmShown(!p.skipDeleteConfirm);
    }).catch(() => {});
  }, []);

  const onToggle = (checked) => {
    setConfirmShown(checked);
    if (window.corpusViewer && window.corpusViewer.setSkipDeleteConfirm) {
      window.corpusViewer.setSkipDeleteConfirm(!checked);
    }
  };

  const clearAll = () => {
    if (window.corpusViewer && window.corpusViewer.confirmClearAll) window.corpusViewer.confirmClearAll();
  };

  return (
    <>
      <div style={{ marginBottom: '12px' }}>
        <Switch checked={confirmShown} onChange={onToggle} label={<Highlight text={t('labelResetDeleteConfirm')} />} />
        <Hint text={t('hintResetDeleteConfirm')} />
      </div>
      <button className="btn-danger" onClick={clearAll}>{t('clearData')}</button>
    </>
  );
}
