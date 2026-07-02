import { useState, useEffect } from 'react';
import { SettingRow } from '../components/SettingRow.tsx';
import { Hint } from '../components/Hint.tsx';
import { Switch } from '../components/Switch.tsx';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';

const cleanPref = (p: unknown) => (p === 'light' || p === 'dark' ? p : 'auto');

// 外観: theme (auto/light/dark) + "show info on tiles" toggle.
export function Appearance() {
  const [theme, setTheme] = useState(() => ipc.theme.get());
  const [tileOverlay, setTileOverlay] = useState(true);

  // Reconcile with persisted prefs once they resolve — theme.js may still be
  // syncing config from IPC when the island first mounts.
  useEffect(() => {
    ipc
      .getPrefs()
      .then((p) => {
        if (!p) return;
        if (p.theme) setTheme(cleanPref(p.theme));
        setTileOverlay(p.tileOverlay !== false);
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <SettingRow label={t('themeMode')}>
        <select
          value={theme}
          style={{ width: 'auto', minWidth: '140px' }}
          onChange={(e) => {
            setTheme(e.target.value);
            ipc.theme.set(e.target.value);
          }}
        >
          <option value="auto">{t('themeAuto')}</option>
          <option value="light">{t('themeLight')}</option>
          <option value="dark">{t('themeDark')}</option>
        </select>
      </SettingRow>
      <Hint text={t('hintTheme')} />
      <SettingRow label={t('tileOverlay')} style={{ marginTop: '10px' }}>
        <Switch
          checked={tileOverlay}
          onChange={(v) => {
            setTileOverlay(v);
            ipc.setTileOverlay(v);
          }}
        />
      </SettingRow>
    </>
  );
}
