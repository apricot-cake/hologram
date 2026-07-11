import { useState, useEffect } from 'react';
import { Hint } from '../components/Hint.tsx';
import { Highlight } from '../components/Highlight.tsx';
import { Switch } from '../components/Switch.tsx';
import { t } from '../../_shared/i18n.ts';
import { getPrefs } from '../ipc.ts';
import { setSkipDeleteConfirm, confirmClearAll } from '../../../renderer/post-grid-builder.ts';

// 危険な操作: re-enable the delete confirmation + wipe the whole library.
// The wipe is NOT reimplemented here — the button only triggers the shared
// keyword-gated confirm overlay via post-grid-builder.ts's confirmClearAll live binding.
export function Danger() {
  // checked = confirmation is shown (i.e. NOT skipped).
  const [confirmShown, setConfirmShown] = useState(true);

  useEffect(() => {
    Promise.resolve(getPrefs())
      .then((p) => {
        if (p) setConfirmShown(!p.skipDeleteConfirm);
      })
      .catch(() => {});
  }, []);

  const onToggle = (checked: boolean) => {
    setConfirmShown(checked);
    if (setSkipDeleteConfirm) setSkipDeleteConfirm(!checked);
  };

  const clearAll = () => {
    if (confirmClearAll) confirmClearAll();
  };

  return (
    <>
      <div style={{ marginBottom: '12px' }}>
        <Switch checked={confirmShown} onChange={onToggle} label={<Highlight text={t('labelResetDeleteConfirm')} />} />
        <Hint text={t('hintResetDeleteConfirm')} />
      </div>
      <button className="btn-danger" onClick={clearAll}>
        {t('clearData')}
      </button>
    </>
  );
}
