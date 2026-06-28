import { useState, useEffect } from 'react';
import { Hint } from '../components/Hint.jsx';
import { t } from '../i18n.js';
import * as ipc from '../ipc.js';

// 言語: viewer display language. Changing it persists then reloads the renderer
// (so all static i18n re-applies) — same behavior as the vanilla select.
export function Language() {
  const [lang, setLang] = useState('auto');

  useEffect(() => {
    ipc.getPrefs().then((p) => { if (p) setLang(p.language || 'auto'); }).catch(() => {});
  }, []);

  return (
    <>
      <select
        value={lang}
        style={{ width: '100%' }}
        onChange={(e) => {
          const v = e.target.value;
          setLang(v);
          Promise.resolve(ipc.setPref('language', v)).then(() => location.reload());
        }}
      >
        <option value="auto">{t('langAuto')}</option>
        <option value="ja">日本語</option>
        <option value="en">English</option>
      </select>
      <Hint text={t('hintLang')} />
    </>
  );
}
